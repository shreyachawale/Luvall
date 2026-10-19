/** Admin: venues & rates, batches, enrollment, sessions and make-ups. */
import express from "express";

import { adminOnly } from "../middleware/auth.js";
import {
  Batch,
  BatchStudent,
  CoachProfile,
  FeePlan,
  MakeupCredit,
  oid,
  Payment,
  Program,
  sameId,
  Session,
  SessionAttendance,
  sid,
  StudentFeePlan,
  StudentProfile,
  toJSON,
  User,
  Venue,
} from "../models/index.js";
import { isObjectId } from "../models/plugins.js";
import * as attSvc from "../services/attendance.js";
import { snapshot } from "../services/audit.js";
import * as batchSvc from "../services/batches.js";
import * as makeups from "../services/makeups.js";
import * as rates from "../services/rates.js";
import { today } from "../utils/clock.js";
import { addDays } from "../utils/dates.js";
import { BusinessRuleError, NotFoundError } from "../utils/errors.js";
import { read, write } from "../utils/http.js";
import { hoursBetween, q } from "../utils/money.js";
import { opt, parseBody, parseQuery, z, zBool, zDate, zId, zInt, zTime } from "../utils/validate.js";
import { applyUpdates, getOr404, ilike, log, pageOut } from "./common.js";
import { batchOut, creditOut, sessionOut } from "./serializers.js";

const router = express.Router();

// ---- Validation helpers (Pydantic semantics) ----------------------------------------------------------------

/** A JSON number (Pydantic also accepts a numeric string); null is rejected unless wrapped in opt(). */
const number = (schema = z.number().finite()) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v), schema);
const int = (min = null, max = null) => {
  let s = z.number().int();
  if (min !== null) s = s.min(min);
  if (max !== null) s = s.max(max);
  return number(s);
};
const money = (min = null) => number(min === null ? z.number().finite() : z.number().finite().min(min));
const pattern = (re) => z.string().regex(re, `String should match pattern '${re.source}'`);
const zOid = zId.transform((v) => v.toLowerCase());

function paging(query, maxSize) {
  const page = Math.max(query.page, 1);
  const pageSize = Math.min(Math.max(query.page_size, 1), maxSize);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

const byNewest = (rows) => [...rows].sort((a, b) => (a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : 0));
const actorOf = (req) => req.principal.user._id;

// --- Venues --------------------------------------------------------------------------------------------------

const VENUE_STATUS = /^(active|inactive)$/;

const VenueIn = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(2).max(200),
  address: opt(z.string().max(1000)),
  city: opt(z.string().max(100)),
  map_url: opt(z.string().max(500)),
  owner_name: opt(z.string().max(200)),
  contact_no: opt(z.string().max(20)),
  courts_available: int(0, 100).default(1),
  description: opt(z.string().max(3000)),
  photo_url: opt(z.string().max(500)),
  amenities: opt(z.string().max(500)),
  is_public: z.boolean().default(true),
  status: pattern(VENUE_STATUS).default("active"),
});

const VenuePatch = z.object({
  code: opt(z.string().min(1).max(30)),
  name: opt(z.string().min(2).max(200)),
  address: opt(z.string().max(1000)),
  city: opt(z.string().max(100)),
  map_url: opt(z.string().max(500)),
  owner_name: opt(z.string().max(200)),
  contact_no: opt(z.string().max(20)),
  courts_available: opt(int(0, 100)),
  description: opt(z.string().max(3000)),
  photo_url: opt(z.string().max(500)),
  amenities: opt(z.string().max(500)),
  is_public: opt(z.boolean()),
  status: opt(pattern(VENUE_STATUS)),
});

/** A venue with the four rates in force today; `history` adds every effective-dated rate row (newest first). */
async function venueOut(v, history = false) {
  const data = { ...toJSON(v), current_rates: await rates.currentVenueRates(v, today()) };
  delete data.rates;
  if (history) data.rates = byNewest(v.rates).map((r) => ({ ...toJSON(r), venue_id: sid(v) }));
  return data;
}

const VenuesQuery = z.object({ include_inactive: zBool.default(true) });

router.get(
  "/admin/venues",
  adminOnly,
  read(async (req) => {
    const { include_inactive: includeInactive } = parseQuery(VenuesQuery, req);
    const filter = { academy_id: req.academy._id };
    if (!includeInactive) filter.status = "active";
    const out = [];
    for (const v of await Venue.find(filter).sort({ name: 1, _id: 1 })) out.push(await venueOut(v));
    return out;
  }),
);

router.post(
  "/admin/venues",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(VenueIn, req);
    if (await Venue.exists({ academy_id: req.academy._id, code: body.code })) {
      throw new BusinessRuleError("A venue with this code already exists");
    }
    const v = await Venue.create({ academy_id: req.academy._id, ...body });
    await log(req, "venue", v._id, "create", `Created venue ${v.name}`, null, snapshot(v));
    res.status(201);
    return venueOut(v, true);
  }),
);

router.get(
  "/admin/venues/:venue_id",
  adminOnly,
  read(async (req) => venueOut(await getOr404(Venue, req.params.venue_id, req.academy._id), true)),
);

