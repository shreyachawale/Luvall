/**
 * Session recording, attendance, cancellations and the coach/venue payable snapshots.
 *
 * Brief sections 6, 10 and 11; BRD FR-010..FR-019.
 *
 * Attendance inputs are plain objects with the request's snake_case keys:
 *   entry  = { student_id, status: "present" | "absent", attendee_type?, billing_mode?, makeup_credit_id?, drop_in_fee?, remarks? }
 *   coach  = { coach_id, hours_coached, adjustment_amount?, adjustment_note? }
 */
import {
  ATTENDEE_TYPES,
  Batch,
  MakeupCredit,
  sameId,
  Session,
  SessionAttendance,
  StudentFeePlan,
  StudentProfile,
  User,
} from "../models/index.js";
import { isObjectId } from "../models/plugins.js";
import { now, today } from "../utils/clock.js";
import { addDays, fmtDate, minutesBetween, normTime } from "../utils/dates.js";
import { BusinessRuleError } from "../utils/errors.js";
import { hoursBetween, q } from "../utils/money.js";
import * as batchSvc from "./batches.js";
import * as ledger from "./ledger.js";
import * as makeups from "./makeups.js";
import * as rates from "./rates.js";

export const CANCEL_BILLING = { refund: "refunded", carry_forward: "carried_forward", no_adjustment: "package" };
export const REGULAR_BILLING_OVERRIDES = ["package", "carried_forward", "complimentary"];
export const EXTRA_BILLING_OVERRIDES = ["package", "drop_in", "complimentary", "makeup"];

const isSet = (v) => v !== null && v !== undefined;

/** Whether a coach may record/correct this session today: [ok, reason]. */
export function coachCanEdit(session, rules) {
  const t = today();
  if (session.session_date > t) return [false, "Attendance can be recorded on or after the session date"];
  if (session.session_date < addDays(t, -rules.attendance_edit_window_days)) {
    return [false, "The edit window for this session has closed; ask the admin to correct it"];
  }
  if (session.status === "cancelled") return [false, "This session was cancelled"];
  return [true, null];
}

function defaultBilling(attendeeType, status) {
  if (attendeeType === "regular") return "package";
  if (status !== "present") return "none";
  return { makeup: "makeup", drop_in: "drop_in" }[attendeeType] ?? "complimentary";
}

async function batchName(session) {
  const batch = await Batch.findById(session.batch_id).select("name");
  return batch ? batch.name : null;
}

/** Keep the ledger entry of one attendance row in line with its billing (drop-in fee or refund credit). */
export async function syncAttendanceLedger(att, session, actorId) {
  let desired = 0;
  let txnType = "adjustment";
  let description = `Session ${fmtDate(session.session_date)}`;
  const plan = att.student_fee_plan_id ? await StudentFeePlan.findById(att.student_fee_plan_id) : null;
  if (att.billing_mode === "drop_in" && att.attendance_status === "present") {
    desired = q(0 - q(att.drop_in_fee || 0));
    txnType = "drop_in_charge";
    description = `Drop-in fee: ${await batchName(session)} on ${fmtDate(session.session_date)}`;
  } else if (att.billing_mode === "refunded" && plan) {
    desired = plan.per_session_value;
    txnType = "cancellation_credit";
    description = `Refund due: cancelled session ${await batchName(session)} on ${fmtDate(session.session_date)}`;
  }
  await ledger.syncReference({
    academyId: session.academy_id,
    studentId: att.student_id,
    referenceType: "attendance",
    referenceId: att._id,
    desired,
    txnType,
    description,
    txnDate: session.session_date,
    batchId: session.batch_id,
    studentFeePlanId: att.student_fee_plan_id,
    createdById: actorId,
  });
}

