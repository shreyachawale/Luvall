/** Coach portal and the shared session/attendance endpoints used by coaches and admins (brief section 6). */
import express from "express";

import { coachOrAdmin } from "../middleware/auth.js";
import {
  Batch,
  MakeupCredit,
  oid,
  sameId,
  Session,
  SessionAttendance,
  sid,
  StudentProfile,
  User,
} from "../models/index.js";
import * as attSvc from "../services/attendance.js";
import { snapshot } from "../services/audit.js";
import * as batchSvc from "../services/batches.js";
import * as finance from "../services/finance.js";
import { today } from "../utils/clock.js";
import { addDays, monthLongLabel } from "../utils/dates.js";
import { badRequest, BusinessRuleError, forbidden, NotFoundError } from "../utils/errors.js";
import { read, write } from "../utils/http.js";
import { sum } from "../utils/money.js";
import { normalizeMobile, opt, parseBody, parseQuery, z, zId, zInt, zTime } from "../utils/validate.js";
import { escapeRegex, getOr404, ilike, log, period } from "./common.js";
import { num } from "./crud.js";
import { announcementsFor } from "./public.js";
import { batchOut, sessionOut } from "./serializers.js";

const router = express.Router();

function assertSessionAccess(req, session) {
  if (req.principal.isAdmin) return;
  if (!session.coaches.some((sc) => sameId(sc.coach_id, req.principal.id))) {
    throw forbidden("This session is not assigned to you");
  }
}

/** Sessions the coach is assigned to (SessionCoach rows). */
function coachSessions(coachId, filter = {}) {
  return Session.find({ "coaches.coach_id": oid(coachId), ...filter });
}

/** Completed-session count, hours and payable over coach session rows. */
function totalsOf(rows) {
  return {
    sessions: rows.filter((r) => r.status === "completed").length,
    hours: sum(rows.map((r) => r.hours_coached)),
    payable: sum(rows.map((r) => r.payable)),
  };
}

async function withCounts(sessions) {
  const out = [];
  for (const s of sessions) out.push(await sessionOut(s, true));
  return out;
}

router.get(
  "/coach/dashboard",
  coachOrAdmin,
  read(async (req) => {
    const t = today();
    const cid = req.principal.id;
    const upcoming = await coachSessions(cid, { session_date: { $gte: t, $lte: addDays(t, 7) } }).sort({
      session_date: 1,
      start_time: 1,
    });
    const pending = await coachSessions(cid, {
      status: "scheduled",
      session_date: { $lt: t, $gte: addDays(t, -req.rules.attendance_edit_window_days) },
    }).sort({ session_date: 1, start_time: 1 });
    const [start, end] = [finance.monthStart(t), finance.monthEnd(t)];
    const monthRows = await finance.coachSessions(req.academy._id, start, end, { coachId: cid });
    return {
      today: await withCounts(upcoming.filter((s) => s.session_date === t)),
      upcoming: await withCounts(upcoming.filter((s) => s.session_date > t)),
      needs_attendance: await withCounts(pending),
      month: { label: monthLongLabel(start), ...totalsOf(monthRows) },
      announcements: await announcementsFor(req.academy._id, ["public", "coaches", "members"], 5),
    };
  }),
);

/**
 * period() for ?month=: like Python's `date(int(y), int(m), 1)`, "2026-1" is accepted and impossible months
 * such as "2026-13" are rejected with the same 400 (common.period only checks the YYYY-MM shape).
 */
function monthPeriod(month) {
  if (!month) return period(null, null, null);
  const m = /^(\d{1,4})-(\d{1,2})$/.exec(month);
  if (!m || Number(m[1]) < 1 || Number(m[2]) < 1 || Number(m[2]) > 12) throw badRequest("month must be YYYY-MM");
  return period(null, null, `${m[1].padStart(4, "0")}-${m[2].padStart(2, "0")}`);
}

const SessionsQuery = z.object({ scope: z.string().default("upcoming"), month: opt(z.string()) });

router.get(
  "/coach/sessions",
  coachOrAdmin,
  read(async (req) => {
    const { scope, month } = parseQuery(SessionsQuery, req);
    const t = today();
    let query;
    if (scope === "history") {
      const [s, e] = month ? monthPeriod(month) : [addDays(t, -90), t];
      query = coachSessions(req.principal.id, { session_date: { $gte: s, $lte: e } }).sort({ session_date: -1, start_time: 1 });
    } else {
      query = coachSessions(req.principal.id, { session_date: { $gte: t, $lte: addDays(t, 45) } }).sort({
        session_date: 1,
        start_time: 1,
      });
    }
    return withCounts(await query.limit(300));
  }),
);

