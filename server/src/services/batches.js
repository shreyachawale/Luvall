/** Batches, capacity, enrollment and session generation (brief section 4, BRD M06/M07). */
import {
  BatchStudent,
  FeePlan,
  MakeupCredit,
  oid,
  SEAT_HOLDING_STATUSES,
  Session,
  sid,
  StudentFeePlan,
  StudentProfile,
} from "../models/index.js";
import { today } from "../utils/clock.js";
import { addDays, daysBetween, maxDate, minDate, minutesBetween, normTime, weekday } from "../utils/dates.js";
import { BusinessRuleError } from "../utils/errors.js";
import { hoursBetween } from "../utils/money.js";
import * as ledger from "./ledger.js";

export { minutesBetween };

/** Seats taken per batch: pending + active enrollments that have not ended. Returns { [batchId]: count }. */
export async function seatCounts(batchIds) {
  if (!batchIds.length) return {};
  const t = today();
  const rows = await BatchStudent.aggregate([
    {
      $match: {
        batch_id: { $in: batchIds.map(oid) },
        status: { $in: SEAT_HOLDING_STATUSES },
        $or: [{ left_on: null }, { left_on: { $gt: t } }],
      },
    },
    { $group: { _id: "$batch_id", n: { $sum: 1 } } },
  ]);
  const counts = {};
  for (const id of batchIds) counts[sid(id)] = 0;
  for (const r of rows) counts[String(r._id)] = r.n;
  return counts;
}

export async function seatsLeft(batch) {
  const taken = (await seatCounts([batch._id]))[sid(batch)];
  return Math.max(batch.max_players - taken, 0);
}

/** Public status: 'full' is derived from capacity rather than stored. */
export function displayStatus(batch, taken) {
  if ((batch.status === "upcoming" || batch.status === "active") && taken >= batch.max_players) return "full";
  return batch.status;
}

/** The price shown for a batch: its fee plan's base fee, else the batch price. */
export async function batchPrice(batch) {
  if (batch.fee_plan_id) {
    const plan = await FeePlan.findById(batch.fee_plan_id).select("base_fee");
    if (plan) return plan.base_fee;
  }
  return batch.price ?? null;
}

/** Students who belong to the batch on a date (active students only by default, BR-10). */
export async function regularEnrollmentsOn(batchId, on) {
  const rows = await BatchStudent.find({
    batch_id: batchId,
    status: { $in: ["active", "left"] },
    $and: [{ $or: [{ joined_on: null }, { joined_on: { $lte: on } }] }, { $or: [{ left_on: null }, { left_on: { $gt: on } }] }],
  }).sort({ _id: 1 });
  if (!rows.length) return [];
  const active = await StudentProfile.find({ _id: { $in: rows.map((r) => r.student_id) }, status: "active" }).select("_id");
  const ids = new Set(active.map((p) => String(p._id)));
  return rows.filter((r) => ids.has(String(r.student_id)));
}

export async function isRegular(batchId, studentId, on) {
  return (await regularEnrollmentsOn(batchId, on)).some((e) => String(e.student_id) === sid(studentId));
}

/** Regular students plus make-up bookings for a session. */
export async function sessionHeadcount(session) {
  const regulars = (await regularEnrollmentsOn(session.batch_id, session.session_date)).length;
  const makeups = await MakeupCredit.countDocuments({ booked_session_id: session._id, status: { $in: ["booked", "used"] } });
  return regulars + makeups;
}

/** Schedule rows in display order (Python orders BatchSchedule by weekday). */
export function orderedSchedules(schedules) {
  return [...(schedules ?? [])].sort((a, b) => a.weekday - b.weekday);
}

/** Yields [date, schedule] for every schedule occurrence in [start, end]. */
export function* scheduleOccurrences(schedules, start, end) {
  const rows = orderedSchedules(schedules);
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const wd = weekday(day);
    for (const sched of rows) {
      if (sched.weekday !== wd) continue;
      if (sched.effective_from && day < sched.effective_from) continue;
      if (sched.effective_to && day > sched.effective_to) continue;
      yield [day, sched];
    }
  }
}

export function countOccurrences(batch, start, end) {
  return [...scheduleOccurrences(batch.schedules, start, end)].length;
}

export function activeBatchCoaches(batch, on) {
  return batch.coaches.filter((c) => (!c.effective_from || c.effective_from <= on) && (!c.effective_to || c.effective_to >= on));
}

