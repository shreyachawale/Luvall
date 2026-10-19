/** API tests for the student portal, the coach portal and the shared /sessions endpoints. */
import sharp from "sharp";
import request from "supertest";
import { expect, test } from "vitest";

import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { withTransaction } from "../src/db.js";
import {
  Academy,
  Announcement,
  AuditLog,
  Batch,
  BatchStudent,
  MakeupCredit,
  Payment,
  Session,
  SessionAttendance,
  sid,
  StudentFeePlan,
  StudentProfile,
  User,
} from "../src/models/index.js";
import * as attSvc from "../src/services/attendance.js";
import * as batchSvc from "../src/services/batches.js";
import * as ledger from "../src/services/ledger.js";
import { BusinessRules } from "../src/services/rules.js";
import { hashPassword } from "../src/services/security.js";
import { freeze } from "../src/utils/clock.js";
import { TODAY } from "./setup.js";
import { createWorld, login } from "./world.js";

const app = createApp();
const RULES = BusinessRules.parse({});
const tx = (fn) => withTransaction(fn);

const ADMIN = ["9000000001", "Admin@12345"];
const COACH = ["9000000011", "Coach@12345"];
const COACH2 = ["9000000012", "Coach@12345"];
const STUDENT1 = ["9000000101", "Student@123"];
const STUDENT2 = ["9000000102", "Student@123"];

const signIn = ([mobile, password]) => login(request.agent(app), mobile, password);

/**
 * Run fn with the academy clock at another local date/time, then return to the suite's frozen
 * TODAY 12:00 (test/setup.js re-freezes before every test as well).
 */
async function at(date, time, fn) {
  freeze(date, time);
  try {
    return await fn();
  } finally {
    freeze(TODAY);
  }
}

async function enrollActive(world, student, batch) {
  return tx(async () => {
    const [e] = await batchSvc.enroll({ batch, student, source: "admin", actorId: world.admin._id, startDate: batch.start_date });
    await batchSvc.approveEnrollment(e, world.admin._id);
    return e;
  });
}

async function generateOctober(world) {
  await tx(async () => {
    await batchSvc.generateSessions(world.batch, "2026-10-01", "2026-10-31");
    await batchSvc.generateSessions(world.batch2, "2026-10-01", "2026-10-31");
  });
}

const sessionOn = (batch, date) => Session.findOne({ batch_id: batch._id, session_date: date });