router.get(
  "/coach/batches",
  coachOrAdmin,
  read(async (req) => {
    const batches = await Batch.find({ "coaches.coach_id": oid(req.principal.id), status: { $in: ["upcoming", "active"] } }).sort({
      name: 1,
      _id: 1,
    });
    const t = today();
    const out = [];
    for (const b of batches) {
      const students = await batchSvc.regularEnrollmentsOn(b._id, t);
      const users = new Map();
      if (students.length) {
        for (const u of await User.find({ _id: { $in: students.map((e) => e.student_id) } }).select("name mobile")) {
          users.set(String(u._id), u);
        }
      }
      out.push({
        ...(await batchOut(b)),
        students: students.map((e) => {
          const u = users.get(String(e.student_id));
          return { id: sid(e.student_id), name: u?.name ?? null, mobile: u?.mobile ?? null, joined_on: e.joined_on };
        }),
      });
    }
    return out;
  }),
);

const HoursQuery = z.object({ month: opt(z.string()) });

router.get(
  "/coach/hours",
  coachOrAdmin,
  read(async (req) => {
    const { month } = parseQuery(HoursQuery, req);
    const [s, e] = monthPeriod(month);
    const rows = await finance.coachSessions(req.academy._id, s, e, { coachId: req.principal.id });
    return { period: { start: s, end: e }, sessions: rows, totals: totalsOf(rows) };
  }),
);

// --- Shared session endpoints (coach for own sessions, admin for all) ---------------------------------------

/** The session in this academy that the principal may work on (404 / 403 otherwise). */
async function accessibleSession(req) {
  const session = await getOr404(Session, req.params.session_id, req.academy._id);
  assertSessionAccess(req, session);
  return session;
}

/** Session with batch, roster and whether the principal may still edit its attendance. */
async function sessionDetail(req, session) {
  let [canEdit, reason] = attSvc.coachCanEdit(session, req.rules);
  if (req.principal.isAdmin) {
    canEdit = session.status !== "cancelled";
    reason = canEdit ? null : "This session was cancelled";
  }
  const batch = await Batch.findById(session.batch_id).select("name skill_level max_players");
  return {
    ...(await sessionOut(session)),
    batch: { id: sid(batch), name: batch.name, skill_level: batch.skill_level, max_players: batch.max_players },
    roster: await attSvc.roster(session),
    can_edit: canEdit,
    edit_blocked_reason: reason,
    drop_in_fee: req.rules.drop_in_fee,
  };
}

/** Coaches may only change attendance inside the edit window (admins always may). */
function assertCoachCanEdit(req, session) {
  if (req.principal.isAdmin) return;
  const [ok, reason] = attSvc.coachCanEdit(session, req.rules);
  if (!ok) throw new BusinessRuleError(reason || "Not editable", 403);
}

router.get(
  "/sessions/:session_id",
  coachOrAdmin,
  read(async (req) => sessionDetail(req, await accessibleSession(req))),
);

const EntryIn = z.object({
  student_id: zId,
  status: z.string().regex(/^(present|absent)$/),
  attendee_type: z
    .string()
    .regex(/^(makeup|drop_in|other)$/)
    .nullable()
    .default(null),
  billing_mode: z.string().nullable().default(null),
  makeup_credit_id: zId.nullable().default(null),
  drop_in_fee: num({ ge: 0 }).nullable().default(null),
  remarks: z.string().max(300).nullable().default(null),
});

const CoachHoursIn = z.object({
  coach_id: zId,
  hours_coached: num({ ge: 0, le: 24 }),
  adjustment_amount: num().nullable().default(null),
  adjustment_note: z.string().max(300).nullable().default(null),
});

const RecordIn = z.object({
  entries: z.array(EntryIn).default([]),
  coaches: z.array(CoachHoursIn).default([]),
  actual_start_time: zTime.nullable().default(null),
  actual_end_time: zTime.nullable().default(null),
  courts_booked: zInt.min(0).max(50).nullable().default(null),
  remarks: z.string().max(2000).nullable().default(null),
});

router.post(
  "/sessions/:session_id/attendance",
  coachOrAdmin,
  write(async (req) => {
    const body = parseBody(RecordIn, req);
    const session = await accessibleSession(req);
    assertCoachCanEdit(req, session);
    const was = session.status;
    await attSvc.recordSession(session, {
      entries: body.entries,
      coaches: body.coaches,
      rules: req.rules,
      actorId: req.principal.user._id,
      isAdmin: req.principal.isAdmin,
      actualStart: body.actual_start_time,
      actualEnd: body.actual_end_time,
      courtsBooked: body.courts_booked,
      remarks: body.remarks,
    });
    const present = body.entries.filter((e) => e.status === "present").length;
    await log(
      req,
      "session",
      session._id,
      was === "scheduled" ? "record_attendance" : "correct_attendance",
      `${present}/${body.entries.length} present on ${session.session_date}`,
      null,
      body,
    );
    return sessionDetail(req, await Session.findById(session._id));
  }),
);

