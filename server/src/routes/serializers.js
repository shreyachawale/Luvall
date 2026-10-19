/** Response shapes for domain objects that several routers return. */
import {
  Batch,
  FeePlan,
  Program,
  Session,
  SessionAttendance,
  sid,
  StudentFeePlan,
  toJSON,
  User,
  Venue,
} from "../models/index.js";
import * as batchSvc from "../services/batches.js";
import * as ledger from "../services/ledger.js";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** An attribute of the document with that id (null when the id is empty or the document is gone). */
async function attr(Model, id, field = "name") {
  if (id === null || id === undefined) return null;
  const doc = await Model.findById(id).select(field);
  return doc ? (doc[field] ?? null) : null;
}

/** A batch schedule row with its weekday and venue names. */
export async function scheduleOut(s, batch = null) {
  const venue = await Venue.findById(s.venue_id).select("name city");
  const parent = batch ?? (typeof s.parent === "function" ? s.parent() : null);
  return {
    ...toJSON(s),
    batch_id: parent ? sid(parent) : null,
    weekday_name: WEEKDAYS[s.weekday],
    venue_name: venue ? venue.name : null,
    venue_city: venue ? (venue.city ?? null) : null,
  };
}

/** A batch with pricing, capacity, schedules and coaches. `isPublic` drops internal fields. */
export async function batchOut(b, taken = null, isPublic = false) {
  const seats = taken ?? (await batchSvc.seatCounts([b._id]))[sid(b)];
  const feePlan = b.fee_plan_id ? await FeePlan.findById(b.fee_plan_id) : null;
  const program = b.program_id ? await Program.findById(b.program_id).select("title slug") : null;
  const schedules = [];
  for (const s of batchSvc.orderedSchedules(b.schedules)) schedules.push(await scheduleOut(s, b));
  const coaches = [];
  for (const c of b.coaches ?? []) {
    const user = await User.findById(c.coach_id).select("name photo_url");
    coaches.push({
      coach_id: sid(c.coach_id),
      name: user ? user.name : null,
      role: c.role,
      photo_url: user ? (user.photo_url ?? null) : null,
    });
  }
  const data = {
    ...toJSON(b),
    program_title: program ? program.title : null,
    program_slug: program ? program.slug : null,
    fee_plan: feePlan
      ? {
          id: sid(feePlan),
          name: feePlan.name,
          base_fee: feePlan.base_fee,
          number_of_sessions: feePlan.number_of_sessions,
          plan_type: feePlan.plan_type,
        }
      : null,
    display_price: feePlan ? feePlan.base_fee : (b.price ?? null),
    seats_taken: seats,
    seats_left: Math.max(b.max_players - seats, 0),
    display_status: batchSvc.displayStatus(b, seats),
    schedules,
    coaches,
  };
  if (isPublic) {
    for (const key of ["academy_id", "created_at", "updated_at", "is_public", "fee_plan_id"]) delete data[key];
  }
  return data;
}

/** A session with batch/venue names and its coaches; `withCounts` adds present/absent/expected counts. */
export async function sessionOut(s, withCounts = false) {
  const batch = await Batch.findById(s.batch_id).select("name code");
  const venue = await Venue.findById(s.venue_id).select("name address map_url");
  const coaches = [];
  for (const c of s.coaches ?? []) {
    coaches.push({ ...toJSON(c), session_id: sid(s), name: await attr(User, c.coach_id) });
  }
  const data = {
    ...toJSON(s),
    batch_name: batch ? batch.name : null,
    batch_code: batch ? batch.code : null,
    venue_name: venue ? venue.name : null,
    venue_address: venue ? (venue.address ?? null) : null,
    venue_map_url: venue ? (venue.map_url ?? null) : null,
    coaches,
  };
  if (withCounts) {
    const statuses = (await SessionAttendance.find({ session_id: s._id }).select("attendance_status")).map((a) => a.attendance_status);
    data.present_count = statuses.filter((x) => x === "present").length;
    data.absent_count = statuses.filter((x) => x === "absent").length;
    data.expected_count = (await batchSvc.regularEnrollmentsOn(s.batch_id, s.session_date)).length;
  }
  return data;
}

/** A student fee plan with names and its package usage (pass `usage` from ledger.planUsage to avoid a query). */
export async function planOut(p, usage = null) {
  const u = usage ?? (await ledger.planUsage([p]))[sid(p)];
  return {
    ...toJSON(p),
    batch_name: await attr(Batch, p.batch_id),
    student_name: await attr(User, p.student_id),
    usage: { ...u },
  };
}

export async function paymentOut(p) {
  const plan = p.student_fee_plan_id ? await StudentFeePlan.findById(p.student_fee_plan_id) : null;
  const student = await User.findById(p.student_id).select("name mobile");
  return {
    ...toJSON(p),
    student_name: student ? student.name : null,
    student_mobile: student ? student.mobile : null,
    plan_name: plan ? plan.name : null,
    plan_final_fee: plan ? plan.final_fee : null,
    batch_name: plan ? await attr(Batch, plan.batch_id) : null,
    verified_by_name: await attr(User, p.verified_by_id),
  };
}

export function ledgerOut(t) {
  return toJSON(t);
}

/** Short session reference used inside other objects. */
export async function sessionBrief(s) {
  return {
    id: sid(s),
    session_date: s.session_date,
    start_time: s.start_time,
    end_time: s.end_time,
    batch_id: sid(s.batch_id),
    batch_name: await attr(Batch, s.batch_id),
    venue_name: await attr(Venue, s.venue_id),
    status: s.status,
  };
}

/** A make-up credit with the missed, booked and used sessions. */
export async function creditOut(c) {
  const missed = await Session.findById(c.missed_session_id).select("session_date");
  const booked = c.booked_session_id ? await Session.findById(c.booked_session_id) : null;
  let usedSession = null;
  if (c.used_attendance_id) {
    const att = await SessionAttendance.findById(c.used_attendance_id).select("session_id");
    usedSession = att ? await Session.findById(att.session_id) : null;
  }
  return {
    ...toJSON(c),
    student_name: await attr(User, c.student_id),
    original_batch_name: await attr(Batch, c.original_batch_id),
    missed_session_date: missed ? missed.session_date : null,
    booked_session: booked ? await sessionBrief(booked) : null,
    used_session: usedSession ? await sessionBrief(usedSession) : null,
  };
}

/** All of a student's plans (newest first) with usage. */
export async function studentPlans(studentId) {
  const plans = await StudentFeePlan.find({ student_id: studentId }).sort({ start_date: -1, _id: -1 });
  const usage = await ledger.planUsage(plans);
  const out = [];
  for (const p of plans) out.push(await planOut(p, usage[sid(p)]));
  return out;
}