/** Create sessions from the recurring schedule. Idempotent: existing dates/times are skipped. */
export async function generateSessions(batch, start, end) {
  if (batch.status === "cancelled") throw new BusinessRuleError("Cannot generate sessions for a cancelled batch");
  if (!batch.schedules?.length) throw new BusinessRuleError("Add at least one schedule row before generating sessions", 400);
  let from = start;
  let to = end;
  if (batch.start_date) from = maxDate(from, batch.start_date);
  if (batch.end_date) to = minDate(to, batch.end_date);
  if (to < from) return [];
  if (daysBetween(from, to) > 400) throw new BusinessRuleError("Generate at most about a year of sessions at a time", 400);

  const existing = new Set(
    (await Session.find({ batch_id: batch._id, session_date: { $gte: from, $lte: to } }).select("session_date start_time")).map(
      (s) => `${s.session_date} ${normTime(s.start_time)}`,
    ),
  );
  const docs = [];
  for (const [day, sched] of scheduleOccurrences(batch.schedules, from, to)) {
    if (existing.has(`${day} ${normTime(sched.start_time)}`)) continue;
    const duration = minutesBetween(sched.start_time, sched.end_time) || batch.duration_minutes;
    docs.push({
      academy_id: batch.academy_id,
      batch_id: batch._id,
      schedule_id: sched._id,
      session_date: day,
      start_time: normTime(sched.start_time),
      end_time: normTime(sched.end_time),
      duration_minutes: duration,
      venue_id: sched.venue_id,
      courts_booked: sched.courts,
      status: "scheduled",
      coaches: activeBatchCoaches(batch, day).map((bc) => ({ coach_id: bc.coach_id, scheduled_hours: hoursBetween(duration) })),
    });
  }
  if (!docs.length) return [];
  return Session.insertMany(docs);
}

/**
 * Create a pending enrollment and its pending fee plan. Returns [enrollment, plan | null].
 *
 * The seat is held while pending; the enrollment becomes active when the admin verifies payment or
 * approves it directly.
 */
export async function enroll({
  batch,
  student,
  source,
  actorId = null,
  overrideCapacity = false,
  feePlanId = null,
  discountType = "none",
  discountValue = 0,
  startDate = null,
}) {
  if (batch.status === "completed" || batch.status === "cancelled") throw new BusinessRuleError("This batch is not accepting enrollments");
  if (student.status !== "active") throw new BusinessRuleError("Student account is inactive");
  const studentId = student._id;
  const duplicate = await BatchStudent.findOne({ batch_id: batch._id, student_id: studentId, status: { $in: SEAT_HOLDING_STATUSES } });
  if (duplicate) throw new BusinessRuleError("Already enrolled (or awaiting confirmation) in this batch");
  if (!overrideCapacity && (await seatsLeft(batch)) <= 0) throw new BusinessRuleError("This batch is full");

  const t = today();
  const start = startDate || maxDate(batch.start_date || t, t);
  const enrollment = await BatchStudent.create({
    batch_id: batch._id,
    student_id: studentId,
    status: "pending",
    joined_on: start,
    capacity_override: !!overrideCapacity,
    source,
  });

  let plan = null;
  const templateId = feePlanId || batch.fee_plan_id;
  const template = templateId ? await FeePlan.findById(templateId) : null;
  if (template) {
    plan = await ledger.planFromTemplate({
      academyId: batch.academy_id,
      studentId,
      feePlan: template,
      startDate: start,
      endDate: batch.end_date ?? null,
      batchId: batch._id,
      batchStudentId: enrollment._id,
      discountType,
      discountValue,
    });
  } else if (batch.price && batch.end_date) {
    const sessions = countOccurrences(batch, start, batch.end_date);
    if (sessions > 0) {
      plan = ledger.buildPlan({
        academyId: batch.academy_id,
        studentId,
        name: `${batch.name} (${batch.period_label || "batch fee"})`,
        baseFee: batch.price,
        sessionsIncluded: sessions,
        startDate: start,
        endDate: batch.end_date,
        discountType,
        discountValue,
        batchId: batch._id,
        batchStudentId: enrollment._id,
      });
      await plan.save();
    }
  }
  return [enrollment, plan];
}

/**
 * Confirm an enrollment without (or before) payment; its plan is billed and any dues show in the ledger.
 * Pending plans are loaded and activated here; re-read a plan you already hold.
 */
export async function approveEnrollment(enrollment, actorId) {
  if (enrollment.status !== "pending" && enrollment.status !== "active") {
    throw new BusinessRuleError(`Enrollment is ${enrollment.status}`);
  }
  enrollment.status = "active";
  enrollment.joined_on = enrollment.joined_on || today();
  await enrollment.save();
  const plans = await StudentFeePlan.find({ batch_student_id: enrollment._id, status: "pending" }).sort({ _id: 1 });
  for (const plan of plans) await ledger.activatePlan(plan, actorId);
}

/** Student leaves / enrollment cancelled or rejected. Frees the seat immediately for public listing. */
export async function endEnrollment(enrollment, status, leftOn, actorId) {
  if (!["left", "cancelled", "rejected"].includes(status)) throw new BusinessRuleError("Invalid status", 400);
  enrollment.status = status;
  enrollment.left_on = leftOn || today();
  await enrollment.save();
  if (status === "cancelled" || status === "rejected") {
    const plans = await StudentFeePlan.find({ batch_student_id: enrollment._id, status: "pending" }).sort({ _id: 1 });
    for (const plan of plans) await ledger.cancelPlan(plan, actorId);
  }
}

export async function upcomingSessionsForBatches(batchIds, days = 30, limit = 50) {
  const t = today();
  if (!batchIds.length) return [];
  return Session.find({ batch_id: { $in: batchIds }, session_date: { $gte: t, $lte: addDays(t, days) } })
    .sort({ session_date: 1, start_time: 1 })
    .limit(limit);
}