/** Court payable = duration (hours) x courts used x applicable venue rate (BR-09). Mutates and saves the session. */
export async function snapshotVenue(session, rules, refresh = false) {
  const [dayType, timeSlot] = rates.classifySlot(session.session_date, session.start_time, rules);
  if (refresh || !isSet(session.venue_rate_applied) || dayType !== session.day_type || timeSlot !== session.time_slot) {
    session.day_type = dayType;
    session.time_slot = timeSlot;
    const rate = await rates.venueRateOn(session.venue_id, dayType, timeSlot, session.session_date);
    session.venue_rate_applied = q(rate || 0);
  }
  if (session.venue_charge_applies) {
    session.court_payable = q(hoursBetween(session.duration_minutes) * session.courts_booked * session.venue_rate_applied);
  } else {
    session.court_payable = 0;
  }
  await session.save();
}

/** Coach payable = actual hours x applicable hourly rate + permitted adjustments (BR-08). Mutates and saves the session. */
export async function computeCoachPayables(session, refreshRates = false) {
  for (const sc of session.coaches) {
    if (refreshRates || !isSet(sc.rate_applied)) {
      sc.rate_applied = q((await rates.coachRateOn(sc.coach_id, session.session_date)) || 0);
    }
    const hours = isSet(sc.hours_coached) ? sc.hours_coached : 0;
    sc.payable_amount = q(hours * sc.rate_applied + (sc.adjustment_amount || 0));
  }
  await session.save();
}

/** The attendance row for (session, student): [row, isNew]. New rows are not saved yet. */
async function upsert(session, studentId) {
  const att = await SessionAttendance.findOne({ session_id: session._id, student_id: studentId });
  if (att) return [att, false];
  const created = new SessionAttendance({
    session_id: session._id,
    student_id: studentId,
    academy_id: session.academy_id,
    session_date: session.session_date,
    attended_batch_id: session.batch_id,
  });
  return [created, true];
}

/** Delete an attendance row; make-up credits pointing at it lose the reference (ON DELETE SET NULL). */
async function deleteAttendance(att) {
  await MakeupCredit.updateMany({ missed_attendance_id: att._id }, { $set: { missed_attendance_id: null } });
  await MakeupCredit.updateMany({ used_attendance_id: att._id }, { $set: { used_attendance_id: null } });
  await att.deleteOne();
}

/**
 * Record (or correct) a session's attendance and coach hours, then snapshot coach and venue payables.
 * Mutates and saves `session`; returns it.
 */
export async function recordSession(
  session,
  { entries = [], coaches = [], rules, actorId, isAdmin, actualStart = null, actualEnd = null, courtsBooked = null, remarks = null },
) {
  if (session.status === "cancelled") {
    throw new BusinessRuleError("This session was cancelled; reinstate it before recording attendance");
  }

  if (actualStart || actualEnd) {
    const start = normTime(actualStart || session.start_time);
    const end = normTime(actualEnd || session.end_time);
    const minutes = minutesBetween(start, end);
    if (minutes <= 0) throw new BusinessRuleError("Session end time must be after start time", 400);
    session.start_time = start;
    session.end_time = end;
    session.duration_minutes = minutes;
  }
  if (isSet(courtsBooked)) {
    if (courtsBooked < 0) throw new BusinessRuleError("Courts cannot be negative", 400);
    session.courts_booked = courtsBooked;
  }
  if (isSet(remarks)) session.remarks = remarks;

  const regularIds = new Set(
    (await batchSvc.regularEnrollmentsOn(session.batch_id, session.session_date)).map((e) => String(e.student_id)),
  );
  const seen = new Set();
  for (const entry of entries) {
    const key = String(entry.student_id);
    if (seen.has(key)) throw new BusinessRuleError("A student appears twice in the attendance list", 400);
    seen.add(key);
    if (entry.status !== "present" && entry.status !== "absent") {
      throw new BusinessRuleError("Attendance must be present or absent", 400);
    }
    const profile = isObjectId(key) ? await StudentProfile.findById(key).select("_id") : null;
    if (!profile) throw new BusinessRuleError(`Unknown student ${entry.student_id}`, 400);
    await recordEntry(session, entry, regularIds, rules, actorId, isAdmin);
  }

  const byCoach = new Map(session.coaches.map((sc) => [String(sc.coach_id), sc]));
  for (const ch of coaches) {
    let sc = byCoach.get(String(ch.coach_id));
    if (!sc) {
      if (!isAdmin) throw new BusinessRuleError("Only the admin can add a coach to a session", 403);
      session.coaches.push({ coach_id: ch.coach_id, scheduled_hours: hoursBetween(session.duration_minutes) });
      sc = session.coaches[session.coaches.length - 1];
      byCoach.set(String(ch.coach_id), sc);
    }
    if (ch.hours_coached < 0 || ch.hours_coached > 24) throw new BusinessRuleError("Coached hours must be between 0 and 24", 400);
    sc.hours_coached = q(ch.hours_coached);
    if (isAdmin && isSet(ch.adjustment_amount)) {
      sc.adjustment_amount = q(ch.adjustment_amount);
      sc.adjustment_note = ch.adjustment_note ?? null;
    }
  }
  for (const sc of session.coaches) {
    if (!isSet(sc.hours_coached)) sc.hours_coached = hoursBetween(session.duration_minutes);
  }

  session.status = "completed";
  session.venue_charge_applies = isSet(session.venue_charge_applies) ? session.venue_charge_applies : true;
  session.recorded_by_id = actorId;
  session.recorded_at = now();
  await session.save();
  await computeCoachPayables(session);
  await snapshotVenue(session, rules);
  return session;
}

