/** Student self-service portal (brief section 5, FR-021). */
import express from "express";
import multer from "multer";

import { config } from "../config.js";
import { studentOnly } from "../middleware/auth.js";
import {
  Batch,
  BatchStudent,
  MakeupCredit,
  oid,
  Payment,
  sameId,
  Session,
  SessionAttendance,
  sid,
  StudentFeePlan,
  StudentProfile,
  toJSON,
} from "../models/index.js";
import * as batchSvc from "../services/batches.js";
import * as ledger from "../services/ledger.js";
import * as makeups from "../services/makeups.js";
import * as media from "../services/media.js";
import { localInstant, now, today } from "../utils/clock.js";
import { addDays, maxDate } from "../utils/dates.js";
import { BusinessRuleError, forbidden, NotFoundError } from "../utils/errors.js";
import { read, write } from "../utils/http.js";
import { q } from "../utils/money.js";
import { opt, parseBody, parseQuery, ValidationError, z, zDate, zId, zInt } from "../utils/validate.js";
import { getOr404, log } from "./common.js";
import { num } from "./crud.js";
import { announcementsFor } from "./public.js";
import { batchOut, creditOut, paymentOut, sessionBrief, sessionOut, studentPlans } from "./serializers.js";

const router = express.Router();

async function profileOf(req) {
  const profile = await StudentProfile.findById(req.principal.user._id);
  if (!profile) throw forbidden("No student profile");
  return profile;
}

async function myEnrollments(studentId) {
  return BatchStudent.find({ student_id: studentId }).sort({ created_at: -1, _id: -1 });
}

/** The student's credit with this id, or 404 when it belongs to someone else. */
async function myCredit(req) {
  const credit = await getOr404(MakeupCredit, req.params.credit_id, req.academy._id);
  if (!sameId(credit.student_id, req.principal.id)) throw new NotFoundError("Not found");
  return credit;
}

/** Regular sessions of current batches plus booked make-ups. */
async function upcoming(studentId, days = 30) {
  const t = today();
  const enrollments = (await myEnrollments(studentId)).filter(
    (e) => (e.status === "active" || e.status === "pending") && (!e.left_on || e.left_on > t),
  );
  const sessions = await batchSvc.upcomingSessionsForBatches(
    enrollments.map((e) => e.batch_id),
    days,
    60,
  );
  const byBatch = new Map();
  for (const e of enrollments) byBatch.set(String(e.batch_id), e);
  const out = [];
  for (const s of sessions) {
    const e = byBatch.get(String(s.batch_id));
    if (e.joined_on && s.session_date < e.joined_on) continue;
    out.push({ ...(await sessionOut(s)), kind: "regular", enrollment_status: e.status });
  }
  const booked = await MakeupCredit.find({ student_id: studentId, status: "booked" }).sort({ _id: 1 });
  for (const credit of booked) {
    const s = credit.booked_session_id ? await Session.findById(credit.booked_session_id) : null;
    if (s && s.session_date >= t) out.push({ ...(await sessionOut(s)), kind: "makeup", makeup_credit_id: sid(credit) });
  }
  out.sort((a, b) => {
    if (a.session_date !== b.session_date) return a.session_date < b.session_date ? -1 : 1;
    if (a.start_time !== b.start_time) return a.start_time < b.start_time ? -1 : 1;
    return 0;
  });
  return out;
}

