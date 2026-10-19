/** Missed sessions and make-ups (brief section 7, BR-01..BR-03). */
import { Batch, MakeupCredit, sameId, Session } from "../models/index.js";
import { isObjectId } from "../models/plugins.js";
import { localInstant, now, today } from "../utils/clock.js";
import { addDays, maxDate } from "../utils/dates.js";
import { BusinessRuleError } from "../utils/errors.js";
import * as batchSvc from "./batches.js";

export const OPEN_STATUSES = ["pending_approval", "available", "booked"];

/** Mark available credits past their expiry date as expired. */
export async function expireDue(academyId) {
  await MakeupCredit.updateMany(
    { academy_id: academyId, status: "available", expires_on: { $ne: null, $lt: today() } },
    { $set: { status: "expired" } },
  );
}

function expiry(session, rules) {
  const days = rules.makeup.expiry_days;
  return days ? addDays(session.session_date, days) : null;
}

/** Create the make-up entitlement for a missed session (saved). */
export async function createCredit(att, session, rules, { manual, actorId = null }) {
  const needsApproval = rules.makeup.requires_approval && !manual;
  return MakeupCredit.create({
    academy_id: session.academy_id,
    student_id: att.student_id,
    missed_attendance_id: att._id,
    missed_session_id: session._id,
    original_batch_id: att.original_batch_id || session.batch_id,
    status: needsApproval ? "pending_approval" : "available",
    expires_on: expiry(session, rules),
    decided_by_id: manual ? actorId : null,
    decided_at: manual ? now() : null,
    note: manual ? "Granted by admin" : null,
  });
}

export async function creditForMissed(attendanceId) {
  return MakeupCredit.findOne({ missed_attendance_id: attendanceId });
}

/** Keep the make-up entitlement consistent with a regular student's attendance row. */
export async function syncRegular(att, session, rules, actorId) {
  const credit = await creditForMissed(att._id);
  const qualifies = att.attendance_status === "absent" && att.billing_mode === "package";
  if (qualifies) {
    if (!credit && rules.makeup.eligible_on_absence) {
      await createCredit(att, session, rules, { manual: false, actorId });
    } else if (credit && credit.status === "cancelled") {
      credit.status = rules.makeup.requires_approval ? "pending_approval" : "available";
      await credit.save();
    }
    return;
  }
  if (!credit) return;
  if (credit.status === "used") {
    throw new BusinessRuleError(
      "This absence already has a make-up session attended against it; correct the make-up attendance first",
    );
  }
  if (OPEN_STATUSES.includes(credit.status)) {
    credit.status = "cancelled";
    credit.booked_session_id = null;
    await credit.save();
  }
}

/** Admin grants a make-up for an absence that did not qualify automatically. */
export async function grant(att, rules, actorId) {
  if (att.attendance_status !== "absent" || att.attendee_type !== "regular") {
    throw new BusinessRuleError("Make-ups can only be granted for a regular student's absence");
  }
  const credit = await creditForMissed(att._id);
  const session = await Session.findById(att.session_id);
  if (credit) {
    if (["rejected", "cancelled", "expired"].includes(credit.status)) {
      const t = today();
      credit.status = "available";
      credit.expires_on = maxDate(expiry(session, rules) || t, t);
      credit.decided_by_id = actorId;
      credit.decided_at = now();
      await credit.save();
      return credit;
    }
    throw new BusinessRuleError(`A make-up already exists for this absence (${credit.status})`);
  }
  return createCredit(att, session, rules, { manual: true, actorId });
}

export async function decide(credit, approve, note, actorId) {
  if (credit.status !== "pending_approval") throw new BusinessRuleError(`Make-up is ${credit.status}, not awaiting approval`);
  credit.status = approve ? "available" : "rejected";
  credit.decided_by_id = actorId;
  credit.decided_at = now();
  credit.note = note ?? null;
  await credit.save();
}

/** Milliseconds from now until the session starts (academy-local date + time). */
function msUntilStart(session) {
  return localInstant(session.session_date, session.start_time).getTime() - now().getTime();
}

/** Upcoming sessions of other batches, before expiry, with a free spot. */
export async function bookableSessions(credit, limit = 40) {
  const t = today();
  const batches = await Batch.find({ academy_id: credit.academy_id, status: { $in: ["upcoming", "active"] } }).select("max_players");
  const maxPlayers = new Map(batches.map((b) => [String(b._id), b.max_players]));
  const dateRange = { $gte: t };
  if (credit.expires_on) dateRange.$lte = credit.expires_on;
  const sessions = await Session.find({
    academy_id: credit.academy_id,
    status: "scheduled",
    session_date: dateRange,
    batch_id: { $in: batches.map((b) => b._id) },
  })
    .sort({ session_date: 1, start_time: 1 })
    .limit(200);
  const result = [];
  for (const s of sessions) {
    if (await batchSvc.isRegular(s.batch_id, credit.student_id, s.session_date)) continue;
    if ((await batchSvc.sessionHeadcount(s)) >= maxPlayers.get(String(s.batch_id))) continue;
    result.push(s);
    if (result.length >= limit) break;
  }
  return result;
}