router.patch(
  "/admin/venues/:venue_id",
  adminOnly,
  write(async (req) => {
    const data = parseBody(VenuePatch, req);
    const v = await getOr404(Venue, req.params.venue_id, req.academy._id);
    const [old, neu] = applyUpdates(v, data);
    await v.save();
    await log(req, "venue", v._id, "update", `Updated venue ${v.name}`, old, neu);
    return venueOut(v, true);
  }),
);

const RATE_SLOTS = ["weekday_morning", "weekday_evening", "weekend_morning", "weekend_evening"];

/** Set any of the four default rate slots from a date. Omitted slots keep their current rate. */
const VenueRatesIn = z.object({
  effective_from: zDate,
  weekday_morning: opt(money(0)),
  weekday_evening: opt(money(0)),
  weekend_morning: opt(money(0)),
  weekend_evening: opt(money(0)),
});

router.post(
  "/admin/venues/:venue_id/rates",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(VenueRatesIn, req);
    const v = await getOr404(Venue, req.params.venue_id, req.academy._id);
    const changed = {};
    for (const key of RATE_SLOTS) {
      const value = body[key];
      if (value !== null && value !== undefined) {
        const [dayType, slot] = key.split("_");
        await rates.setVenueRate(v, dayType, slot, value, body.effective_from);
        changed[key] = String(value);
      }
    }
    if (!Object.keys(changed).length) throw new BusinessRuleError("Enter at least one rate", 400);
    await log(req, "venue_rate", v._id, "set", `Venue ${v.name} rates from ${body.effective_from}`, null, changed);
    res.status(201);
    return venueOut(await Venue.findById(v._id), true);
  }),
);

router.delete(
  "/admin/venues/:venue_id/rates/:rate_id",
  adminOnly,
  write(async (req) => {
    const { venue_id: venueId, rate_id: rateId } = req.params;
    const v = isObjectId(venueId) ? await Venue.findById(venueId) : null;
    const r = v && sameId(v.academy_id, req.academy._id) && isObjectId(rateId) ? v.rates.id(rateId) : null;
    if (!r) throw new NotFoundError("Rate not found");
    await log(req, "venue_rate", rateId, "delete", "Deleted venue rate", { ...snapshot(r), venue_id: sid(v) });
    v.rates.pull(r._id);
    await v.save();
  }),
);

// --- Batches -------------------------------------------------------------------------------------------------

const BATCH_STATUS = /^(upcoming|active|completed|cancelled)$/;

const ScheduleIn = z
  .object({
    weekday: int(0, 6),
    start_time: zTime,
    end_time: zTime,
    venue_id: zOid,
    courts: int(0, 50).default(1),
    effective_from: opt(zDate),
    effective_to: opt(zDate),
  })
  .refine((s) => s.end_time > s.start_time, { message: "Value error, Schedule end time must be after start time" });

const CoachAssignIn = z.object({ coach_id: zOid, role: pattern(/^(lead|assistant)$/).default("lead") });

const BatchIn = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(2).max(200),
  program_id: opt(zOid),
  skill_level: opt(z.string().max(30)),
  period_label: z.string().max(30).default(""),
  start_date: opt(zDate),
  end_date: opt(zDate),
  duration_minutes: int(15, 600).default(60),
  min_players: opt(int(1, 100)),
  max_players: opt(int(1, 100)),
  fee_plan_id: opt(zOid),
  price: opt(money(0)),
  description: opt(z.string().max(3000)),
  is_public: z.boolean().default(true),
  status: pattern(BATCH_STATUS).default("upcoming"),
  schedules: z.array(ScheduleIn).default([]),
  coaches: z.array(CoachAssignIn).default([]),
});

const BatchPatch = z.object({
  code: opt(z.string().min(1).max(30)),
  name: opt(z.string().min(2).max(200)),
  program_id: opt(zOid),
  skill_level: opt(z.string().max(30)),
  period_label: opt(z.string().max(30)),
  start_date: opt(zDate),
  end_date: opt(zDate),
  duration_minutes: opt(int(15, 600)),
  min_players: opt(int(1, 100)),
  max_players: opt(int(1, 100)),
  fee_plan_id: opt(zOid),
  price: opt(money(0)),
  description: opt(z.string().max(3000)),
  is_public: opt(z.boolean()),
  status: opt(pattern(BATCH_STATUS)),
});

/** Capacity, dates and linked records of a batch create/update (`batch` is null when creating). */
async function validateBatch(academyId, data, batch) {
  const pick = (key) => (Object.hasOwn(data, key) ? data[key] : batch ? batch[key] : null);
  const mn = pick("min_players");
  const mx = pick("max_players");
  if (mn && mx && mn > mx) throw new BusinessRuleError("Minimum players cannot exceed maximum players", 400);
  const sd = pick("start_date");
  const ed = pick("end_date");
  if (sd && ed && ed < sd) throw new BusinessRuleError("Batch end date is before its start date", 400);
  if (data.program_id) await getOr404(Program, data.program_id, academyId);
  if (data.fee_plan_id) await getOr404(FeePlan, data.fee_plan_id, academyId);
  if (batch && mx !== null && mx !== undefined && Object.hasOwn(data, "max_players")) {
    const taken = (await batchSvc.seatCounts([batch._id]))[sid(batch)];
    if (mx < taken) throw new BusinessRuleError(`${taken} students are enrolled; capacity cannot go below that`, 400);
  }
}