router.get(
  "/student/dashboard",
  studentOnly,
  write(async (req) => {
    const profile = await profileOf(req);
    await makeups.expireDue(req.academy._id);
    const studentId = profile._id;
    const upcomingSessions = await upcoming(studentId);
    const enrollments = await myEnrollments(studentId);
    const plans = await studentPlans(studentId);
    const activePlans = plans.filter((p) => p.status === "active" || p.status === "pending");
    const attRows = await SessionAttendance.find({ student_id: studentId }).select("attendance_status is_makeup");
    const credits = await MakeupCredit.find({ student_id: studentId }).select("status");
    const nextSession = upcomingSessions.find((u) => u.status === "scheduled") ?? null;
    let reminder = null;
    if (nextSession) {
      const start = localInstant(nextSession.session_date, nextSession.start_time);
      const hours = (start.getTime() - now().getTime()) / 3600000;
      if (hours >= 0 && hours <= req.rules.reminder_hours_before) {
        reminder = `Your next session starts in about ${Math.max(Math.trunc(hours), 1)} hour(s).`;
      }
    }
    const batches = [];
    for (const e of enrollments) {
      if (e.status !== "active" && e.status !== "pending") continue;
      batches.push({ ...toJSON(e), batch: await batchOut(await Batch.findById(e.batch_id), null, true) });
    }
    const makeupCounts = {};
    for (const status of ["pending_approval", "available", "booked", "used", "expired"]) {
      makeupCounts[status] = credits.filter((c) => c.status === status).length;
    }
    return {
      student: { id: sid(studentId), name: req.principal.user.name, skill_level: profile.skill_level },
      next_session: nextSession,
      reminder,
      upcoming_sessions: upcomingSessions.slice(0, 10),
      batches,
      attendance: {
        present: attRows.filter((a) => a.attendance_status === "present" && !a.is_makeup).length,
        makeups_attended: attRows.filter((a) => a.attendance_status === "present" && a.is_makeup).length,
        absent: attRows.filter((a) => a.attendance_status === "absent").length,
        cancelled: attRows.filter((a) => a.attendance_status === "session_cancelled").length,
      },
      makeups: makeupCounts,
      plans: activePlans,
      balance: await ledger.balance(studentId),
      pending_payments: await Payment.countDocuments({ student_id: studentId, status: "pending" }),
      announcements: await announcementsFor(req.academy._id, ["public", "students", "members"], 5),
    };
  }),
);

const SessionsQuery = z.object({ days: zInt.default(60) });

router.get(
  "/student/sessions",
  studentOnly,
  read(async (req) => {
    const { days } = parseQuery(SessionsQuery, req);
    return upcoming((await profileOf(req))._id, Math.min(days, 120));
  }),
);

const AttendanceQuery = z.object({ limit: zInt.default(100) });

router.get(
  "/student/attendance",
  studentOnly,
  read(async (req) => {
    const { limit } = parseQuery(AttendanceQuery, req);
    const studentId = (await profileOf(req))._id;
    const rows = await SessionAttendance.find({ student_id: studentId });
    const sessions = new Map();
    if (rows.length) {
      for (const s of await Session.find({ _id: { $in: rows.map((a) => a.session_id) } })) sessions.set(String(s._id), s);
    }
    const joined = rows.filter((a) => sessions.has(String(a.session_id))).map((a) => [a, sessions.get(String(a.session_id))]);
    joined.sort(([, x], [, y]) => {
      if (x.session_date !== y.session_date) return x.session_date < y.session_date ? 1 : -1;
      if (x.start_time !== y.start_time) return x.start_time < y.start_time ? 1 : -1;
      return 0;
    });
    const batchNames = new Map();
    const out = [];
    for (const [att, s] of joined.slice(0, Math.max(Math.min(limit, 500), 0))) {
      let originalBatchName = null;
      if (att.original_batch_id) {
        const key = String(att.original_batch_id);
        if (!batchNames.has(key)) batchNames.set(key, (await Batch.findById(key).select("name"))?.name ?? null);
        originalBatchName = batchNames.get(key);
      }
      out.push({ ...toJSON(att), session: await sessionBrief(s), original_batch_name: originalBatchName });
    }
    return out;
  }),
);

router.get(
  "/student/makeups",
  studentOnly,
  write(async (req) => {
    const studentId = (await profileOf(req))._id;
    await makeups.expireDue(req.academy._id);
    const credits = await MakeupCredit.find({ student_id: studentId }).sort({ created_at: -1, _id: -1 });
    const items = [];
    for (const c of credits) items.push(await creditOut(c));
    return { policy: req.rules.makeup, items };
  }),
);