/** Admin records attendance through the API (present/absent per student id). */
async function adminRecord(admin, session, statuses) {
  const entries = Object.entries(statuses).map(([studentId, status]) => ({ student_id: studentId, status }));
  const r = await admin.post(`/api/v1/sessions/${sid(session)}/attendance`).send({ entries, coaches: [] });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

test("portal role-based access", async () => {
  const world = await createWorld();
  await world.student({ password: STUDENT1[1] });
  await generateOctober(world);
  const today = await sessionOn(world.batch, TODAY);
  const intSession = await sessionOn(world.batch2, "2026-10-19");

  const anon = request(app);
  for (const path of ["/api/v1/student/dashboard", "/api/v1/coach/dashboard", `/api/v1/sessions/${sid(today)}`]) {
    expect((await anon.get(path)).status).toBe(401);
  }
  const student = await signIn(STUDENT1);
  const coach = await signIn(COACH);
  const coach2 = await signIn(COACH2);
  const admin = await signIn(ADMIN);

  expect((await student.get("/api/v1/coach/dashboard")).status).toBe(403);
  expect((await student.get("/api/v1/coach/hours")).status).toBe(403);
  const denied = await student.get(`/api/v1/sessions/${sid(today)}`);
  expect(denied.status).toBe(403);
  expect(denied.body.detail).toBe("You do not have access to this area");
  expect((await coach.get("/api/v1/student/dashboard")).status).toBe(403);
  expect((await coach.post("/api/v1/student/payment-proof")).status).toBe(403);
  expect((await admin.get("/api/v1/student/makeups")).status).toBe(403);
  expect((await admin.get("/api/v1/coach/dashboard")).status).toBe(200);
  expect((await coach.get("/api/v1/coach/dashboard")).status).toBe(200);
  expect((await student.get("/api/v1/student/dashboard")).status).toBe(200);

  // Coaches only see the sessions they are assigned to; admins see all.
  const notMine = await coach2.get(`/api/v1/sessions/${sid(today)}`);
  expect(notMine.status).toBe(403);
  expect(notMine.body.detail).toBe("This session is not assigned to you");
  expect((await coach2.get(`/api/v1/sessions/${sid(today)}/candidates?q=stu`)).status).toBe(403);
  expect((await coach2.get(`/api/v1/sessions/${sid(intSession)}`)).status).toBe(200);
  expect((await admin.get(`/api/v1/sessions/${sid(today)}`)).status).toBe(200);
  const missing = await admin.get(`/api/v1/sessions/${"0".repeat(24)}`);
  expect(missing.status).toBe(404);
  expect(missing.body.detail).toBe("Session not found");

  // A student role without a student profile.
  await User.create({
    name: "No Profile",
    mobile: "9000000199",
    status: "active",
    password_hash: await hashPassword("Student@123"),
    roles: [{ academy_id: world.academy._id, role: "student" }],
  });
  const orphan = await signIn(["9000000199", "Student@123"]);
  const r = await orphan.get("/api/v1/student/dashboard");
  expect(r.status).toBe(403);
  expect(r.body.detail).toBe("No student profile");
});

test("student dashboard, sessions, attendance, plans and ledger", async () => {
  const world = await createWorld();
  const s1 = await world.student({ password: STUDENT1[1] });
  await enrollActive(world, s1, world.batch);
  await generateOctober(world);
  await Announcement.create([
    { academy_id: world.academy._id, title: "For students", message: "Hi", audience: "students", status: "published" },
    { academy_id: world.academy._id, title: "Pinned", message: "Hi", audience: "members", status: "published", is_pinned: true },
    { academy_id: world.academy._id, title: "Coaches only", message: "Hi", audience: "coaches", status: "published" },
    { academy_id: world.academy._id, title: "Draft", message: "Hi", audience: "students", status: "draft" },
  ]);
  const admin = await signIn(ADMIN);
  await adminRecord(admin, await sessionOn(world.batch, "2026-10-08"), { [sid(s1)]: "absent" });
  await adminRecord(admin, await sessionOn(world.batch, "2026-10-13"), { [sid(s1)]: "present" });

  // The clock is frozen at 12:00 academy time: today's 17:00 session is 5 h away, inside the 24 h window.
  const student = await signIn(STUDENT1);
  const r = await student.get("/api/v1/student/dashboard");
  expect(r.status, r.text).toBe(200);
  const dash = r.body;
  expect(dash.student).toEqual({ id: sid(s1), name: "Student 1", skill_level: null });
  expect(dash.next_session.session_date).toBe(TODAY);
  expect(dash.next_session.start_time).toBe("17:00");
  expect(dash.next_session.kind).toBe("regular");
  expect(dash.next_session.enrollment_status).toBe("active");
  expect(dash.reminder).toBe("Your next session starts in about 5 hour(s).");
  expect(dash.upcoming_sessions.map((u) => u.session_date)).toEqual(["2026-10-15", "2026-10-20", "2026-10-22", "2026-10-27", "2026-10-29"]);
  expect(dash.batches).toHaveLength(1);
  expect(dash.batches[0].status).toBe("active");
  expect(dash.batches[0].batch.id).toBe(sid(world.batch));
  expect(dash.batches[0].batch).not.toHaveProperty("academy_id");
  expect(dash.attendance).toEqual({ present: 1, makeups_attended: 0, absent: 1, cancelled: 0 });
  expect(dash.makeups).toEqual({ pending_approval: 0, available: 1, booked: 0, used: 0, expired: 0 });
  expect(dash.plans).toHaveLength(1);
  expect(dash.plans[0].usage.used).toBe(2);
  expect(dash.balance).toBe(-4000);
  expect(dash.pending_payments).toBe(0);
  expect(dash.announcements.map((a) => a.title)).toEqual(["Pinned", "For students"]);

  // The window is inclusive at 24 h, hours are truncated with a minimum of 1, and a session that has
  // already started (it is still the next scheduled one) or one more than 24 h away gives no reminder.
  const reminderAt = (date, time) => at(date, time, async () => (await student.get("/api/v1/student/dashboard")).body.reminder);
  expect(await reminderAt("2026-10-14", "17:00")).toBe("Your next session starts in about 24 hour(s).");
  expect(await reminderAt("2026-10-14", "16:59")).toBeNull();
  expect(await reminderAt(TODAY, "14:01")).toBe("Your next session starts in about 2 hour(s).");
  expect(await reminderAt(TODAY, "16:30")).toBe("Your next session starts in about 1 hour(s).");
  expect(await reminderAt(TODAY, "17:00")).toBe("Your next session starts in about 1 hour(s).");
  const started = await at(TODAY, "17:30", async () => (await student.get("/api/v1/student/dashboard")).body);
  expect(started.next_session.session_date).toBe(TODAY);
  expect(started.reminder).toBeNull();

  const sessions = (await student.get("/api/v1/student/sessions?days=5")).body;
  expect(sessions.map((u) => [u.session_date, u.kind, u.batch_name])).toEqual([
    ["2026-10-15", "regular", "Batch BEG"],
    ["2026-10-20", "regular", "Batch BEG"],
  ]);
  expect((await student.get("/api/v1/student/sessions?days=abc")).status).toBe(422);

  const attendance = (await student.get("/api/v1/student/attendance")).body;
  expect(attendance.map((a) => [a.session.session_date, a.attendance_status])).toEqual([
    ["2026-10-13", "present"],
    ["2026-10-08", "absent"],
  ]);
  expect(attendance[0].session.batch_name).toBe("Batch BEG");
  expect(attendance[0].original_batch_name).toBe("Batch BEG");
  expect((await student.get("/api/v1/student/attendance?limit=1")).body).toHaveLength(1);

  const plans = (await student.get("/api/v1/student/plans")).body;
  expect(plans).toHaveLength(1);
  expect(plans[0]).toMatchObject({ name: "8 sessions", status: "active", batch_name: "Batch BEG", student_name: "Student 1" });
  expect(plans[0].usage.remaining).toBe(6);

  const st = (await student.get("/api/v1/student/ledger")).body;
  expect(st.entries.map((e) => e.txn_type)).toEqual(["charge"]);
  expect(st.closing_balance).toBe(-4000);
  expect(st.charges).toBe(4000);
  const later = (await student.get("/api/v1/student/ledger?start=2026-10-16&end=2026-10-31")).body;
  expect(later.opening_balance).toBe(-4000);
  expect(later.entries).toEqual([]);
  expect((await student.get("/api/v1/student/ledger?start=16-10-2026")).status).toBe(422);
});

test("self-enrollment with a UPI payment claim, withdrawal and payment submissions", async () => {
  const world = await createWorld();
  const s1 = await world.student({ password: STUDENT1[1] });
  const s2 = await world.student({ password: STUDENT2[1] });
  const student = await signIn(STUDENT1);
  const bid = sid(world.batch);

  const preview = (await student.get(`/api/v1/student/enroll/${bid}`)).body;
  expect(preview.batch.seats_left).toBe(6);
  expect(preview.batch).not.toHaveProperty("fee_plan_id");
  expect(preview.already_enrolled).toBeNull();
  expect(preview.sessions_estimate).toBeNull();
  expect(preview.payment).toHaveProperty("upi_id");

  // A batch priced per period (no fee plan) shows how many sessions remain from today.
  await Batch.updateOne({ _id: world.batch2._id }, { $set: { fee_plan_id: null, price: 3000 } });
  expect((await student.get(`/api/v1/student/enroll/${sid(world.batch2)}`)).body.sessions_estimate).toBe(4);

  const hidden = await Batch.create({ academy_id: world.academy._id, code: "PRIV", name: "Private", is_public: false });
  const notPublic = await student.get(`/api/v1/student/enroll/${sid(hidden)}`);
  expect(notPublic.status).toBe(404);
  expect(notPublic.body.detail).toBe("Batch not found");
  expect((await student.post("/api/v1/student/enroll").send({ batch_id: sid(hidden) })).status).toBe(404);
  expect((await student.post("/api/v1/student/enroll").send({ batch_id: "nope" })).status).toBe(422);
  expect((await student.post("/api/v1/student/enroll").send({ batch_id: bid, amount: 0 })).status).toBe(422);

  // A payment claim without the UTR is rejected and nothing is created.
  const noRef = await student.post("/api/v1/student/enroll").send({ batch_id: bid, amount: 4000 });
  expect(noRef.status).toBe(400);
  expect(noRef.body.detail).toBe("Enter the UPI transaction reference (UTR) for your payment");
  expect(await BatchStudent.countDocuments({})).toBe(0);

  const r = await student.post("/api/v1/student/enroll").send({ batch_id: bid, amount: 4000, reference_no: "UTR12345" });
  expect(r.status, r.text).toBe(201);
  expect(r.body.enrollment).toMatchObject({ status: "pending", student_id: sid(s1), batch_id: bid, source: "self" });
  expect(r.body.plan).toMatchObject({ status: "pending", final_fee: 4000 });
  expect(r.body.payment).toMatchObject({ status: "pending", amount: 4000, method: "upi", reference_no: "UTR12345", payment_date: TODAY });
  expect(r.body.payment.student_fee_plan_id).toBe(r.body.plan.id);
  const audit = await AuditLog.findOne({ action: "self_enroll" });
  expect(audit.entity_type).toBe("batch_student");
  expect(audit.summary).toBe("Requested enrollment in Batch BEG with payment 4000");

  expect((await student.post("/api/v1/student/enroll").send({ batch_id: bid })).status).toBe(409);
  const again = (await student.get(`/api/v1/student/enroll/${bid}`)).body;
  expect(again.already_enrolled.status).toBe("pending");
  expect(again.batch.seats_left).toBe(5);
  expect((await student.get("/api/v1/student/dashboard")).body.pending_payments).toBe(1);

  // Enroll without paying, then withdraw the pending enrollment.
  const plain = await student.post("/api/v1/student/enroll").send({ batch_id: sid(world.batch2) });
  expect(plain.status).toBe(201);
  expect(plain.body.payment).toBeNull();
  const eid = plain.body.enrollment.id;
  const other = await signIn(STUDENT2);
  expect((await other.post(`/api/v1/student/enrollments/${eid}/cancel`)).status).toBe(404);
  expect((await student.post("/api/v1/student/enrollments/not-an-id/cancel")).status).toBe(404);
  const withdrawn = await student.post(`/api/v1/student/enrollments/${eid}/cancel`);
  expect(withdrawn.status, withdrawn.text).toBe(200);
  expect(withdrawn.body).toMatchObject({ id: eid, status: "cancelled", left_on: TODAY });
  if (plain.body.plan) expect((await StudentFeePlan.findById(plain.body.plan.id)).status).toBe("cancelled");
  expect(await AuditLog.countDocuments({ action: "withdraw", entity_id: eid })).toBe(1);

  // Once the academy verifies the payment the enrollment is confirmed and can no longer be withdrawn.
  await tx(async () => ledger.verifyPayment(await Payment.findById(r.body.payment.id), world.admin._id));
  const confirmed = await student.post(`/api/v1/student/enrollments/${r.body.enrollment.id}/cancel`);
  expect(confirmed.status).toBe(409);
  expect(confirmed.body.detail).toBe("Confirmed enrollments can only be changed by the academy");
  const dash = (await student.get("/api/v1/student/dashboard")).body;
  expect(dash.batches.map((b) => b.status)).toEqual(["active"]);
  expect(dash.balance).toBe(0);
  expect(dash.plans[0].usage.remaining).toBe(8);

  // Renewal / dues payments.
  const planId = r.body.plan.id;
  const pay = await student.post("/api/v1/student/payments").send({ amount: 1500, reference_no: "UTR9999", student_fee_plan_id: planId });
  expect(pay.status, pay.text).toBe(201);
  expect(pay.body).toMatchObject({ status: "pending", amount: 1500, plan_name: "8 sessions", student_name: "Student 1", batch_name: "Batch BEG" });
  expect(await AuditLog.countDocuments({ action: "submit", summary: "Submitted payment 1500" })).toBe(1);
  const tomorrow = await student.post("/api/v1/student/payments").send({ amount: 10, reference_no: "UTR0001", payment_date: "2026-10-16" });
  expect(tomorrow.status).toBe(201);
  const future = await student.post("/api/v1/student/payments").send({ amount: 10, reference_no: "UTR0002", payment_date: "2026-10-17" });
  expect(future.status).toBe(400);
  expect(future.body.detail).toBe("Payment date cannot be in the future");
  expect((await student.post("/api/v1/student/payments").send({ amount: 10, reference_no: "UT1" })).status).toBe(422);
  expect((await student.post("/api/v1/student/payments").send({ amount: -5, reference_no: "UTR0003" })).status).toBe(422);
  const otherPlan = await ledger.buildPlan({
    academyId: world.academy._id,
    studentId: s2._id,
    name: "Other",
    baseFee: 100,
    sessionsIncluded: 1,
    startDate: TODAY,
  }).save();
  const foreign = await student.post("/api/v1/student/payments").send({ amount: 10, reference_no: "UTR0004", student_fee_plan_id: sid(otherPlan) });
  expect(foreign.status).toBe(404);
  expect(foreign.body.detail).toBe("Plan not found");

  const payments = (await student.get("/api/v1/student/payments")).body;
  expect(payments.map((p) => [p.payment_date, p.amount])).toEqual([
    ["2026-10-16", 10],
    [TODAY, 1500],
    [TODAY, 4000],
  ]);
  expect(payments[2].verified_by_name).toBe("Admin");
});

test("payment proof upload", async () => {
  const world = await createWorld();
  const s1 = await world.student({ password: STUDENT1[1] });
  const student = await signIn(STUDENT1);
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#22aa66" } }).png().toBuffer();

  const r = await student.post("/api/v1/student/payment-proof").attach("file", png, "proof.png");
  expect(r.status, r.text).toBe(201);
  expect(r.body.url).toMatch(new RegExp(`^/media/payment-proofs/${sid(s1)}/[a-f0-9]{32}\\.webp$`));
  expect((await request(app).get(r.body.url)).status).toBe(200);

  const text = await student.post("/api/v1/student/payment-proof").attach("file", Buffer.from("not an image"), "proof.png");
  expect(text.status).toBe(400);
  expect(text.body.detail).toBe("The file is not a supported image");
  const none = await student.post("/api/v1/student/payment-proof").field("note", "x");
  expect(none.status).toBe(422);
  expect(none.body.detail[0].loc).toEqual(["body", "file"]);
  expect((await student.post("/api/v1/student/payment-proof").attach("image", png, "proof.png")).status).toBe(422);
  const big = await student
    .post("/api/v1/student/payment-proof")
    .attach("file", Buffer.alloc(config.maxUploadMb * 1024 * 1024 + 1), "big.png");
  expect(big.status).toBe(413);
  expect(big.body.detail).toBe(`Image is larger than ${config.maxUploadMb} MB`);
});

test("student books and cancels a make-up", async () => {
  const world = await createWorld();
  const s1 = await world.student({ password: STUDENT1[1] });
  await world.student({ password: STUDENT2[1] });
  await enrollActive(world, s1, world.batch);
  await generateOctober(world);
  const admin = await signIn(ADMIN);
  await adminRecord(admin, await sessionOn(world.batch, "2026-10-01"), { [sid(s1)]: "absent" });

  const student = await signIn(STUDENT1);
  const mine = (await student.get("/api/v1/student/makeups")).body;
  expect(mine.policy).toEqual(RULES.makeup);
  expect(mine.items).toHaveLength(1);
  const credit = mine.items[0];
  expect(credit).toMatchObject({ status: "available", original_batch_name: "Batch BEG", missed_session_date: "2026-10-01", expires_on: "2026-10-31" });

  const options = (await student.get(`/api/v1/student/makeups/${credit.id}/options`)).body;
  expect(options.length).toBeGreaterThan(0);
  expect(options.every((o) => o.batch_id === sid(world.batch2))).toBe(true); // never their own batch
  expect(options.every((o) => o.session_date >= TODAY && o.spots_left === 6 && o.skill_level === null)).toBe(true);

  const other = await signIn(STUDENT2);
  const foreign = await other.get(`/api/v1/student/makeups/${credit.id}/options`);
  expect(foreign.status).toBe(404);
  expect(foreign.body.detail).toBe("Not found");
  expect((await other.post(`/api/v1/student/makeups/${credit.id}/book`).send({ session_id: options[0].id })).status).toBe(404);

  const own = await sessionOn(world.batch, "2026-10-20");
  const regular = await student.post(`/api/v1/student/makeups/${credit.id}/book`).send({ session_id: sid(own) });
  expect(regular.status).toBe(409);
  expect(regular.body.detail).toBe("The student is already a regular in that batch");
  expect((await student.post(`/api/v1/student/makeups/${credit.id}/book`).send({})).status).toBe(422);
  const gone = await student.post(`/api/v1/student/makeups/${credit.id}/book`).send({ session_id: "0".repeat(24) });
  expect(gone.status).toBe(404);
  expect(gone.body.detail).toBe("Session not found");

  const target = options.find((o) => o.session_date > TODAY);
  const booked = await student.post(`/api/v1/student/makeups/${credit.id}/book`).send({ session_id: target.id });
  expect(booked.status, booked.text).toBe(200);
  expect(booked.body.status).toBe("booked");
  expect(booked.body.booked_session.id).toBe(target.id);
  expect(await AuditLog.countDocuments({ action: "book", entity_id: credit.id, summary: `Booked make-up into session ${target.id}` })).toBe(1);
  expect((await student.post(`/api/v1/student/makeups/${credit.id}/book`).send({ session_id: target.id })).status).toBe(409);

  const upcoming = (await student.get("/api/v1/student/sessions")).body;
  const makeup = upcoming.find((u) => u.kind === "makeup");
  expect(makeup).toMatchObject({ id: target.id, makeup_credit_id: credit.id, batch_name: "Batch INT" });
  expect(upcoming.map((u) => `${u.session_date} ${u.start_time}`)).toEqual(
    upcoming.map((u) => `${u.session_date} ${u.start_time}`).sort(),
  );
  expect((await student.get("/api/v1/student/dashboard")).body.makeups.booked).toBe(1);

  const cancelled = await student.post(`/api/v1/student/makeups/${credit.id}/cancel`);
  expect(cancelled.status).toBe(200);
  expect(cancelled.body.status).toBe("available");
  expect(await AuditLog.countDocuments({ action: "cancel_booking" })).toBe(1);
  const twice = await student.post(`/api/v1/student/makeups/${credit.id}/cancel`);
  expect(twice.status).toBe(409);
  expect(twice.body.detail).toBe("Make-up is not booked");

  // Booking and cancelling close booking_cutoff_hours (2 h) before the session starts (Monday 07:00 INT).
  const monday = await sessionOn(world.batch2, "2026-10-19");
  const bookMonday = () => student.post(`/api/v1/student/makeups/${credit.id}/book`).send({ session_id: sid(monday) });
  const closed = await at("2026-10-19", "05:30", bookMonday);
  expect(closed.status).toBe(409);
  expect(closed.body.detail).toBe("Booking for this session has closed");
  expect((await at("2026-10-19", "04:59", bookMonday)).status).toBe(200);
  const tooLate = await at("2026-10-19", "05:30", () => student.post(`/api/v1/student/makeups/${credit.id}/cancel`));
  expect(tooLate.status).toBe(409);
  expect(tooLate.body.detail).toBe("It is too late to cancel this booking");
  expect((await student.post(`/api/v1/student/makeups/${credit.id}/cancel`)).status).toBe(200);

  // When the academy books make-ups itself, students cannot.
  await Academy.updateOne({ _id: world.academy._id }, { $set: { "settings.makeup.student_can_book": false } });
  const academyBooks = await bookMonday();
  expect(academyBooks.status).toBe(409);
  expect(academyBooks.body.detail).toBe("Make-ups are booked by the academy; please contact the admin");
  expect((await student.get("/api/v1/student/makeups")).body.policy.student_can_book).toBe(false);

  // Overdue credits are expired when the student opens their make-ups.
  await MakeupCredit.updateOne({ _id: credit.id }, { $set: { expires_on: "2026-10-10" } });
  expect((await student.get("/api/v1/student/makeups")).body.items[0].status).toBe("expired");
  expect((await MakeupCredit.findById(credit.id)).status).toBe("expired");
});

test("coach dashboard, sessions, batches and hours", async () => {
  const world = await createWorld();
  const s1 = await world.student();
  await enrollActive(world, s1, world.batch);
  await generateOctober(world);
  await Announcement.create([
    { academy_id: world.academy._id, title: "Coach meeting", message: "Hi", audience: "coaches", status: "published" },
    { academy_id: world.academy._id, title: "Students only", message: "Hi", audience: "students", status: "published" },
  ]);
  const coach = await signIn(COACH);
  const coach2 = await signIn(COACH2);

  const dash = (await coach.get("/api/v1/coach/dashboard")).body;
  expect(dash.today.map((s) => [s.session_date, s.batch_code])).toEqual([[TODAY, "BEG"]]);
  expect(dash.today[0]).toMatchObject({ expected_count: 1, present_count: 0, absent_count: 0 });
  expect(dash.upcoming.map((s) => [s.session_date, s.batch_code])).toEqual([
    ["2026-10-19", "INT"],
    ["2026-10-20", "BEG"],
    ["2026-10-21", "INT"],
    ["2026-10-22", "BEG"],
  ]);
  expect(dash.needs_attendance.map((s) => s.session_date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
  expect(dash.month).toEqual({ label: "October 2026", sessions: 0, hours: 0, payable: 0 });
  expect(dash.announcements.map((a) => a.title)).toEqual(["Coach meeting"]);

  const upcoming = (await coach.get("/api/v1/coach/sessions")).body;
  expect(upcoming).toHaveLength(9);
  expect(upcoming[0]).toMatchObject({ session_date: TODAY, start_time: "17:00", expected_count: 1 });
  expect((await coach2.get("/api/v1/coach/sessions")).body.map((s) => s.batch_code)).toEqual(["INT", "INT", "INT", "INT"]);
  const month = (await coach.get("/api/v1/coach/sessions?scope=history&month=2026-10")).body;
  expect(month).toHaveLength(17);
  expect(month[0].session_date).toBe("2026-10-29");
  const recent = (await coach.get("/api/v1/coach/sessions?scope=history")).body;
  expect(recent.map((s) => s.session_date)).toEqual([
    "2026-10-15",
    "2026-10-14",
    "2026-10-13",
    "2026-10-12",
    "2026-10-08",
    "2026-10-07",
    "2026-10-06",
    "2026-10-05",
    "2026-10-01",
  ]);
  const bad = await coach.get("/api/v1/coach/sessions?scope=history&month=Oct");
  expect(bad.status).toBe(400);
  expect(bad.body.detail).toBe("month must be YYYY-MM");
  expect((await coach.get("/api/v1/coach/sessions?scope=history&month=2026-13")).status).toBe(400);
  expect((await coach.get("/api/v1/coach/sessions?scope=history&month=2026-9")).body).toEqual([]);

  const batches = (await coach.get("/api/v1/coach/batches")).body;
  expect(batches.map((b) => b.name)).toEqual(["Batch BEG", "Batch INT"]);
  expect(batches[0].students).toEqual([{ id: sid(s1), name: "Student 1", mobile: "9000000101", joined_on: "2026-10-01" }]);
  expect(batches[0].academy_id).toBe(sid(world.academy));
  expect(batches[1].students).toEqual([]);
  expect((await coach2.get("/api/v1/coach/batches")).body.map((b) => b.name)).toEqual(["Batch INT"]);

  const today = await sessionOn(world.batch, TODAY);
  const r = await coach.post(`/api/v1/sessions/${sid(today)}/attendance`).send({
    entries: [{ student_id: sid(s1), status: "present" }],
    coaches: [{ coach_id: sid(world.coach), hours_coached: 1 }],
  });
  expect(r.status, r.text).toBe(200);
  const hours = (await coach.get("/api/v1/coach/hours")).body;
  expect(hours.period).toEqual({ start: "2026-10-01", end: "2026-10-31" });
  expect(hours.totals).toEqual({ sessions: 1, hours: 1, payable: 800 });
  expect(hours.sessions[0]).toMatchObject({ session_id: sid(today), coach: "Coach One", batch: "Batch BEG", rate_applied: 800 });
  expect((await coach.get("/api/v1/coach/hours?month=2026-09")).body.sessions).toEqual([]);
  expect((await coach.get("/api/v1/coach/hours?month=2026-10")).body.period).toEqual({ start: "2026-10-01", end: "2026-10-31" });
  const badMonth = await coach.get("/api/v1/coach/hours?month=2026-00");
  expect(badMonth.status).toBe(400);
  expect(badMonth.body.detail).toBe("month must be YYYY-MM");
  expect((await coach2.get("/api/v1/coach/hours")).body.totals.sessions).toBe(0);
  expect((await coach.get("/api/v1/coach/dashboard")).body.month).toMatchObject({ sessions: 1, hours: 1, payable: 800 });
});

test("session detail, attendance window, walk-ins, candidates and removing attendees", async () => {
  const world = await createWorld();
  const s1 = await world.student();
  const s2 = await world.student();
  await enrollActive(world, s1, world.batch);
  await enrollActive(world, s2, world.batch2);
  await generateOctober(world);
  const today = await sessionOn(world.batch, TODAY);
  const old = await sessionOn(world.batch, "2026-10-06");
  const future = await sessionOn(world.batch, "2026-10-20");
  const coach = await signIn(COACH);
  const admin = await signIn(ADMIN);

  const detail = (await coach.get(`/api/v1/sessions/${sid(today)}`)).body;
  expect(detail).toMatchObject({ id: sid(today), status: "scheduled", can_edit: true, edit_blocked_reason: null, drop_in_fee: 500 });
  expect(detail.batch).toEqual({ id: sid(world.batch), name: "Batch BEG", skill_level: null, max_players: 6 });
  expect(detail.roster).toEqual([
    expect.objectContaining({ student_id: sid(s1), name: "Student 1", attendee_type: "regular", expected: true, status: null }),
  ]);
  expect((await coach.get(`/api/v1/sessions/${sid(future)}`)).body).toMatchObject({
    can_edit: false,
    edit_blocked_reason: "Attendance can be recorded on or after the session date",
  });
  expect((await coach.get(`/api/v1/sessions/${sid(old)}`)).body.edit_blocked_reason).toBe(
    "The edit window for this session has closed; ask the admin to correct it",
  );
  expect((await admin.get(`/api/v1/sessions/${sid(old)}`)).body).toMatchObject({ can_edit: true, edit_blocked_reason: null });

  // Coach records today's session; outside the window it is refused.
  const body = {
    entries: [{ student_id: sid(s1), status: "present" }],
    coaches: [{ coach_id: sid(world.coach), hours_coached: 1, adjustment_amount: 5000 }],
  };
  const r = await coach.post(`/api/v1/sessions/${sid(today)}/attendance`).send(body);
  expect(r.status, r.text).toBe(200);
  expect(r.body.status).toBe("completed");
  expect(r.body.roster[0]).toMatchObject({ student_id: sid(s1), status: "present", billing_mode: "package" });
  expect(r.body.coaches[0]).toMatchObject({ hours_coached: 1, adjustment_amount: 0, payable_amount: 800 }); // coaches cannot adjust pay
  const recorded = await AuditLog.findOne({ action: "record_attendance" });
  expect(recorded.entity_id).toBe(sid(today));
  expect(recorded.summary).toBe(`1/1 present on ${TODAY}`);
  expect(recorded.new_value_json.entries[0]).toMatchObject({ student_id: sid(s1), status: "present" });
  expect((await coach.post(`/api/v1/sessions/${sid(today)}/attendance`).send(body)).status).toBe(200);
  expect(await AuditLog.countDocuments({ action: "correct_attendance" })).toBe(1);
  const late = await coach.post(`/api/v1/sessions/${sid(old)}/attendance`).send(body);
  expect(late.status).toBe(403);
  expect(late.body.detail).toBe("The edit window for this session has closed; ask the admin to correct it");
  expect((await coach.post(`/api/v1/sessions/${sid(future)}/attendance`).send(body)).status).toBe(403);
  const invalid = await coach.post(`/api/v1/sessions/${sid(today)}/attendance`).send({ entries: [{ student_id: sid(s1), status: "late" }] });
  expect(invalid.status).toBe(422);
  expect(invalid.body.detail[0].loc).toEqual(["body", "entries", 0, "status"]);
  const addCoach = await coach
    .post(`/api/v1/sessions/${sid(today)}/attendance`)
    .send({ ...body, coaches: [{ coach_id: sid(world.coach2), hours_coached: 1 }] });
  expect(addCoach.status).toBe(403);
  expect(addCoach.body.detail).toBe("Only the admin can add a coach to a session");

  // Admin corrects an old session (s2 absent at INT earns a make-up credit).
  await adminRecord(admin, await sessionOn(world.batch2, "2026-10-12"), { [sid(s2)]: "absent" });
  expect(await MakeupCredit.countDocuments({ student_id: s2._id, status: "available" })).toBe(1);

  // Walk-in players.
  const walk = await coach.post(`/api/v1/sessions/${sid(today)}/walk-in`).send({ name: " Guest Player ", mobile: "+91 91111 11111" });
  expect(walk.status, walk.text).toBe(201);
  expect(walk.body).toMatchObject({ name: "Guest Player", mobile: "9111111111", existing: false });
  const guestId = walk.body.student_id;
  const profile = await StudentProfile.findById(guestId);
  expect(profile.source).toBe("walk_in");
  expect((await User.findById(guestId)).rolesFor(world.academy._id)).toEqual(["student"]);
  expect(await AuditLog.countDocuments({ action: "create_walk_in", entity_id: guestId })).toBe(1);
  const repeat = await coach.post(`/api/v1/sessions/${sid(today)}/walk-in`).send({ name: "Guest", mobile: "9111111111" });
  expect(repeat.status).toBe(201);
  expect(repeat.body).toEqual({ student_id: guestId, name: "Guest Player", mobile: "9111111111", existing: true });
  const staff = await coach.post(`/api/v1/sessions/${sid(today)}/walk-in`).send({ name: "Coach", mobile: "9000000012" });
  expect(staff.status).toBe(409);
  expect(staff.body.detail).toBe("That mobile number belongs to a staff account");
  const badMobile = await coach.post(`/api/v1/sessions/${sid(today)}/walk-in`).send({ name: "Guest", mobile: "12" });
  expect(badMobile.status).toBe(400);
  expect(badMobile.body.detail).toBe("Enter a valid mobile number");
  expect((await coach.post(`/api/v1/sessions/${sid(today)}/walk-in`).send({ name: "G", mobile: "9111111112" })).status).toBe(422);

  // Candidate search: name or mobile, at least two characters, with usable make-ups.
  expect((await coach.get(`/api/v1/sessions/${sid(today)}/candidates?q=g`)).body).toEqual([]);
  const guests = (await coach.get(`/api/v1/sessions/${sid(today)}/candidates?q=GUEST`)).body;
  expect(guests).toEqual([
    { student_id: guestId, name: "Guest Player", mobile: "9111111111", skill_level: null, is_regular: false, makeup_credits: [] },
  ]);
  expect((await coach.get(`/api/v1/sessions/${sid(today)}/candidates?q=91111`)).body.map((c) => c.student_id)).toEqual([guestId]);
  const students = (await coach.get(`/api/v1/sessions/${sid(today)}/candidates?q=student`)).body;
  expect(students.map((c) => [c.name, c.is_regular])).toEqual([
    ["Student 1", true],
    ["Student 2", false],
  ]);
  expect(students[1].makeup_credits).toEqual([
    expect.objectContaining({ status: "available", expires_on: "2026-11-11", original_batch_name: "Batch INT" }),
  ]);
  expect((await coach.get(`/api/v1/sessions/${sid(today)}/candidates?q=nobody`)).body).toEqual([]);

  // A credit that lapsed before today is not offered, even for an earlier session it would cover.
  const s2Credit = await MakeupCredit.findOne({ student_id: s2._id, status: "available" });
  await MakeupCredit.updateOne({ _id: s2Credit._id }, { $set: { expires_on: "2026-10-14" } });
  const tuesday = await sessionOn(world.batch, "2026-10-13");
  const lapsed = (await coach.get(`/api/v1/sessions/${sid(tuesday)}/candidates?q=${encodeURIComponent("student 2")}`)).body;
  expect(lapsed).toEqual([expect.objectContaining({ name: "Student 2", is_regular: false, makeup_credits: [] })]);
  expect((await MakeupCredit.findById(s2Credit._id)).status).toBe("available");
  await MakeupCredit.updateOne({ _id: s2Credit._id }, { $set: { expires_on: "2026-11-11" } });

  // A drop-in walk-in is charged the configured fee; a make-up attendee uses their credit.
  const withExtras = await coach.post(`/api/v1/sessions/${sid(today)}/attendance`).send({
    entries: [
      { student_id: sid(s1), status: "present" },
      { student_id: guestId, status: "present", attendee_type: "drop_in" },
      { student_id: sid(s2), status: "present", attendee_type: "makeup" },
    ],
    coaches: [{ coach_id: sid(world.coach), hours_coached: 1 }],
  });
  expect(withExtras.status, withExtras.text).toBe(200);
  const guestRow = withExtras.body.roster.find((x) => x.student_id === guestId);
  expect(guestRow).toMatchObject({ attendee_type: "drop_in", billing_mode: "drop_in", drop_in_fee: 500, expected: false });
  const makeupRow = withExtras.body.roster.find((x) => x.student_id === sid(s2));
  expect(makeupRow).toMatchObject({ attendee_type: "makeup", billing_mode: "makeup", original_batch_name: "Batch INT" });
  expect(await MakeupCredit.countDocuments({ student_id: s2._id, status: "used" })).toBe(1);

  // Removing attendees: extras only, within the coach's edit window, from this session.
  const regularRow = withExtras.body.roster.find((x) => x.student_id === sid(s1));
  const keep = await coach.delete(`/api/v1/sessions/${sid(today)}/attendance/${regularRow.attendance_id}`);
  expect(keep.status).toBe(409);
  expect(keep.body.detail).toBe("Regular students cannot be removed; mark them absent instead");
  const wrongSession = await coach.delete(`/api/v1/sessions/${sid(future)}/attendance/${guestRow.attendance_id}`);
  expect(wrongSession.status).toBe(403);
  const notHere = await admin.delete(`/api/v1/sessions/${sid(future)}/attendance/${guestRow.attendance_id}`);
  expect(notHere.status).toBe(404);
  expect(notHere.body.detail).toBe("Attendance not found");
  const removed = await coach.delete(`/api/v1/sessions/${sid(today)}/attendance/${guestRow.attendance_id}`);
  expect(removed.status, removed.text).toBe(200);
  expect(removed.body.roster.map((x) => x.student_id)).toEqual([sid(s1), sid(s2)]);
  expect(await SessionAttendance.exists({ _id: guestRow.attendance_id })).toBeNull();
  const removal = await AuditLog.findOne({ action: "remove_attendee" });
  expect(removal).toMatchObject({ entity_type: "session_attendance", entity_id: guestRow.attendance_id });
  expect(removal.summary).toBe(`Removed extra attendee from session ${sid(today)}`);
  expect(removal.old_value_json.billing_mode).toBe("drop_in");
  const ledgerNet = await ledger.referenceNet("attendance", guestRow.attendance_id);
  expect(ledgerNet).toBe(0); // the drop-in charge was reversed

  // A cancelled session cannot be edited by anyone.
  const cancelled = await sessionOn(world.batch, "2026-10-22");
  await tx(() => attSvc.cancelSession(cancelled, { adjustment: "carry_forward", venueChargeApplies: false, rules: RULES, actorId: world.admin._id }));
  expect((await admin.get(`/api/v1/sessions/${sid(cancelled)}`)).body).toMatchObject({
    status: "cancelled",
    can_edit: false,
    edit_blocked_reason: "This session was cancelled",
  });
  const recordCancelled = await admin.post(`/api/v1/sessions/${sid(cancelled)}/attendance`).send({ entries: [] });
  expect(recordCancelled.status).toBe(409);
  expect(recordCancelled.body.detail).toBe("This session was cancelled; reinstate it before recording attendance");
});