/** Replace the weekly schedule rows (not saved). Returns the ids of the rows that were removed. */
async function setSchedules(academyId, batch, schedules) {
  for (const s of schedules) await getOr404(Venue, s.venue_id, academyId);
  const removed = batch.schedules.map((s) => s._id);
  batch.schedules = schedules.map((s) => ({
    weekday: s.weekday,
    start_time: s.start_time,
    end_time: s.end_time,
    venue_id: s.venue_id,
    courts: s.courts,
    effective_from: s.effective_from ?? null,
    effective_to: s.effective_to ?? null,
  }));
  return removed;
}

/** Replace the batch coaches (not saved). */
async function setCoaches(academyId, batch, coaches) {
  if (new Set(coaches.map((c) => c.coach_id)).size !== coaches.length) throw new BusinessRuleError("A coach is listed twice", 400);
  for (const c of coaches) await getOr404(CoachProfile, c.coach_id, academyId);
  batch.coaches = coaches.map((c) => ({ coach_id: c.coach_id, role: c.role }));
}

/** Sessions keep their schedule_id only while the schedule row exists (ON DELETE SET NULL). */
async function detachSessions(batch, scheduleIds) {
  if (!scheduleIds.length) return;
  await Session.updateMany({ batch_id: batch._id, schedule_id: { $in: scheduleIds } }, { $set: { schedule_id: null } });
}

const BatchesQuery = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  coach_id: zOid.optional(),
  venue_id: zOid.optional(),
});

router.get(
  "/admin/batches",
  adminOnly,
  read(async (req) => {
    const query = parseQuery(BatchesQuery, req);
    const filter = { academy_id: req.academy._id };
    if (query.status) filter.status = query.status;
    if (query.q) filter.$or = [{ name: ilike(query.q) }, { code: ilike(query.q) }];
    if (query.coach_id) filter["coaches.coach_id"] = oid(query.coach_id);
    if (query.venue_id) filter["schedules.venue_id"] = oid(query.venue_id);
    // Status, then newest start date first (batches without one last), then name.
    const batches = await Batch.find(filter).sort({ status: 1, start_date: -1, name: 1, _id: 1 });
    const ids = batches.map((b) => b._id);
    const taken = await batchSvc.seatCounts(ids);
    const pending = {};
    if (ids.length) {
      const rows = await BatchStudent.aggregate([
        { $match: { batch_id: { $in: ids }, status: "pending" } },
        { $group: { _id: "$batch_id", n: { $sum: 1 } } },
      ]);
      for (const r of rows) pending[String(r._id)] = r.n;
    }
    const out = [];
    for (const b of batches) out.push({ ...(await batchOut(b, taken[sid(b)])), pending_enrollments: pending[sid(b)] ?? 0 });
    return out;
  }),
);

router.post(
  "/admin/batches",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(BatchIn, req);
    const academyId = req.academy._id;
    const { schedules, coaches, ...data } = body;
    data.min_players = data.min_players || req.rules.default_min_players;
    data.max_players = data.max_players || req.rules.default_max_players;
    if (data.price !== null && data.price !== undefined) data.price = q(data.price);
    await validateBatch(academyId, data, null);
    if (await Batch.exists({ academy_id: academyId, code: body.code, period_label: body.period_label })) {
      throw new BusinessRuleError("A batch with this code already exists for that period");
    }
    const batch = new Batch({ academy_id: academyId, ...data });
    await setSchedules(academyId, batch, schedules);
    await setCoaches(academyId, batch, coaches);
    await batch.save();
    await log(req, "batch", batch._id, "create", `Created batch ${batch.name}`, null, body);
    res.status(201);
    return batchOut(batch);
  }),
);

/** Enrolled students with their latest plan and any UPI payment awaiting verification. */
async function enrollmentRows(batch) {
  const enrollments = await BatchStudent.find({ batch_id: batch._id }).sort({ _id: 1 });
  const users = new Map();
  if (enrollments.length) {
    for (const u of await User.find({ _id: { $in: enrollments.map((e) => e.student_id) } }).select("name mobile")) {
      users.set(String(u._id), u);
    }
  }
  const rows = enrollments
    .filter((e) => users.has(String(e.student_id)))
    .map((e) => [e, users.get(String(e.student_id))])
    .sort(([a, ua], [b, ub]) => (a.status < b.status ? -1 : a.status > b.status ? 1 : ua.name < ub.name ? -1 : ua.name > ub.name ? 1 : 0));
  const out = [];
  for (const [e, u] of rows) {
    const plan = await StudentFeePlan.findOne({ batch_student_id: e._id }).sort({ _id: -1 });
    const pendingPayment = plan
      ? await Payment.findOne({ student_id: u._id, status: "pending", student_fee_plan_id: plan._id }).sort({ _id: 1 })
      : null;
    out.push({
      ...toJSON(e),
      student_name: u.name,
      student_mobile: u.mobile,
      plan: plan ? { id: sid(plan), name: plan.name, final_fee: plan.final_fee, status: plan.status } : null,
      pending_payment: pendingPayment
        ? { id: sid(pendingPayment), amount: pendingPayment.amount, reference_no: pendingPayment.reference_no ?? null }
        : null,
    });
  }
  return out;
}