router.get(
  "/student/makeups/:credit_id/options",
  studentOnly,
  read(async (req) => {
    const credit = await myCredit(req);
    const out = [];
    for (const s of await makeups.bookableSessions(credit)) {
      const batch = await Batch.findById(s.batch_id).select("max_players skill_level");
      const data = await sessionOut(s);
      data.spots_left = batch.max_players - (await batchSvc.sessionHeadcount(s));
      data.skill_level = batch.skill_level;
      out.push(data);
    }
    return out;
  }),
);

const BookIn = z.object({ session_id: zId });

router.post(
  "/student/makeups/:credit_id/book",
  studentOnly,
  write(async (req) => {
    const body = parseBody(BookIn, req);
    const credit = await myCredit(req);
    const session = await getOr404(Session, body.session_id, req.academy._id);
    await makeups.book(credit, session, req.rules, { byStudent: true });
    await log(req, "makeup_credit", credit._id, "book", `Booked make-up into session ${sid(session)}`);
    return creditOut(await MakeupCredit.findById(credit._id));
  }),
);

router.post(
  "/student/makeups/:credit_id/cancel",
  studentOnly,
  write(async (req) => {
    const credit = await myCredit(req);
    await makeups.cancelBooking(credit, req.rules, { byStudent: true });
    await log(req, "makeup_credit", credit._id, "cancel_booking", "Cancelled make-up booking");
    return creditOut(await MakeupCredit.findById(credit._id));
  }),
);

router.get(
  "/student/plans",
  studentOnly,
  read(async (req) => studentPlans((await profileOf(req))._id)),
);

router.get(
  "/student/payments",
  studentOnly,
  read(async (req) => {
    const rows = await Payment.find({ student_id: (await profileOf(req))._id }).sort({ payment_date: -1, _id: -1 });
    const out = [];
    for (const p of rows) out.push(await paymentOut(p));
    return out;
  }),
);

const LedgerQuery = z.object({ start: opt(zDate), end: opt(zDate) });

router.get(
  "/student/ledger",
  studentOnly,
  read(async (req) => {
    const { start, end } = parseQuery(LedgerQuery, req);
    const { entries, ...totals } = await ledger.statement((await profileOf(req))._id, start ?? null, end ?? null);
    return { ...totals, entries: entries.map(toJSON) };
  }),
);

router.get(
  "/student/enroll/:batch_id",
  studentOnly,
  read(async (req) => {
    const b = await getOr404(Batch, req.params.batch_id, req.academy._id);
    if (!b.is_public) throw new NotFoundError("Batch not found");
    const already = await BatchStudent.findOne({
      batch_id: b._id,
      student_id: oid(req.principal.id),
      status: { $in: ["pending", "active"] },
    });
    const t = today();
    const start = maxDate(b.start_date || t, t);
    let estimate = null;
    if (!b.fee_plan_id && b.price && b.end_date) estimate = batchSvc.countOccurrences(b, start, b.end_date);
    return {
      batch: await batchOut(b, null, true),
      already_enrolled: already ? toJSON(already) : null,
      payment: req.rules.payment,
      sessions_estimate: estimate,
    };
  }),
);

// Payment claim under the UPI/QR workflow; optional so a student can enroll first and pay at the academy.
const EnrollIn = z.object({
  batch_id: zId,
  fee_plan_id: opt(zId),
  amount: opt(num({ gt: 0 })),
  payment_date: opt(zDate),
  reference_no: opt(z.string().max(100)),
  proof_url: opt(z.string().max(500)),
  notes: opt(z.string().max(500)),
});

router.post(
  "/student/enroll",
  studentOnly,
  write(async (req, res) => {
    const body = parseBody(EnrollIn, req);
    const profile = await profileOf(req);
    const b = await getOr404(Batch, body.batch_id, req.academy._id);
    if (!b.is_public) throw new NotFoundError("Batch not found");
    const [enrollment, plan] = await batchSvc.enroll({
      batch: b,
      student: profile,
      source: "self",
      actorId: req.principal.user._id,
      feePlanId: body.fee_plan_id ?? null,
    });
    let payment = null;
    if (body.amount) {
      if (!body.reference_no) throw new BusinessRuleError("Enter the UPI transaction reference (UTR) for your payment", 400);
      payment = await Payment.create({
        academy_id: req.academy._id,
        student_id: profile._id,
        student_fee_plan_id: plan ? plan._id : null,
        amount: q(body.amount),
        payment_date: body.payment_date || today(),
        method: "upi",
        reference_no: body.reference_no,
        proof_url: body.proof_url ?? null,
        status: "pending",
        submitted_by_id: req.principal.user._id,
        notes: body.notes ?? null,
      });
    }
    await log(
      req,
      "batch_student",
      enrollment._id,
      "self_enroll",
      `Requested enrollment in ${b.name}` + (body.amount ? ` with payment ${body.amount}` : ""),
    );
    res.status(201);
    return {
      enrollment: toJSON(await BatchStudent.findById(enrollment._id)),
      plan: plan ? toJSON(await StudentFeePlan.findById(plan._id)) : null,
      payment: payment ? toJSON(payment) : null,
    };
  }),
);