async function recordEntry(session, entry, regularIds, rules, actorId, isAdmin) {
  const [att, isNew] = await upsert(session, entry.student_id);
  const previous = isNew ? null : [att.attendance_status, att.attendee_type, att.billing_mode];

  let attendeeType;
  if (regularIds.has(String(entry.student_id))) {
    attendeeType = "regular";
  } else if (!isNew && att.attendee_type !== "regular") {
    attendeeType = entry.attendee_type || att.attendee_type;
  } else {
    const booked = await MakeupCredit.exists({
      student_id: entry.student_id,
      booked_session_id: session._id,
      status: { $in: ["booked", "used"] },
    });
    attendeeType = booked ? "makeup" : entry.attendee_type || "drop_in";
  }
  if (!ATTENDEE_TYPES.includes(attendeeType)) throw new BusinessRuleError("Unknown attendee type", 400);

  att.attendance_status = entry.status;
  att.attendee_type = attendeeType;
  att.attended_batch_id = session.batch_id;
  att.recorded_by_id = actorId;
  if (isSet(entry.remarks)) att.remarks = entry.remarks;

  const allowed = attendeeType === "regular" ? REGULAR_BILLING_OVERRIDES : EXTRA_BILLING_OVERRIDES;
  let billing;
  if (entry.billing_mode && isAdmin) {
    if (!allowed.includes(entry.billing_mode)) {
      throw new BusinessRuleError(`Billing mode ${entry.billing_mode} is not allowed here`, 400);
    }
    billing = entry.billing_mode;
  } else if (previous && previous[0] === entry.status && previous[1] === attendeeType && previous[2] === att.billing_mode) {
    billing = att.billing_mode; // keep an earlier admin override
  } else {
    billing = defaultBilling(attendeeType, entry.status);
  }
  if (attendeeType === "makeup" && billing === "makeup" && entry.status !== "present") billing = "none";
  att.billing_mode = billing;

  if (attendeeType === "regular") {
    att.original_batch_id = session.batch_id;
    att.is_makeup = false;
    att.makeup_credit_id = null;
  } else if (attendeeType !== "makeup") {
    att.original_batch_id = null;
    att.is_makeup = false;
  }

  if (billing === "drop_in") {
    if (isSet(entry.drop_in_fee) && isAdmin) att.drop_in_fee = q(entry.drop_in_fee);
    else if (!isSet(att.drop_in_fee)) att.drop_in_fee = q(rules.drop_in_fee);
  } else {
    att.drop_in_fee = null;
  }

  await att.save();

  // Which package (if any) this attendance draws on.
  if (["package", "carried_forward", "refunded"].includes(billing)) {
    const plan = await ledger.findPlanFor(
      att.student_id,
      attendeeType === "regular" ? session.batch_id : null,
      session.session_date,
    );
    att.student_fee_plan_id = plan ? plan._id : null;
  } else if (attendeeType !== "makeup") {
    att.student_fee_plan_id = null;
  }

  if (attendeeType === "makeup") {
    const credit = await makeups.resolveCreditFor(att.student_id, session, entry.makeup_credit_id || att.makeup_credit_id);
    if (att.makeup_credit_id && !sameId(att.makeup_credit_id, credit._id)) {
      const old = await MakeupCredit.findById(att.makeup_credit_id);
      if (old && sameId(old.used_attendance_id, att._id)) await makeups.release(old);
    }
    if (billing === "makeup" || entry.status !== "present") {
      await makeups.applyMakeupAttendance(att, credit, session);
      const plan = await ledger.findPlanFor(att.student_id, credit.original_batch_id, session.session_date);
      att.student_fee_plan_id = plan ? plan._id : null;
    } else {
      // Admin chose another billing for this extra attendee; the credit stays with the student.
      if (sameId(credit.used_attendance_id, att._id)) await makeups.release(credit);
      att.makeup_credit_id = null;
      att.is_makeup = false;
    }
  } else if (att.makeup_credit_id) {
    const old = await MakeupCredit.findById(att.makeup_credit_id);
    if (old && sameId(old.used_attendance_id, att._id)) await makeups.release(old);
    att.makeup_credit_id = null;
    att.is_makeup = false;
  }

  await att.save();
  if (attendeeType === "regular") await makeups.syncRegular(att, session, rules, actorId);
  await syncAttendanceLedger(att, session, actorId);
  return att;
}