router.get(
  "/admin/batches/:batch_id",
  adminOnly,
  read(async (req) => {
    const b = await getOr404(Batch, req.params.batch_id, req.academy._id);
    const sessions = await Session.find({ batch_id: b._id, session_date: { $gte: addDays(today(), -30) } })
      .sort({ session_date: 1, start_time: 1 })
      .limit(80);
    const sessionRows = [];
    for (const s of sessions) sessionRows.push(await sessionOut(s, true));
    const counts = {};
    for (const r of await Session.aggregate([{ $match: { batch_id: b._id } }, { $group: { _id: "$status", n: { $sum: 1 } } }])) {
      counts[r._id] = r.n;
    }
    const last = await Session.findOne({ batch_id: b._id }).sort({ session_date: -1 }).select("session_date");
    return {
      ...(await batchOut(b)),
      enrollments: await enrollmentRows(b),
      sessions: sessionRows,
      session_counts: counts,
      last_session_date: last ? last.session_date : null,
    };
  }),
);

router.patch(
  "/admin/batches/:batch_id",
  adminOnly,
  write(async (req) => {
    const data = parseBody(BatchPatch, req);
    const b = await getOr404(Batch, req.params.batch_id, req.academy._id);
    await validateBatch(req.academy._id, data, b);
    if (data.price !== null && data.price !== undefined) data.price = q(data.price);
    const [old, neu] = applyUpdates(b, data);
    await b.save();
    await log(req, "batch", b._id, "update", `Updated batch ${b.name}`, old, neu);
    return batchOut(b);
  }),
);

router.put(
  "/admin/batches/:batch_id/schedules",
  adminOnly,
  write(async (req) => {
    const body = parseBody(z.array(ScheduleIn), req);
    const b = await getOr404(Batch, req.params.batch_id, req.academy._id);
    const old = b.schedules.map((s) => snapshot(s));
    const removed = await setSchedules(req.academy._id, b, body);
    await b.save();
    await detachSessions(b, removed);
    await log(req, "batch", b._id, "set_schedules", `Updated schedule for ${b.name}`, { schedules: old }, { schedules: body });
    return batchOut(await Batch.findById(b._id));
  }),
);

const CoachesQuery = z.object({ apply_to_future_sessions: zBool.default(true) });

/** Replace the batch coaches; by default upcoming scheduled sessions get the same coaches. */
router.put(
  "/admin/batches/:batch_id/coaches",
  adminOnly,
  write(async (req) => {
    const { apply_to_future_sessions: applyToFuture } = parseQuery(CoachesQuery, req);
    const body = parseBody(z.array(CoachAssignIn), req);
    const b = await getOr404(Batch, req.params.batch_id, req.academy._id);
    const oldIds = b.coaches.map((c) => sid(c.coach_id));
    await setCoaches(req.academy._id, b, body);
    await b.save();
    if (applyToFuture) {
      const newIds = body.map((c) => c.coach_id);
      const sessions = await Session.find({ batch_id: b._id, status: "scheduled", session_date: { $gte: today() } }).sort({
        session_date: 1,
        start_time: 1,
      });
      for (const s of sessions) {
        for (const sc of [...s.coaches]) {
          if (!newIds.includes(sid(sc.coach_id))) s.coaches.pull(sc._id);
        }
        const have = new Set(s.coaches.map((sc) => sid(sc.coach_id)));
        for (const cid of newIds) {
          if (!have.has(cid)) s.coaches.push({ coach_id: cid, scheduled_hours: hoursBetween(s.duration_minutes) });
        }
        await s.save();
      }
    }
    await log(req, "batch", b._id, "set_coaches", `Updated coaches for ${b.name}`, { coaches: oldIds }, {
      coaches: body.map((c) => c.coach_id),
    });
    return batchOut(await Batch.findById(b._id));
  }),
);

const GenerateIn = z.object({ start: opt(zDate), end: opt(zDate) });

router.post(
  "/admin/batches/:batch_id/generate-sessions",
  adminOnly,
  write(async (req) => {
    const body = parseBody(GenerateIn, req);
    const b = await getOr404(Batch, req.params.batch_id, req.academy._id);
    const start = body.start || b.start_date || today();
    const end = body.end || b.end_date || addDays(start, 27);
    const created = await batchSvc.generateSessions(b, start, end);
    await log(req, "batch", b._id, "generate_sessions", `Generated ${created.length} sessions for ${b.name} (${start} – ${end})`);
    return { created: created.length, start, end };
  }),
);

const DuplicateIn = z.object({
  period_label: z.string().min(1).max(30),
  start_date: zDate,
  end_date: opt(zDate),
  copy_students: z.boolean().default(true),
  generate_sessions: z.boolean().default(true),
});