router.delete(
  "/sessions/:session_id/attendance/:attendance_id",
  coachOrAdmin,
  write(async (req) => {
    const session = await accessibleSession(req);
    assertCoachCanEdit(req, session);
    const attendanceId = req.params.attendance_id;
    const att = /^[a-f0-9]{24}$/i.test(attendanceId) ? await SessionAttendance.findById(attendanceId) : null;
    if (!att || !sameId(att.session_id, session._id)) throw new NotFoundError("Attendance not found");
    const old = snapshot(att);
    await attSvc.removeAttendee(att, req.principal.user._id);
    await log(req, "session_attendance", attendanceId, "remove_attendee", `Removed extra attendee from session ${sid(session)}`, old);
    return sessionDetail(req, await Session.findById(session._id));
  }),
);

const CandidatesQuery = z.object({ q: z.string().default("") });

/**
 * Search students to add as extra attendees, with any make-up they can use.
 * Python ran makeups.expire_due here and then rolled it back (no commit), so the endpoint only reads: credits
 * that expire_due would have expired (available, expiring before today) are left out of the result instead.
 */
router.get(
  "/sessions/:session_id/candidates",
  coachOrAdmin,
  read(async (req) => {
    const { q } = parseQuery(CandidatesQuery, req);
    const session = await accessibleSession(req);
    const term = q.trim();
    if (term.length < 2) return [];
    const users = await User.aggregate([
      { $match: { $or: [{ name: ilike(term) }, { mobile: new RegExp(escapeRegex(term)) }] } },
      { $lookup: { from: StudentProfile.collection.name, localField: "_id", foreignField: "_id", as: "profile" } },
      { $unwind: "$profile" },
      { $match: { "profile.academy_id": oid(req.academy._id), "profile.status": "active" } },
      { $sort: { name: 1, _id: 1 } },
      { $limit: 15 },
      { $project: { name: 1, mobile: 1, skill_level: "$profile.skill_level" } },
    ]);
    const t = today();
    const batchNames = new Map();
    const out = [];
    for (const user of users) {
      const credits = await MakeupCredit.find({
        student_id: user._id,
        $and: [
          { $or: [{ expires_on: null }, { expires_on: { $gte: session.session_date } }] },
          { $or: [{ status: "booked" }, { status: "available", $or: [{ expires_on: null }, { expires_on: { $gte: t } }] }] },
        ],
      }).sort({ _id: 1 });
      const makeupCredits = [];
      for (const c of credits) {
        const key = String(c.original_batch_id);
        if (!batchNames.has(key)) batchNames.set(key, (await Batch.findById(key).select("name"))?.name ?? null);
        makeupCredits.push({ id: sid(c), status: c.status, expires_on: c.expires_on, original_batch_name: batchNames.get(key) });
      }
      out.push({
        student_id: sid(user),
        name: user.name,
        mobile: user.mobile,
        skill_level: user.skill_level ?? null,
        is_regular: await batchSvc.isRegular(session.batch_id, user._id, session.session_date),
        makeup_credits: makeupCredits,
      });
    }
    return out;
  }),
);

const WalkInIn = z.object({ name: z.string().min(2).max(200), mobile: z.string() });

/** Create a lightweight student record for a new drop-in player so their fee can be tracked. */
router.post(
  "/sessions/:session_id/walk-in",
  coachOrAdmin,
  write(async (req, res) => {
    const body = parseBody(WalkInIn, req);
    await accessibleSession(req);
    let mobile;
    try {
      mobile = normalizeMobile(body.mobile);
    } catch (exc) {
      throw new BusinessRuleError(exc.message, 400);
    }
    const existing = await User.findOne({ mobile });
    if (existing) {
      if (!(await StudentProfile.exists({ _id: existing._id }))) {
        throw new BusinessRuleError("That mobile number belongs to a staff account");
      }
      res.status(201);
      return { student_id: sid(existing), name: existing.name, mobile: existing.mobile, existing: true };
    }
    const user = await User.create({
      name: body.name.trim(),
      mobile,
      joined_date: today(),
      status: "active",
      roles: [{ academy_id: req.academy._id, role: "student" }],
    });
    await StudentProfile.create({ _id: user._id, academy_id: req.academy._id, source: "walk_in" });
    await log(req, "user", user._id, "create_walk_in", `Added walk-in player ${user.name}`);
    res.status(201);
    return { student_id: sid(user), name: user.name, mobile: user.mobile, existing: false };
  }),
);

export default router;