/** Remove an extra attendee row (regular students are marked absent instead). */
export async function removeAttendee(att, actorId) {
  if (att.attendee_type === "regular") {
    throw new BusinessRuleError("Regular students cannot be removed; mark them absent instead");
  }
  const session = await Session.findById(att.session_id);
  att.billing_mode = "none";
  att.attendance_status = "absent";
  await syncAttendanceLedger(att, session, actorId);
  if (att.makeup_credit_id) {
    const credit = await MakeupCredit.findById(att.makeup_credit_id);
    if (credit && sameId(credit.used_attendance_id, att._id)) await makeups.release(credit);
  }
  await deleteAttendance(att);
}

/**
 * Cancel a session for everyone. This is never recorded as student absence (BR-04, FR-011).
 * Mutates and saves `session`; returns it.
 */
export async function cancelSession(session, { reason = null, adjustment, venueChargeApplies, rules, actorId }) {
  if (!Object.hasOwn(CANCEL_BILLING, adjustment)) {
    throw new BusinessRuleError("Adjustment must be refund, carry_forward or no_adjustment", 400);
  }
  if (session.status === "completed") {
    const present = await SessionAttendance.exists({
      session_id: session._id,
      attendance_status: { $in: ["present", "absent"] },
    });
    if (present) throw new BusinessRuleError("Attendance has already been recorded for this session");
  }
  session.status = "cancelled";
  session.cancellation_reason = reason ?? null;
  session.cancellation_adjustment = adjustment;
  session.venue_charge_applies = venueChargeApplies;
  session.recorded_by_id = actorId;
  session.recorded_at = now();
  await session.save();

  const billing = CANCEL_BILLING[adjustment];
  for (const enrollment of await batchSvc.regularEnrollmentsOn(session.batch_id, session.session_date)) {
    const [att] = await upsert(session, enrollment.student_id);
    att.attendance_status = "session_cancelled";
    att.attendee_type = "regular";
    att.billing_mode = billing;
    att.original_batch_id = session.batch_id;
    att.recorded_by_id = actorId;
    await att.save();
    const plan = await ledger.findPlanFor(att.student_id, session.batch_id, session.session_date);
    att.student_fee_plan_id = plan ? plan._id : null;
    await att.save();
    await makeups.syncRegular(att, session, rules, actorId);
    await syncAttendanceLedger(att, session, actorId);
  }

  const booked = await MakeupCredit.find({ booked_session_id: session._id, status: "booked" }).sort({ _id: 1 });
  for (const credit of booked) await makeups.release(credit);

  for (const sc of session.coaches) sc.hours_coached = 0;
  await session.save();
  await computeCoachPayables(session);
  await snapshotVenue(session, rules);
  return session;
}