const DUPLICATED_FIELDS = [
  "code",
  "name",
  "program_id",
  "skill_level",
  "duration_minutes",
  "min_players",
  "max_players",
  "fee_plan_id",
  "price",
  "description",
  "is_public",
];

/** Roll a batch over to the next period, optionally re-enrolling its current students (pending). */
router.post(
  "/admin/batches/:batch_id/duplicate",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(DuplicateIn, req);
    const src = await getOr404(Batch, req.params.batch_id, req.academy._id);
    if (await Batch.exists({ academy_id: src.academy_id, code: src.code, period_label: body.period_label })) {
      throw new BusinessRuleError("This batch already exists for that period");
    }
    const created = new Batch({
      academy_id: src.academy_id,
      period_label: body.period_label,
      start_date: body.start_date,
      end_date: body.end_date ?? null,
      status: "upcoming",
      ...Object.fromEntries(DUPLICATED_FIELDS.map((f) => [f, src[f] ?? null])),
      schedules: batchSvc.orderedSchedules(src.schedules).map((s) => ({
        weekday: s.weekday,
        start_time: s.start_time,
        end_time: s.end_time,
        venue_id: s.venue_id,
        courts: s.courts,
      })),
      coaches: src.coaches.map((c) => ({ coach_id: c.coach_id, role: c.role })),
    });
    await created.save();
    let copied = 0;
    if (body.copy_students) {
      for (const e of await batchSvc.regularEnrollmentsOn(src._id, today())) {
        const profile = await StudentProfile.findById(e.student_id);
        try {
          await batchSvc.enroll({ batch: created, student: profile, source: "admin", actorId: actorOf(req), startDate: body.start_date });
          copied += 1;
        } catch (exc) {
          if (!(exc instanceof BusinessRuleError)) throw exc;
        }
      }
    }
    let generated = 0;
    if (body.generate_sessions && body.end_date) {
      generated = (await batchSvc.generateSessions(created, body.start_date, body.end_date)).length;
    }
    await log(
      req,
      "batch",
      created._id,
      "duplicate",
      `Created ${created.name} ${body.period_label} from batch ${sid(src)}; ${copied} students, ${generated} sessions`,
    );
    res.status(201);
    return { id: sid(created), students_copied: copied, sessions_generated: generated };
  }),
);

// --- Enrollments ---------------------------------------------------------------------------------------------

const EnrollIn = z.object({
  student_id: zOid,
  override_capacity: z.boolean().default(false),
  fee_plan_id: opt(zOid),
  discount_type: pattern(/^(none|fixed|percent)$/).default("none"),
  discount_value: money(0).default(0),
  start_date: opt(zDate),
  activate: z.boolean().default(true),
});

router.post(
  "/admin/batches/:batch_id/enrollments",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(EnrollIn, req);
    const b = await getOr404(Batch, req.params.batch_id, req.academy._id);
    const profile = await getOr404(StudentProfile, body.student_id, req.academy._id);
    const [enrollment, plan] = await batchSvc.enroll({
      batch: b,
      student: profile,
      source: "admin",
      actorId: actorOf(req),
      overrideCapacity: body.override_capacity,
      feePlanId: body.fee_plan_id ?? null,
      discountType: body.discount_type,
      discountValue: body.discount_value,
      startDate: body.start_date ?? null,
    });
    if (body.activate) await batchSvc.approveEnrollment(enrollment, actorOf(req));
    const user = await User.findById(profile._id).select("name");
    await log(
      req,
      "batch_student",
      enrollment._id,
      "admin_enroll",
      `Enrolled ${user?.name} in ${b.name}${body.override_capacity ? " (capacity override)" : ""}`,
    );
    res.status(201);
    const freshPlan = plan ? await StudentFeePlan.findById(plan._id) : null;
    return { enrollment: toJSON(await BatchStudent.findById(enrollment._id)), plan: freshPlan ? toJSON(freshPlan) : null };
  }),
);

/** The enrollment with this id in a batch of this academy, or 404 "Enrollment not found". */
async function enrollmentOr404(req) {
  const id = req.params.enrollment_id;
  const e = isObjectId(id) ? await BatchStudent.findById(id) : null;
  const batch = e ? await Batch.findById(e.batch_id).select("academy_id") : null;
  if (!e || !batch || !sameId(batch.academy_id, req.academy._id)) throw new NotFoundError("Enrollment not found");
  return e;
}

router.post(
  "/admin/enrollments/:enrollment_id/approve",
  adminOnly,
  write(async (req) => {
    const e = await enrollmentOr404(req);
    await batchSvc.approveEnrollment(e, actorOf(req));
    await log(req, "batch_student", e._id, "approve", "Approved enrollment");
    return toJSON(await BatchStudent.findById(e._id));
  }),
);

const EndEnrollmentIn = z.object({
  status: pattern(/^(left|cancelled|rejected)$/),
  left_on: opt(zDate),
  notes: opt(z.string().max(500)),
});