/** Book an available credit into another batch's session. */
export async function book(credit, session, rules, { byStudent }) {
  if (credit.status !== "available") throw new BusinessRuleError(`Make-up is ${credit.status}`);
  if (byStudent && !rules.makeup.student_can_book) {
    throw new BusinessRuleError("Make-ups are booked by the academy; please contact the admin");
  }
  if (session.status !== "scheduled") throw new BusinessRuleError("That session is not open for make-ups");
  if (credit.expires_on && session.session_date > credit.expires_on) {
    throw new BusinessRuleError("That session is after the make-up expiry date");
  }
  if (session.session_date < today()) throw new BusinessRuleError("That session is in the past");
  if (byStudent && msUntilStart(session) < rules.makeup.booking_cutoff_hours * 3600000) {
    throw new BusinessRuleError("Booking for this session has closed");
  }
  if (await batchSvc.isRegular(session.batch_id, credit.student_id, session.session_date)) {
    throw new BusinessRuleError("The student is already a regular in that batch");
  }
  const batch = await Batch.findById(session.batch_id).select("max_players");
  if ((await batchSvc.sessionHeadcount(session)) >= batch.max_players) throw new BusinessRuleError("That session is full");
  credit.status = "booked";
  credit.booked_session_id = session._id;
  await credit.save();
}

export async function cancelBooking(credit, rules, { byStudent }) {
  if (credit.status !== "booked") throw new BusinessRuleError("Make-up is not booked");
  const session = credit.booked_session_id ? await Session.findById(credit.booked_session_id) : null;
  if (byStudent && session && msUntilStart(session) < rules.makeup.booking_cutoff_hours * 3600000) {
    throw new BusinessRuleError("It is too late to cancel this booking");
  }
  await release(credit);
}

/** Return a booked/used credit to the student (e.g. the session was cancelled or they did not attend). Saves it. */
export async function release(credit) {
  credit.booked_session_id = null;
  credit.used_attendance_id = null;
  const expired = credit.expires_on !== null && credit.expires_on !== undefined && credit.expires_on < today();
  credit.status = expired ? "expired" : "available";
  await credit.save();
}

/** The credit a make-up attendee uses: the one given, the one booked for this session, or the oldest open one. */
export async function resolveCreditFor(studentId, session, creditId) {
  if (creditId) {
    const credit = isObjectId(String(creditId)) ? await MakeupCredit.findById(creditId) : null;
    if (!credit || !sameId(credit.student_id, studentId)) {
      throw new BusinessRuleError("Make-up credit does not belong to this student", 400);
    }
    return credit;
  }
  const booked = await MakeupCredit.findOne({
    student_id: studentId,
    booked_session_id: session._id,
    status: { $in: ["booked", "used"] },
  });
  if (booked) return booked;
  const open = await MakeupCredit.find({
    student_id: studentId,
    status: "available",
    $or: [{ expires_on: null }, { expires_on: { $gte: session.session_date } }],
  }).sort({ _id: 1 });
  // Earliest expiry first, credits that never expire last.
  open.sort((a, b) => {
    if (a.expires_on === b.expires_on) return 0;
    if (!a.expires_on) return 1;
    if (!b.expires_on) return -1;
    return a.expires_on < b.expires_on ? -1 : 1;
  });
  if (!open.length) throw new BusinessRuleError("This student has no make-up session available");
  return open[0];
}

/** Attach a make-up credit to an attendance row; a present make-up uses the credit, an absence returns it. */
export async function applyMakeupAttendance(att, credit, session) {
  if (credit.status === "used" && credit.used_attendance_id && !sameId(credit.used_attendance_id, att._id)) {
    throw new BusinessRuleError("That make-up has already been used");
  }
  if (["pending_approval", "rejected", "cancelled"].includes(credit.status)) {
    throw new BusinessRuleError(`That make-up is ${credit.status.replaceAll("_", " ")}`);
  }
  if (credit.expires_on && session.session_date > credit.expires_on) {
    throw new BusinessRuleError("That make-up expired before this session");
  }
  att.makeup_credit_id = credit._id;
  att.original_batch_id = credit.original_batch_id;
  att.is_makeup = true;
  if (att.attendance_status === "present") {
    credit.status = "used";
    credit.used_attendance_id = att._id;
    credit.booked_session_id = session._id;
    await credit.save();
  } else {
    await release(credit);
  }
  await att.save();
}