/** Undo a cancellation: cancellation rows and their ledger effects are reversed. Mutates and saves `session`. */
export async function reinstateSession(session, actorId) {
  if (session.status !== "cancelled") throw new BusinessRuleError("Session is not cancelled");
  const rows = await SessionAttendance.find({ session_id: session._id }).sort({ _id: 1 });
  for (const att of rows) {
    if (att.attendance_status === "session_cancelled") {
      att.billing_mode = "none";
      await syncAttendanceLedger(att, session, actorId);
      await deleteAttendance(att);
    }
  }
  session.status = "scheduled";
  session.cancellation_reason = null;
  session.cancellation_adjustment = null;
  session.venue_charge_applies = true;
  session.venue_rate_applied = null;
  session.court_payable = null;
  for (const sc of session.coaches) {
    sc.hours_coached = null;
    sc.payable_amount = null;
  }
  await session.save();
  return session;
}

/** Everyone expected or recorded at a session, for the attendance screen. */
export async function roster(session) {
  const existing = new Map();
  for (const a of await SessionAttendance.find({ session_id: session._id }).sort({ _id: 1 })) existing.set(String(a.student_id), a);
  const order = [];
  for (const e of await batchSvc.regularEnrollmentsOn(session.batch_id, session.session_date)) {
    order.push([String(e.student_id), "regular", null]);
  }
  const booked = await MakeupCredit.find({ booked_session_id: session._id, status: { $in: ["booked", "used"] } }).sort({ _id: 1 });
  for (const credit of booked) order.push([String(credit.student_id), "makeup", credit._id]);
  const known = new Set(order.map(([id]) => id));
  for (const [id, att] of existing) {
    if (!known.has(id)) order.push([id, att.attendee_type, att.makeup_credit_id]);
  }

  const users = new Map();
  if (order.length) {
    for (const u of await User.find({ _id: { $in: order.map(([id]) => id) } }).select("name mobile")) users.set(String(u._id), u);
  }
  const batchNames = new Map();
  const nameOf = async (batchId) => {
    const key = String(batchId);
    if (!batchNames.has(key)) {
      const b = await Batch.findById(batchId).select("name");
      batchNames.set(key, b ? b.name : null);
    }
    return batchNames.get(key);
  };

  const rows = [];
  for (const [studentId, expectedType, creditId] of order) {
    const att = existing.get(studentId);
    const user = users.get(studentId);
    let originalBatchId = att ? att.original_batch_id : null;
    if (expectedType === "makeup" && creditId && !originalBatchId) {
      const credit = await MakeupCredit.findById(creditId).select("original_batch_id");
      originalBatchId = credit ? credit.original_batch_id : null;
    }
    const makeupCreditId = (att ? att.makeup_credit_id : null) || creditId;
    rows.push({
      student_id: studentId,
      name: user ? user.name : `Student ${studentId}`,
      mobile: user ? user.mobile : null,
      attendee_type: att ? att.attendee_type : expectedType,
      expected: expectedType === "regular" || expectedType === "makeup",
      attendance_id: att ? String(att._id) : null,
      status: att ? att.attendance_status : null,
      billing_mode: att ? att.billing_mode : null,
      drop_in_fee: att ? (att.drop_in_fee ?? null) : null,
      makeup_credit_id: makeupCreditId ? String(makeupCreditId) : null,
      original_batch_id: originalBatchId ? String(originalBatchId) : null,
      original_batch_name: originalBatchId ? await nameOf(originalBatchId) : null,
      remarks: att ? (att.remarks ?? null) : null,
    });
  }
  return rows;
}

/** Attendance that should draw on a package but has no plan to bill (admin to resolve). */
export async function unbilledAttendanceCount(academyId, since = null) {
  const filter = {
    academy_id: academyId,
    billing_mode: { $in: ["package", "refunded"] },
    student_fee_plan_id: null,
  };
  if (since) filter.session_date = { $gte: since };
  return SessionAttendance.countDocuments(filter);
}