router.post(
  "/admin/enrollments/:enrollment_id/end",
  adminOnly,
  write(async (req) => {
    const body = parseBody(EndEnrollmentIn, req);
    const e = await enrollmentOr404(req);
    await batchSvc.endEnrollment(e, body.status, body.left_on ?? null, actorOf(req));
    if (body.notes) {
      e.notes = body.notes;
      await e.save();
    }
    await log(req, "batch_student", e._id, body.status, `Enrollment ${body.status}`);
    return toJSON(await BatchStudent.findById(e._id));
  }),
);

// --- Sessions ------------------------------------------------------------------------------------------------

const SessionsQuery = z.object({
  start: zDate.optional(),
  end: zDate.optional(),
  batch_id: zOid.optional(),
  venue_id: zOid.optional(),
  coach_id: zOid.optional(),
  status: z.string().optional(),
  page: zInt.default(1),
  page_size: zInt.default(100),
});

router.get(
  "/admin/sessions",
  adminOnly,
  read(async (req) => {
    const query = parseQuery(SessionsQuery, req);
    const t = today();
    const start = query.start || addDays(t, -7);
    const end = query.end || addDays(t, 21);
    const filter = { academy_id: req.academy._id, session_date: { $gte: start, $lte: end } };
    if (query.batch_id) filter.batch_id = oid(query.batch_id);
    if (query.venue_id) filter.venue_id = oid(query.venue_id);
    if (query.status) filter.status = query.status;
    if (query.coach_id) filter["coaches.coach_id"] = oid(query.coach_id);
    const total = await Session.countDocuments(filter);
    const { page, pageSize, skip } = paging(query, 300);
    const sessions = await Session.find(filter).sort({ session_date: 1, start_time: 1, _id: 1 }).skip(skip).limit(pageSize);
    const items = [];
    for (const s of sessions) items.push(await sessionOut(s, true));
    return pageOut(items, total, page, pageSize);
  }),
);

const SessionIn = z.object({
  batch_id: zOid,
  session_date: zDate,
  start_time: zTime,
  end_time: zTime,
  venue_id: zOid,
  courts_booked: int(0, 50).default(1),
  coach_ids: z.array(zOid).default([]),
  remarks: opt(z.string().max(2000)),
});

/** Add a one-off session (extra class, rescheduled class) outside the recurring schedule. */
router.post(
  "/admin/sessions",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(SessionIn, req);
    const b = await getOr404(Batch, body.batch_id, req.academy._id);
    await getOr404(Venue, body.venue_id, req.academy._id);
    const minutes = batchSvc.minutesBetween(body.start_time, body.end_time);
    if (minutes <= 0) throw new BusinessRuleError("End time must be after start time", 400);
    if (await Session.exists({ batch_id: b._id, session_date: body.session_date, start_time: body.start_time })) {
      throw new BusinessRuleError("A session already exists at that date and time");
    }
    const coachIds = body.coach_ids.length
      ? [...new Set(body.coach_ids)]
      : batchSvc.activeBatchCoaches(b, body.session_date).map((c) => sid(c.coach_id));
    const coaches = [];
    for (const cid of coachIds) {
      await getOr404(CoachProfile, cid, req.academy._id);
      coaches.push({ coach_id: cid, scheduled_hours: hoursBetween(minutes) });
    }
    const s = await Session.create({
      academy_id: b.academy_id,
      batch_id: b._id,
      session_date: body.session_date,
      start_time: body.start_time,
      end_time: body.end_time,
      duration_minutes: minutes,
      venue_id: body.venue_id,
      courts_booked: body.courts_booked,
      remarks: body.remarks ?? null,
      status: "scheduled",
      coaches,
    });
    await log(req, "session", s._id, "create", `Added session ${b.name} ${body.session_date}`);
    res.status(201);
    return sessionOut(s);
  }),
);

const SessionPatch = z.object({
  session_date: opt(zDate),
  start_time: opt(zTime),
  end_time: opt(zTime),
  venue_id: opt(zOid),
  courts_booked: opt(int(0, 50)),
  venue_charge_applies: opt(z.boolean()),
  remarks: opt(z.string().max(2000)),
});

router.patch(
  "/admin/sessions/:session_id",
  adminOnly,
  write(async (req) => {
    const data = parseBody(SessionPatch, req);
    const s = await getOr404(Session, req.params.session_id, req.academy._id);
    if (s.status !== "scheduled" && Object.hasOwn(data, "session_date") && data.session_date !== s.session_date) {
      throw new BusinessRuleError("Only scheduled sessions can be moved to another date");
    }
    if (Object.hasOwn(data, "venue_id")) await getOr404(Venue, data.venue_id, req.academy._id);
    const previousDate = s.session_date;
    const [old, neu] = applyUpdates(s, data);
    if (Object.hasOwn(data, "start_time") || Object.hasOwn(data, "end_time")) {
      const minutes = batchSvc.minutesBetween(s.start_time, s.end_time);
      if (minutes <= 0) throw new BusinessRuleError("End time must be after start time", 400);
      s.duration_minutes = minutes;
      for (const sc of s.coaches) sc.scheduled_hours = hoursBetween(minutes);
    }
    await s.save();
    if (s.session_date !== previousDate) {
      await SessionAttendance.updateMany({ session_id: s._id }, { $set: { session_date: s.session_date } });
    }
    if (s.status !== "scheduled") {
      await attSvc.snapshotVenue(s, req.rules, Object.hasOwn(data, "venue_id"));
      await attSvc.computeCoachPayables(s);
    }
    await log(req, "session", s._id, "update", `Updated session ${s.session_date}`, old, neu);
    return sessionOut(s);
  }),
);