const PaymentIn = z.object({
  amount: num({ gt: 0 }),
  payment_date: opt(zDate),
  reference_no: z.string().min(4).max(100),
  student_fee_plan_id: opt(zId),
  proof_url: opt(z.string().max(500)),
  notes: opt(z.string().max(500)),
});

/** Report a UPI payment for verification (e.g. a renewal or outstanding dues). */
router.post(
  "/student/payments",
  studentOnly,
  write(async (req, res) => {
    const body = parseBody(PaymentIn, req);
    const studentId = (await profileOf(req))._id;
    if (body.student_fee_plan_id) {
      const plan = await getOr404(StudentFeePlan, body.student_fee_plan_id, req.academy._id);
      if (!sameId(plan.student_id, studentId)) throw new NotFoundError("Plan not found");
    }
    if (body.payment_date && body.payment_date > addDays(today(), 1)) {
      throw new BusinessRuleError("Payment date cannot be in the future", 400);
    }
    const payment = await Payment.create({
      academy_id: req.academy._id,
      student_id: studentId,
      student_fee_plan_id: body.student_fee_plan_id ?? null,
      amount: q(body.amount),
      payment_date: body.payment_date || today(),
      method: "upi",
      reference_no: body.reference_no,
      proof_url: body.proof_url ?? null,
      notes: body.notes ?? null,
      status: "pending",
      submitted_by_id: req.principal.user._id,
    });
    await log(req, "payment", payment._id, "submit", `Submitted payment ${body.amount}`);
    res.status(201);
    return paymentOut(payment);
  }),
);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024 } });

/** Parse the multipart "file" field; oversize files get the same 413 message as media.storeImage. */
function singleFile(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      next(new BusinessRuleError(`Image is larger than ${config.maxUploadMb} MB`, 413));
      return;
    }
    if (err instanceof multer.MulterError && err.code === "LIMIT_UNEXPECTED_FILE") {
      next(new ValidationError([{ path: ["file"], message: "Field required", code: "missing" }]));
      return;
    }
    next(err);
  });
}

/** Optional screenshot of the UPI payment. No database writes, so no transaction. */
router.post(
  "/student/payment-proof",
  studentOnly,
  singleFile,
  read(async (req, res) => {
    if (!req.file) throw new ValidationError([{ path: ["file"], message: "Field required", code: "missing" }]);
    const stored = await media.storeImage(req.file.buffer, `payment-proofs/${req.principal.id}`);
    res.status(201);
    return { url: stored.url };
  }),
);

/** A student may withdraw an enrollment that has not been confirmed yet. */
router.post(
  "/student/enrollments/:enrollment_id/cancel",
  studentOnly,
  write(async (req) => {
    const id = req.params.enrollment_id;
    const e = /^[a-f0-9]{24}$/i.test(id) ? await BatchStudent.findById(id) : null;
    if (!e || !sameId(e.student_id, req.principal.id)) throw new NotFoundError("Not found");
    if (e.status !== "pending") throw new BusinessRuleError("Confirmed enrollments can only be changed by the academy");
    await batchSvc.endEnrollment(e, "cancelled", today(), req.principal.user._id);
    await log(req, "batch_student", e._id, "withdraw", "Withdrew pending enrollment");
    return toJSON(await BatchStudent.findById(e._id));
  }),
);

export default router;