const SessionCoachIn = z.object({
  coach_id: zOid,
  hours_coached: opt(number(z.number().finite().min(0).max(24))),
  rate_applied: opt(money(0)),
  adjustment_amount: money().default(0),
  adjustment_note: opt(z.string().max(300)),
});

/** Swap/add coaches for one session, or correct hours, applied rate and adjustments. */
router.put(
  "/admin/sessions/:session_id/coaches",
  adminOnly,
  write(async (req) => {
    const body = parseBody(z.array(SessionCoachIn), req);
    const s = await getOr404(Session, req.params.session_id, req.academy._id);
    const wanted = body.map((c) => c.coach_id);
    if (body.length > 4 || new Set(wanted).size !== body.length) throw new BusinessRuleError("List each coach once", 400);
    const old = s.coaches.map((c) => snapshot(c));
    for (const c of [...s.coaches]) {
      if (!wanted.includes(sid(c.coach_id))) s.coaches.pull(c._id);
    }
    for (const item of body) {
      await getOr404(CoachProfile, item.coach_id, req.academy._id);
      let sc = s.coaches.find((c) => sid(c.coach_id) === item.coach_id);
      if (!sc) {
        s.coaches.push({ coach_id: item.coach_id, scheduled_hours: hoursBetween(s.duration_minutes) });
        sc = s.coaches[s.coaches.length - 1];
      }
      if (item.hours_coached !== null && item.hours_coached !== undefined) sc.hours_coached = q(item.hours_coached);
      if (item.rate_applied !== null && item.rate_applied !== undefined) sc.rate_applied = q(item.rate_applied);
      sc.adjustment_amount = q(item.adjustment_amount);
      sc.adjustment_note = item.adjustment_note ?? null;
    }
    await s.save();
    if (s.status !== "scheduled") await attSvc.computeCoachPayables(s);
    await log(req, "session", s._id, "set_coaches", `Updated coaches for session ${s.session_date}`, { coaches: old }, {
      coaches: body,
    });
    return sessionOut(s);
  }),
);

const CancelIn = z.object({
  reason: opt(z.string().max(300)),
  adjustment: opt(pattern(/^(refund|carry_forward|no_adjustment)$/)),
  venue_charge_applies: z.boolean().default(false),
});

router.post(
  "/admin/sessions/:session_id/cancel",
  adminOnly,
  write(async (req) => {
    const body = parseBody(CancelIn, req);
    const s = await getOr404(Session, req.params.session_id, req.academy._id);
    await attSvc.cancelSession(s, {
      reason: body.reason ?? null,
      adjustment: body.adjustment || req.rules.default_cancellation_adjustment,
      venueChargeApplies: body.venue_charge_applies,
      rules: req.rules,
      actorId: actorOf(req),
    });
    const batch = await Batch.findById(s.batch_id).select("name");
    await log(
      req,
      "session",
      s._id,
      "cancel",
      `Cancelled ${batch?.name} ${s.session_date}: ${body.reason || ""} (${s.cancellation_adjustment})`,
    );
    return sessionOut(s);
  }),
);

router.post(
  "/admin/sessions/:session_id/reinstate",
  adminOnly,
  write(async (req) => {
    const s = await getOr404(Session, req.params.session_id, req.academy._id);
    await attSvc.reinstateSession(s, actorOf(req));
    await log(req, "session", s._id, "reinstate", `Reinstated session ${s.session_date}`);
    return sessionOut(s);
  }),
);

/** Re-apply the configured coach and venue rates (e.g. after a rate was entered late). */
router.post(
  "/admin/sessions/:session_id/refresh-rates",
  adminOnly,
  write(async (req) => {
    const s = await getOr404(Session, req.params.session_id, req.academy._id);
    if (s.status === "scheduled") throw new BusinessRuleError("Rates are applied when the session is recorded");
    const old = { venue_rate: s.venue_rate_applied, coach_rates: s.coaches.map((c) => c.rate_applied) };
    await attSvc.snapshotVenue(s, req.rules, true);
    await attSvc.computeCoachPayables(s, true);
    await log(req, "session", s._id, "refresh_rates", "Re-applied rates", old, {
      venue_rate: s.venue_rate_applied,
      coach_rates: s.coaches.map((c) => c.rate_applied),
    });
    return sessionOut(s);
  }),
);

router.delete(
  "/admin/sessions/:session_id",
  adminOnly,
  write(async (req) => {
    const s = await getOr404(Session, req.params.session_id, req.academy._id);
    if (s.status !== "scheduled" || (await SessionAttendance.exists({ session_id: s._id }))) {
      throw new BusinessRuleError("Only scheduled sessions without attendance can be deleted; cancel it instead");
    }
    for (const credit of await MakeupCredit.find({ booked_session_id: s._id }).sort({ _id: 1 })) await makeups.release(credit);
    await log(req, "session", s._id, "delete", `Deleted session ${s.session_date}`, snapshot(s));
    await s.deleteOne();
  }),
);

// --- Make-ups ------------------------------------------------------------------------------------------------

const MakeupsQuery = z.object({
  status: z.string().optional(),
  student_id: zOid.optional(),
  page: zInt.default(1),
  page_size: zInt.default(50),
});

/** Make-up credits with per-status counts; credits past their expiry are expired first. */
router.get(
  "/admin/makeups",
  adminOnly,
  write(async (req) => {
    const query = parseQuery(MakeupsQuery, req);
    const academyId = req.academy._id;
    await makeups.expireDue(academyId);
    const filter = { academy_id: academyId };
    if (query.status) filter.status = query.status;
    if (query.student_id) filter.student_id = oid(query.student_id);
    const total = await MakeupCredit.countDocuments(filter);
    const counts = {};
    for (const r of await MakeupCredit.aggregate([{ $match: { academy_id: oid(academyId) } }, { $group: { _id: "$status", n: { $sum: 1 } } }])) {
      counts[r._id] = r.n;
    }
    const { page, pageSize, skip } = paging(query, 200);
    const items = [];
    for (const c of await MakeupCredit.find(filter).sort({ created_at: -1, _id: -1 }).skip(skip).limit(pageSize)) {
      items.push(await creditOut(c));
    }
    return { ...pageOut(items, total, page, pageSize), counts };
  }),
);

const DecideIn = z.object({ approve: z.boolean(), note: opt(z.string().max(300)) });

router.post(
  "/admin/makeups/:credit_id/decide",
  adminOnly,
  write(async (req) => {
    const body = parseBody(DecideIn, req);
    const c = await getOr404(MakeupCredit, req.params.credit_id, req.academy._id);
    await makeups.decide(c, body.approve, body.note ?? null, actorOf(req));
    await log(req, "makeup_credit", c._id, body.approve ? "approve" : "reject", body.note ?? null);
    return creditOut(c);
  }),
);

router.post(
  "/admin/attendance/:attendance_id/grant-makeup",
  adminOnly,
  write(async (req, res) => {
    const id = req.params.attendance_id;
    const att = isObjectId(id) ? await SessionAttendance.findById(id) : null;
    const session = att ? await Session.findById(att.session_id).select("academy_id") : null;
    if (!att || !session || !sameId(session.academy_id, req.academy._id)) throw new NotFoundError("Attendance not found");
    const c = await makeups.grant(att, req.rules, actorOf(req));
    await log(req, "makeup_credit", c._id, "grant", `Granted make-up for attendance ${id}`);
    res.status(201);
    return creditOut(c);
  }),
);

const AdminBookIn = z.object({ session_id: zOid });

router.post(
  "/admin/makeups/:credit_id/book",
  adminOnly,
  write(async (req) => {
    const body = parseBody(AdminBookIn, req);
    const c = await getOr404(MakeupCredit, req.params.credit_id, req.academy._id);
    const s = await getOr404(Session, body.session_id, req.academy._id);
    await makeups.book(c, s, req.rules, { byStudent: false });
    await log(req, "makeup_credit", c._id, "book", `Booked into session ${sid(s)}`);
    return creditOut(c);
  }),
);

router.get(
  "/admin/makeups/:credit_id/options",
  adminOnly,
  read(async (req) => {
    const c = await getOr404(MakeupCredit, req.params.credit_id, req.academy._id);
    const out = [];
    for (const s of await makeups.bookableSessions(c)) out.push(await sessionOut(s));
    return out;
  }),
);

router.post(
  "/admin/makeups/:credit_id/cancel-booking",
  adminOnly,
  write(async (req) => {
    const c = await getOr404(MakeupCredit, req.params.credit_id, req.academy._id);
    await makeups.cancelBooking(c, req.rules, { byStudent: false });
    await log(req, "makeup_credit", c._id, "cancel_booking", "Cancelled booking");
    return creditOut(c);
  }),
);

const ExtendIn = z.object({ expires_on: zDate.nullable() });

router.post(
  "/admin/makeups/:credit_id/extend",
  adminOnly,
  write(async (req) => {
    const body = parseBody(ExtendIn, req);
    const c = await getOr404(MakeupCredit, req.params.credit_id, req.academy._id);
    if (!["available", "expired", "booked", "pending_approval"].includes(c.status)) {
      throw new BusinessRuleError(`Make-up is ${c.status}`);
    }
    const old = c.expires_on ?? null;
    c.expires_on = body.expires_on;
    if (c.status === "expired" && (body.expires_on === null || body.expires_on >= today())) c.status = "available";
    await c.save();
    await log(req, "makeup_credit", c._id, "extend", `Expiry ${old ?? "None"} -> ${body.expires_on ?? "None"}`);
    return creditOut(c);
  }),
);

export default router;
