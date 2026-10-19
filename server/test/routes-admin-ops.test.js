/** API tests for the admin people (students, coaches, users) and operations (venues, batches, sessions, make-ups) routes. */
import request from "supertest";
import { expect, test } from "vitest";

import { createApp } from "../src/app.js";
import { withTransaction } from "../src/db.js";
import {
  Academy,
  AuditLog,
  Batch,
  BatchStudent,
  CoachProfile,
  LedgerTransaction,
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
import { TODAY } from "./setup.js";
import { createWorld, login } from "./world.js";

const app = createApp();
const API = "/api/v1";
const RULES = BusinessRules.parse({});
const tx = (fn) => withTransaction(fn);

const ADMIN = ["9000000001", "Admin@12345"];
const COACH = ["9000000011", "Coach@12345"];
const STUDENT1 = ["9000000101", "Student@123"];

const signIn = ([mobile, password]) => login(request.agent(app), mobile, password);

/** Assert the status (showing the body on failure) and return the JSON body. */
function ok(res, status = 200) {
  expect(res.status, res.text).toBe(status);
  return res.body;
}

function fails(res, status, detail) {
  expect(res.status, res.text).toBe(status);
  if (detail !== undefined) expect(res.body.detail).toBe(detail);
  return res.body;
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

const sessionOn = (batch, date, startTime = null) =>
  Session.findOne({ batch_id: batch._id, session_date: date, ...(startTime ? { start_time: startTime } : {}) });

/** Record attendance through the service as the admin ({studentId: "present" | "absent"}). */
async function record(world, batch, date, statuses, rules = RULES) {
  const session = await sessionOn(batch, date);
  const entries = Object.entries(statuses).map(([studentId, status]) => ({ student_id: studentId, status }));
  return tx(async () =>
    attSvc.recordSession(await Session.findById(session._id), { entries, rules, actorId: world.admin._id, isAdmin: true }),
  );
}

const lastAudit = (action) => AuditLog.findOne({ action }).sort({ _id: -1 });

// ---------------------------------------------------------------------------------------------------------
// Access control

test("admin endpoints reject anonymous users, students and coaches", async () => {
  const world = await createWorld();
  await world.student({ password: "Student@123" });
  const student = await signIn(STUDENT1);
  const coach = await signIn(COACH);
  const admin = await signIn(ADMIN);
  const batchId = sid(world.batch);
  const probes = [
    ["get", "/admin/students"],
    ["get", `/admin/students/${sid(world.admin)}`],
    ["get", "/admin/coaches"],
    ["get", "/admin/users"],
    ["get", "/admin/ledger/recent"],
    ["get", "/admin/venues"],
    ["get", "/admin/batches"],
    ["get", `/admin/batches/${batchId}`],
    ["get", "/admin/sessions"],
    ["get", "/admin/makeups"],
    ["post", "/admin/students"],
    ["post", "/admin/venues"],
    ["patch", `/admin/batches/${batchId}`],
    ["put", `/admin/batches/${batchId}/coaches`],
    ["post", `/admin/users/${sid(world.admin)}/roles`],
    ["delete", `/admin/coaches/${sid(world.coach)}/rates/${sid(world.coach)}`],
  ];
  for (const [method, path] of probes) {
    expect((await request(app)[method](API + path).send({})).status, `${method} ${path}`).toBe(401);
    expect((await student[method](API + path).send({})).status, `${method} ${path}`).toBe(403);
    expect((await coach[method](API + path).send({})).status, `${method} ${path}`).toBe(403);
  }
  expect((await coach.get(`${API}/admin/students`)).body.detail).toBe("You do not have access to this area");
  for (const [method, path] of probes.filter(([m, p]) => m === "get" && !p.startsWith("/admin/students/"))) {
    ok(await admin[method](API + path));
  }
});

// ---------------------------------------------------------------------------------------------------------
// Students

test("students: create with opening balance and login, duplicates, list filters and paging", async () => {
  const world = await createWorld();
  const admin = await signIn(ADMIN);

  const created = ok(
    await admin.post(`${API}/admin/students`).send({
      name: "  Asha Rao ",
      mobile: "+91 98765 43210",
      email: "Asha@Example.com",
      password: "Asha@12345",
      skill_level: "beginner",
      guardian_name: "Ravi Rao",
      dob: "2012-05-01",
      opening_balance: -1500,
    }),
    201,
  );
  expect(Object.keys(created)).toEqual(["id"]);
  const asha = await User.findById(created.id);
  expect([asha.name, asha.mobile, asha.email, asha.joined_date, asha.dob]).toEqual([
    "Asha Rao",
    "9876543210",
    "asha@example.com",
    TODAY,
    "2012-05-01",
  ]);
  expect(asha.rolesFor(world.academy._id)).toEqual(["student"]);
  const profile = await StudentProfile.findById(created.id);
  expect([profile.source, profile.guardian_name, profile.skill_level]).toEqual(["admin", "Ravi Rao", "beginner"]);
  const opening = await LedgerTransaction.findOne({ student_id: asha._id });
  expect([opening.txn_type, opening.amount, opening.description, opening.txn_date]).toEqual([
    "opening_balance",
    -1500,
    "Opening balance (migrated)",
    TODAY,
  ]);
  expect((await lastAudit("create")).summary).toBe("Created student Asha Rao");
  await login(request.agent(app), "9876543210", "Asha@12345");

  fails(await admin.post(`${API}/admin/students`).send({ name: "Copy", mobile: "9876543210" }), 409, "A user with this mobile number already exists");
  fails(
    await admin.post(`${API}/admin/students`).send({ name: "Copy", mobile: "9876500000", email: "ASHA@example.com" }),
    409,
    "A user with this email already exists",
  );
  const bad = fails(await admin.post(`${API}/admin/students`).send({ name: "A", mobile: "123", password: "short" }), 422);
  expect(bad.detail.map((d) => d.loc.join("."))).toEqual(expect.arrayContaining(["body.name", "body.mobile", "body.password"]));

  // Student 1 (no login) has an active package; Student 2 owes nothing.
  const s1 = await world.student();
  const s2 = await world.student();
  await enrollActive(world, s1, world.batch);

  const all = ok(await admin.get(`${API}/admin/students`));
  expect(all.total).toBe(3);
  expect(all.items.map((s) => s.name)).toEqual(["Asha Rao", "Student 1", "Student 2"]);
  const [a, one, two] = all.items;
  expect(a).toMatchObject({ id: created.id, has_login: true, balance: -1500, active_batches: 0, source: "admin", profile_status: "active" });
  expect(a).toMatchObject({ status: "active", skill_level: "beginner", joined_date: TODAY, email: "asha@example.com", photo_url: null });
  expect(one).toMatchObject({ id: sid(s1), has_login: false, balance: -4000, active_batches: 1, source: "self" });
  expect(two).toMatchObject({ balance: 0, active_batches: 0 });

  expect(ok(await admin.get(`${API}/admin/students?dues=1`)).items.map((s) => s.name)).toEqual(["Asha Rao", "Student 1"]);
  expect(ok(await admin.get(`${API}/admin/students?batch_id=${sid(world.batch)}`)).items.map((s) => s.id)).toEqual([sid(s1)]);
  expect(ok(await admin.get(`${API}/admin/students?q=ASHA`)).total).toBe(1);
  expect(ok(await admin.get(`${API}/admin/students?q=98765`)).total).toBe(1);
  expect(ok(await admin.get(`${API}/admin/students?q=example.com`)).total).toBe(1);
  expect(ok(await admin.get(`${API}/admin/students?status=inactive`)).total).toBe(0);
  const paged = ok(await admin.get(`${API}/admin/students?page=2&page_size=1`));
  expect([paged.total, paged.page, paged.page_size, paged.items.map((s) => s.name)]).toEqual([3, 2, 1, ["Student 1"]]);
  expect(ok(await admin.get(`${API}/admin/students?page_size=0`)).page_size).toBe(1);
  fails(await admin.get(`${API}/admin/students?batch_id=12`), 422);

  // Recent ledger entries carry the student's name.
  const recent = ok(await admin.get(`${API}/admin/ledger/recent?limit=1`));
  expect(recent).toHaveLength(1);
  expect(recent[0]).toMatchObject({ student_name: "Student 1", txn_type: "charge", amount: -4000 });
  const everything = ok(await admin.get(`${API}/admin/ledger/recent`));
  expect(everything.map((t) => t.student_name)).toEqual(["Student 1", "Asha Rao"]);
});

test("student detail returns profile, plans with usage, payments, ledger, attendance and make-ups; patch updates both records", async () => {
  const world = await createWorld();
  const admin = await signIn(ADMIN);
  const s1 = await world.student();
  await enrollActive(world, s1, world.batch);
  await generateOctober(world);
  await record(world, world.batch, "2026-10-08", { [sid(s1)]: "present" });
  await record(world, world.batch, "2026-10-13", { [sid(s1)]: "absent" });
  const plan = await StudentFeePlan.findOne({ student_id: s1._id });
  await Payment.create({
    academy_id: world.academy._id,
    student_id: s1._id,
    student_fee_plan_id: plan._id,
    amount: 4000,
    payment_date: TODAY,
    reference_no: "UTR123",
  });

  const d = ok(await admin.get(`${API}/admin/students/${sid(s1)}`));
  expect(d).toMatchObject({ id: sid(s1), name: "Student 1", roles: ["student"], has_login: false, balance: -4000, status: "active" });
  expect(d.password_hash).toBeUndefined();
  expect(d.profile).toMatchObject({ id: sid(s1), user_id: sid(s1), status: "active", source: "self" });
  expect(d.enrollments).toHaveLength(1);
  expect(d.enrollments[0]).toMatchObject({ batch_id: sid(world.batch), batch_name: "Batch BEG", batch_code: "BEG", period_label: "2026-10", batch_status: "active", status: "active" });
  expect(d.plans).toHaveLength(1);
  expect(d.plans[0]).toMatchObject({ name: "8 sessions", status: "active", final_fee: 4000, per_session_value: 500, batch_name: "Batch BEG", student_name: "Student 1" });
  expect(d.plans[0].usage).toEqual({ sessions_included: 8, used: 2, refunded: 0, carried_forward: 0, makeups_attended: 0, remaining: 6 });
  expect(d.payments).toHaveLength(1);
  expect(d.payments[0]).toMatchObject({ amount: 4000, status: "pending", plan_name: "8 sessions", batch_name: "Batch BEG", student_name: "Student 1" });
  expect(d.ledger).toMatchObject({ opening_balance: 0, charges: 4000, closing_balance: -4000 });
  expect(d.ledger.entries).toHaveLength(1);
  expect(d.ledger.entries[0]).toMatchObject({ txn_type: "charge", amount: -4000, student_id: sid(s1) });
  expect(d.attendance.map((a) => [a.session.session_date, a.attendance_status])).toEqual([
    ["2026-10-13", "absent"],
    ["2026-10-08", "present"],
  ]);
  expect(d.attendance[0].session).toMatchObject({ batch_id: sid(world.batch), batch_name: "Batch BEG", venue_name: "Venue V1", status: "completed", start_time: "17:00" });
  expect(d.attendance[0].original_batch_name).toBe("Batch BEG");
  expect(d.makeups).toHaveLength(1);
  expect(d.makeups[0]).toMatchObject({ status: "available", missed_attendance_id: d.attendance[0].id, missed_session_date: "2026-10-13", original_batch_name: "Batch BEG" });

  const windowed = ok(await admin.get(`${API}/admin/students/${sid(s1)}?start=2026-10-14`));
  expect(windowed.ledger).toMatchObject({ opening_balance: -4000, closing_balance: -4000, entries: [] });
  fails(await admin.get(`${API}/admin/students/${sid(world.coach)}`), 404, "StudentProfile not found");
  fails(await admin.get(`${API}/admin/students/not-an-id`), 404, "StudentProfile not found");

  // Patch: user fields and profile fields; uniqueness of mobile and email.
  const other = await world.student();
  await User.updateOne({ _id: other._id }, { $set: { email: "taken@example.com" } });
  fails(await admin.patch(`${API}/admin/students/${sid(s1)}`).send({ email: "TAKEN@example.com" }), 409, "Another user has this email");
  fails(await admin.patch(`${API}/admin/students/${sid(s1)}`).send({ mobile: "9000000102" }), 409, "Another user has this mobile number");
  fails(await admin.patch(`${API}/admin/students/${sid(s1)}`).send({ profile_status: "paused" }), 422);
  expect(
    ok(
      await admin.patch(`${API}/admin/students/${sid(s1)}`).send({
        name: "Student One",
        email: "One@Example.com",
        mobile: "9000000101",
        skill_level: "advanced",
        notes: "Left-handed",
        profile_status: "inactive",
      }),
    ),
  ).toEqual({ ok: true });
  const user = await User.findById(s1._id);
  const profile = await StudentProfile.findById(s1._id);
  expect([user.name, user.email, user.status]).toEqual(["Student One", "one@example.com", "active"]);
  expect([profile.skill_level, profile.notes, profile.status]).toEqual(["advanced", "Left-handed", "inactive"]);
  const audit = await lastAudit("update");
  expect(audit.summary).toBe("Updated student Student One");
  expect(audit.old_value_json).toMatchObject({ name: "Student 1", status: "active", skill_level: null });
  expect(audit.new_value_json).toMatchObject({ name: "Student One", status: "inactive", skill_level: "advanced" });
  expect(ok(await admin.get(`${API}/admin/students?status=inactive`)).items.map((s) => s.name)).toEqual(["Student One"]);
});

// ---------------------------------------------------------------------------------------------------------
// Coaches

test("coaches: list with month totals, create with rate, detail, patch and effective-dated rates", async () => {
  const world = await createWorld();
  const admin = await signIn(ADMIN);
  const s1 = await world.student();
  await enrollActive(world, s1, world.batch);
  await generateOctober(world);
  await record(world, world.batch, "2026-10-13", { [sid(s1)]: "present" });

  const list = ok(await admin.get(`${API}/admin/coaches`));
  expect(list.map((c) => c.name)).toEqual(["Coach One", "Coach Two"]);
  expect(list[0]).toMatchObject({
    id: sid(world.coach),
    current_rate: 800,
    batches: 2,
    month_hours: 1,
    month_payable: 800,
    has_login: true,
    status: "active",
    profile_status: "active",
    is_public: true,
    display_order: 0,
  });
  expect(list[1]).toMatchObject({ current_rate: 600, batches: 1, month_hours: 0, month_payable: 0 });

  const c3 = ok(
    await admin.post(`${API}/admin/coaches`).send({
      name: "Coach Three",
      mobile: "9000000013",
      password: "Coach@12345",
      hourly_rate: 700,
      rate_effective_from: "2026-10-01",
      title: "Assistant",
      display_order: 5,
      is_public: false,
      experience_years: 4,
    }),
    201,
  );
  const p3 = await CoachProfile.findById(c3.id);
  expect([p3.title, p3.display_order, p3.is_public, p3.experience_years]).toEqual(["Assistant", 5, false, 4]);
  expect(p3.rates.map((r) => [r.hourly_rate, r.effective_from])).toEqual([[700, "2026-10-01"]]);
  const c4 = ok(await admin.post(`${API}/admin/coaches`).send({ name: "Coach Four", mobile: "9000000014", hourly_rate: 500 }), 201);
  expect((await CoachProfile.findById(c4.id)).rates[0].effective_from).toBe("2000-01-01");
  ok(await admin.post(`${API}/admin/coaches`).send({ name: "Coach Five", mobile: "9000000015" }), 201);
  fails(await admin.post(`${API}/admin/coaches`).send({ name: "Bad", mobile: "9000000016", experience_years: 81 }), 422);
  fails(await admin.post(`${API}/admin/coaches`).send({ name: "Bad", mobile: "9000000016", display_order: null }), 422);
  fails(await admin.post(`${API}/admin/coaches`).send({ name: "Bad", mobile: "9000000016", hourly_rate: -1 }), 422);
  fails(await admin.post(`${API}/admin/coaches`).send({ name: "Dup", mobile: "9000000011" }), 409, "A user with this mobile number already exists");

  const after = ok(await admin.get(`${API}/admin/coaches`));
  expect(after.map((c) => [c.name, c.current_rate])).toEqual([
    ["Coach Five", null],
    ["Coach Four", 500],
    ["Coach One", 800],
    ["Coach Two", 600],
    ["Coach Three", 700],
  ]);

  const detail = ok(await admin.get(`${API}/admin/coaches/${sid(world.coach)}`));
  expect(detail).toMatchObject({ name: "Coach One", roles: ["coach"], joined_date: TODAY, dob: null, gender: null, address: null, payouts: [] });
  expect(detail.rates).toEqual([expect.objectContaining({ hourly_rate: 800, effective_from: "2026-01-01", effective_to: null, coach_id: sid(world.coach) })]);
  expect(detail.assigned_batches.map((b) => [b.name, b.code, b.status, b.period_label])).toEqual([
    ["Batch BEG", "BEG", "active", "2026-10"],
    ["Batch INT", "INT", "active", "2026-10"],
  ]);

  // A new rate closes the previous one the day before; the list comes back newest first.
  const rates = ok(await admin.post(`${API}/admin/coaches/${sid(world.coach)}/rates`).send({ hourly_rate: 900, effective_from: "2026-11-01" }), 201);
  expect(rates.map((r) => [r.hourly_rate, r.effective_from, r.effective_to])).toEqual([
    [900, "2026-11-01", null],
    [800, "2026-01-01", "2026-10-31"],
  ]);
  expect((await lastAudit("set")).summary).toBe(`Coach ${sid(world.coach)} rate 900 from 2026-11-01`);
  fails(await admin.post(`${API}/admin/coaches/${sid(world.coach)}/rates`).send({ hourly_rate: -5, effective_from: "2026-11-01" }), 422);
  fails(await admin.post(`${API}/admin/coaches/${sid(s1)}/rates`).send({ hourly_rate: 5, effective_from: "2026-11-01" }), 404, "CoachProfile not found");

  const res = await admin.delete(`${API}/admin/coaches/${sid(world.coach)}/rates/${rates[0].id}`);
  expect(res.status, res.text).toBe(204);
  expect((await CoachProfile.findById(world.coach._id)).rates).toHaveLength(1);
  fails(await admin.delete(`${API}/admin/coaches/${sid(world.coach)}/rates/${rates[0].id}`), 404, "Rate not found");
  fails(await admin.delete(`${API}/admin/coaches/${sid(world.coach2)}/rates/${rates[1].id}`), 404, "Rate not found");
  expect((await lastAudit("delete")).summary).toBe("Deleted coach rate from 2026-11-01");

  expect(
    ok(await admin.patch(`${API}/admin/coaches/${sid(world.coach)}`).send({ title: "Head Coach", profile_status: "inactive", is_public: false, email: "c1@example.com" })),
  ).toEqual({ ok: true });
  const p1 = await CoachProfile.findById(world.coach._id);
  expect([p1.title, p1.status, p1.is_public]).toEqual(["Head Coach", "inactive", false]);
  expect((await User.findById(world.coach._id)).email).toBe("c1@example.com");
  expect((await lastAudit("update")).summary).toBe("Updated coach Coach One");
  expect(ok(await admin.get(`${API}/admin/coaches`)).map((c) => c.name)).not.toContain("Coach One");
  const inactive = ok(await admin.get(`${API}/admin/coaches?include_inactive=true`)).find((c) => c.name === "Coach One");
  expect(inactive).toMatchObject({ profile_status: "inactive", title: "Head Coach", is_public: false });
  fails(await admin.patch(`${API}/admin/coaches/${sid(world.coach)}`).send({ experience_years: -1 }), 422);
});

// ---------------------------------------------------------------------------------------------------------
// Users & access

test("users: list, create admin, grant/revoke roles, status and password reset", async () => {
  const world = await createWorld();
  const admin = await signIn(ADMIN);
  const st = await world.student({ password: "Student@123" });

  const users = ok(await admin.get(`${API}/admin/users`));
  expect(users.total).toBe(4);
  expect(users.items.map((u) => [u.name, u.roles])).toEqual([
    ["Admin", ["admin"]],
    ["Coach One", ["coach"]],
    ["Coach Two", ["coach"]],
    ["Student 1", ["student"]],
  ]);
  expect(users.items[0]).toMatchObject({ has_login: true, status: "active", mobile: "9000000001" });
  expect(users.items[0].last_login_at).not.toBeNull();
  expect(ok(await admin.get(`${API}/admin/users?role=coach`)).total).toBe(2);
  expect(ok(await admin.get(`${API}/admin/users?q=COACH`)).total).toBe(2);
  expect(ok(await admin.get(`${API}/admin/users?q=0000101`)).items.map((u) => u.name)).toEqual(["Student 1"]);
  expect(ok(await admin.get(`${API}/admin/users?page=2&page_size=3`)).items.map((u) => u.name)).toEqual(["Student 1"]);

  // Admin accounts need a password.
  fails(await admin.post(`${API}/admin/users`).send({ name: "Second Admin", mobile: "9000000002" }), 422);
  const second = ok(await admin.post(`${API}/admin/users`).send({ name: "Second Admin", mobile: "9000000002", password: "Second@123" }), 201);
  expect((await lastAudit("create_admin")).summary).toBe("Created admin Second Admin");
  await login(request.agent(app), "9000000002", "Second@123");
  fails(await admin.post(`${API}/admin/users`).send({ name: "Dup", mobile: "9000000002", password: "Second@123" }), 409);

  // Granting coach/student creates the missing profile.
  expect(ok(await admin.post(`${API}/admin/users/${sid(st)}/roles`).send({ role: "coach", grant: true }))).toEqual({ roles: ["coach", "student"] });
  const cp = await CoachProfile.findById(st._id);
  expect([cp.is_public, sid(cp.academy_id)]).toEqual([false, sid(world.academy)]);
  expect((await lastAudit("grant_role")).summary).toBe("Granted coach for Student 1");
  expect(ok(await admin.post(`${API}/admin/users/${second.id}/roles`).send({ role: "student", grant: true }))).toEqual({ roles: ["admin", "student"] });
  expect((await StudentProfile.findById(second.id)).source).toBe("admin");
  expect(ok(await admin.post(`${API}/admin/users/${sid(st)}/roles`).send({ role: "coach", grant: false }))).toEqual({ roles: ["student"] });
  expect(await CoachProfile.exists({ _id: st._id })).toBeTruthy();
  expect(ok(await admin.post(`${API}/admin/users/${sid(st)}/roles`).send({ role: "coach", grant: false }))).toEqual({ roles: ["student"] });
  fails(await admin.post(`${API}/admin/users/${sid(st)}/roles`).send({ role: "owner", grant: true }), 422);
  fails(await admin.post(`${API}/admin/users/${sid(world.academy)}/roles`).send({ role: "coach", grant: true }), 404, "User not found");

  // The last/own admin access cannot be removed; another admin's can.
  fails(await admin.post(`${API}/admin/users/${sid(world.admin)}/roles`).send({ role: "admin", grant: false }), 409, "You cannot remove your own admin access");
  expect(ok(await admin.post(`${API}/admin/users/${second.id}/roles`).send({ role: "admin", grant: false }))).toEqual({ roles: ["student"] });
  expect((await lastAudit("revoke_role")).summary).toBe("Revoked admin for Second Admin");

  // Status: you cannot deactivate yourself; deactivated users cannot sign in.
  fails(await admin.post(`${API}/admin/users/${sid(world.admin)}/status`).send({ status: "inactive" }), 409, "You cannot deactivate your own account");
  fails(await admin.post(`${API}/admin/users/${sid(st)}/status`).send({ status: "blocked" }), 422);
  expect(ok(await admin.post(`${API}/admin/users/${sid(st)}/status`).send({ status: "inactive" }))).toEqual({ status: "inactive" });
  expect((await lastAudit("set_status")).summary).toBe("Student 1 -> inactive");
  expect((await request(app).post(`${API}/auth/login`).send({ identifier: STUDENT1[0], password: STUDENT1[1] })).status).toBe(403);
  ok(await admin.post(`${API}/admin/users/${sid(st)}/status`).send({ status: "active" }));

  // Password reset (204) replaces the password.
  fails(await admin.post(`${API}/admin/users/${sid(st)}/password`).send({ new_password: "short" }), 422);
  const reset = await admin.post(`${API}/admin/users/${sid(st)}/password`).send({ new_password: "Changed@123" });
  expect(reset.status, reset.text).toBe(204);
  expect((await lastAudit("reset_password")).summary).toBe("Reset password for Student 1");
  expect((await request(app).post(`${API}/auth/login`).send({ identifier: STUDENT1[0], password: STUDENT1[1] })).status).toBe(401);
  await login(request.agent(app), STUDENT1[0], "Changed@123");
});

// ---------------------------------------------------------------------------------------------------------
// Venues

test("venues: create, list with current rates, four-slot rates with history, patch and rate delete", async () => {
  const world = await createWorld();
  const admin = await signIn(ADMIN);

  const v = ok(await admin.post(`${API}/admin/venues`).send({ code: "V3", name: "Venue Three", city: "Pune", courts_available: 3 }), 201);
  expect(v).toMatchObject({ code: "V3", city: "Pune", courts_available: 3, is_public: true, status: "active", rates: [] });
  expect(v.current_rates).toEqual({ weekday_morning: null, weekday_evening: null, weekend_morning: null, weekend_evening: null });
  expect((await lastAudit("create")).summary).toBe("Created venue Venue Three");
  fails(await admin.post(`${API}/admin/venues`).send({ code: "V3", name: "Again" }), 409, "A venue with this code already exists");
  fails(await admin.post(`${API}/admin/venues`).send({ code: "V9", name: "Too big", courts_available: 101 }), 422);
  const badStatus = fails(await admin.post(`${API}/admin/venues`).send({ code: "V9", name: "Closed", status: "closed" }), 422);
  expect(badStatus.detail[0]).toMatchObject({ loc: ["body", "status"], msg: "String should match pattern '^(active|inactive)$'" });

  const withRates = ok(
    await admin.post(`${API}/admin/venues/${v.id}/rates`).send({ effective_from: "2026-10-01", weekday_morning: 400, weekend_evening: "900" }),
    201,
  );
  expect(withRates.current_rates).toEqual({ weekday_morning: 400, weekday_evening: null, weekend_morning: null, weekend_evening: 900 });
  expect(withRates.rates).toHaveLength(2);
  expect(withRates.rates.every((r) => r.venue_id === v.id)).toBe(true);
  const setAudit = await lastAudit("set");
  expect([setAudit.summary, setAudit.new_value_json]).toEqual(["Venue Venue Three rates from 2026-10-01", { weekday_morning: "400", weekend_evening: "900" }]);
  fails(await admin.post(`${API}/admin/venues/${v.id}/rates`).send({ effective_from: "2026-10-01" }), 400, "Enter at least one rate");
  fails(await admin.post(`${API}/admin/venues/${v.id}/rates`).send({ effective_from: "2026-10-01", weekday_morning: -1 }), 422);

  const later = ok(await admin.post(`${API}/admin/venues/${v.id}/rates`).send({ effective_from: "2026-11-01", weekday_morning: 450 }), 201);
  expect(later.current_rates.weekday_morning).toBe(400);
  expect(later.rates[0]).toMatchObject({ day_type: "weekday", time_slot: "morning", hourly_rate: 450, effective_from: "2026-11-01", effective_to: null });
  expect(later.rates.find((r) => r.hourly_rate === 400).effective_to).toBe("2026-10-31");

  const list = ok(await admin.get(`${API}/admin/venues`));
  expect(list.map((x) => x.name)).toEqual(["Venue Three", "Venue V1", "Venue V2"]);
  expect(list[1].current_rates).toEqual({ weekday_morning: 600, weekday_evening: 800, weekend_morning: 900, weekend_evening: 1000 });
  expect(list[0].rates).toBeUndefined();

  const patched = ok(await admin.patch(`${API}/admin/venues/${v.id}`).send({ name: "Venue 3", status: "inactive" }));
  expect(patched).toMatchObject({ name: "Venue 3", status: "inactive" });
  expect(patched.rates).toHaveLength(3);
  expect((await lastAudit("update")).new_value_json).toEqual({ name: "Venue 3", status: "inactive" });
  expect(ok(await admin.get(`${API}/admin/venues?include_inactive=false`)).map((x) => x.code)).toEqual(["V1", "V2"]);

  const got = ok(await admin.get(`${API}/admin/venues/${v.id}`));
  expect(got.rates.map((r) => r.effective_from)).toEqual(["2026-11-01", "2026-10-01", "2026-10-01"]);
  const del = await admin.delete(`${API}/admin/venues/${v.id}/rates/${got.rates[0].id}`);
  expect(del.status, del.text).toBe(204);
  expect(ok(await admin.get(`${API}/admin/venues/${v.id}`)).rates).toHaveLength(2);
  fails(await admin.delete(`${API}/admin/venues/${v.id}/rates/${got.rates[0].id}`), 404, "Rate not found");
  fails(await admin.delete(`${API}/admin/venues/${sid(world.venue)}/rates/${got.rates[1].id}`), 404, "Rate not found");
  fails(await admin.get(`${API}/admin/venues/${sid(world.batch)}`), 404, "Venue not found");
});

// ---------------------------------------------------------------------------------------------------------
// Batches

test("batches: create with schedules and coaches, validation, list filters, detail and patch", async () => {
  const world = await createWorld();
  const admin = await signIn(ADMIN);
  const V2 = sid(world.venue2);
  const base = {
    code: "ADV",
    name: "Advanced",
    period_label: "2026-11",
    start_date: "2026-11-02",
    end_date: "2026-11-30",
    price: 3000,
    schedules: [
      { weekday: 0, start_time: "18:00", end_time: "19:30", venue_id: V2, courts: 2 },
      { weekday: 4, start_time: "18:00:00", end_time: "19:30", venue_id: V2 },
    ],
    coaches: [{ coach_id: sid(world.coach2) }],
  };
  const adv = ok(await admin.post(`${API}/admin/batches`).send(base), 201);
  expect(adv).toMatchObject({ code: "ADV", status: "upcoming", min_players: 4, max_players: 6, price: 3000, display_price: 3000, fee_plan: null });
  expect(adv).toMatchObject({ seats_taken: 0, seats_left: 6, display_status: "upcoming", is_public: true, duration_minutes: 60 });
  expect(adv.schedules.map((s) => [s.weekday_name, s.start_time, s.end_time, s.courts, s.venue_name])).toEqual([
    ["Monday", "18:00", "19:30", 2, "Venue V2"],
    ["Friday", "18:00", "19:30", 1, "Venue V2"],
  ]);
  expect(adv.coaches).toEqual([{ coach_id: sid(world.coach2), name: "Coach Two", role: "lead", photo_url: null }]);
  expect((await lastAudit("create")).summary).toBe("Created batch Advanced");

  const reversed = fails(
    await admin.post(`${API}/admin/batches`).send({ ...base, code: "X", schedules: [{ weekday: 1, start_time: "19:00", end_time: "18:00", venue_id: V2 }] }),
    422,
  );
  expect(reversed.detail[0]).toMatchObject({ loc: ["body", "schedules", 0], msg: "Value error, Schedule end time must be after start time" });
  fails(await admin.post(`${API}/admin/batches`).send({ ...base, code: "X", min_players: 5, max_players: 4 }), 400, "Minimum players cannot exceed maximum players");
  fails(await admin.post(`${API}/admin/batches`).send({ ...base, code: "X", end_date: "2026-11-01" }), 400, "Batch end date is before its start date");
  fails(await admin.post(`${API}/admin/batches`).send({ ...base, code: "X", program_id: sid(world.venue) }), 404, "Program not found");
  fails(await admin.post(`${API}/admin/batches`).send({ ...base, code: "X", fee_plan_id: sid(world.venue) }), 404, "FeePlan not found");
  fails(
    await admin.post(`${API}/admin/batches`).send({ ...base, code: "X", coaches: [{ coach_id: sid(world.coach) }, { coach_id: sid(world.coach), role: "assistant" }] }),
    400,
    "A coach is listed twice",
  );
  fails(await admin.post(`${API}/admin/batches`).send({ ...base, code: "X", coaches: [{ coach_id: sid(world.admin) }] }), 404, "CoachProfile not found");
  fails(
    await admin.post(`${API}/admin/batches`).send({ ...base, code: "X", schedules: [{ weekday: 1, start_time: "18:00", end_time: "19:00", venue_id: sid(world.coach) }] }),
    404,
    "Venue not found",
  );
  fails(await admin.post(`${API}/admin/batches`).send(base), 409, "A batch with this code already exists for that period");
  fails(await admin.post(`${API}/admin/batches`).send({ ...base, code: "X", duration_minutes: 10 }), 422);
  fails(await admin.post(`${API}/admin/batches`).send({ ...base, code: "X", status: "full" }), 422);
  expect(await Batch.countDocuments({ code: "X" })).toBe(0);

  // One active and one pending enrollment in BEG; sessions generated for October.
  const s1 = await world.student();
  const s2 = await world.student();
  await enrollActive(world, s1, world.batch);
  const pending = ok(await admin.post(`${API}/admin/batches/${sid(world.batch)}/enrollments`).send({ student_id: sid(s2), activate: false }), 201);
  await Payment.create({
    academy_id: world.academy._id,
    student_id: s2._id,
    student_fee_plan_id: pending.plan.id,
    amount: 4000,
    payment_date: TODAY,
    reference_no: "UTR777",
  });
  await generateOctober(world);
  await record(world, world.batch, "2026-10-13", { [sid(s1)]: "present" });

  const list = ok(await admin.get(`${API}/admin/batches`));
  expect(list.map((b) => b.code)).toEqual(["BEG", "INT", "ADV"]);
  expect(list[0]).toMatchObject({ seats_taken: 2, pending_enrollments: 1, display_price: 4000 });
  expect(list[1].pending_enrollments).toBe(0);
  expect(ok(await admin.get(`${API}/admin/batches?q=adv`)).map((b) => b.code)).toEqual(["ADV"]);
  expect(ok(await admin.get(`${API}/admin/batches?status=active`)).map((b) => b.code)).toEqual(["BEG", "INT"]);
  expect(ok(await admin.get(`${API}/admin/batches?coach_id=${sid(world.coach2)}`)).map((b) => b.code)).toEqual(["INT", "ADV"]);
  expect(ok(await admin.get(`${API}/admin/batches?venue_id=${sid(world.venue)}`)).map((b) => b.code)).toEqual(["BEG"]);

  const d = ok(await admin.get(`${API}/admin/batches/${sid(world.batch)}`));
  expect(d).toMatchObject({ seats_taken: 2, seats_left: 4, last_session_date: "2026-10-29", session_counts: { scheduled: 8, completed: 1 } });
  expect(d.fee_plan).toEqual({ id: sid(world.plan8), name: "8 sessions", base_fee: 4000, number_of_sessions: 8, plan_type: "monthly" });
  expect(d.enrollments.map((e) => [e.student_name, e.status])).toEqual([
    ["Student 1", "active"],
    ["Student 2", "pending"],
  ]);
  expect(d.enrollments[0]).toMatchObject({ student_mobile: "9000000101", pending_payment: null });
  expect(d.enrollments[0].plan).toMatchObject({ name: "8 sessions", final_fee: 4000, status: "active" });
  expect(d.enrollments[1].plan).toMatchObject({ id: pending.plan.id, status: "pending" });
  expect(d.enrollments[1].pending_payment).toEqual({ id: expect.any(String), amount: 4000, reference_no: "UTR777" });
  expect(d.sessions).toHaveLength(9);
  const oct13 = d.sessions.find((s) => s.session_date === "2026-10-13");
  expect(oct13).toMatchObject({ status: "completed", present_count: 1, absent_count: 0, expected_count: 1, batch_name: "Batch BEG", venue_name: "Venue V1" });
  fails(await admin.get(`${API}/admin/batches/${sid(world.venue)}`), 404, "Batch not found");

  // Capacity can't drop below the seats taken (pending counts).
  fails(await admin.patch(`${API}/admin/batches/${sid(world.batch)}`).send({ min_players: 1, max_players: 1 }), 400, "2 students are enrolled; capacity cannot go below that");
  fails(await admin.patch(`${API}/admin/batches/${sid(world.batch)}`).send({ min_players: 7 }), 400, "Minimum players cannot exceed maximum players");
  fails(await admin.patch(`${API}/admin/batches/${sid(world.batch)}`).send({ max_players: 0 }), 422);
  const patched = ok(await admin.patch(`${API}/admin/batches/${sid(world.batch)}`).send({ name: "Beginners", max_players: 8, price: 3500.555, program_id: null }));
  expect(patched).toMatchObject({ name: "Beginners", max_players: 8, price: 3500.56, seats_left: 6, program_id: null });
  const audit = await lastAudit("update");
  expect([audit.summary, audit.old_value_json, audit.new_value_json]).toEqual([
    "Updated batch Beginners",
    { name: "Batch BEG", max_players: 6, price: null },
    { name: "Beginners", max_players: 8, price: 3500.56 },
  ]);
});

test("batch schedules and coaches, session generation and roll-over to the next period", async () => {
  const world = await createWorld();
  const admin = await signIn(ADMIN);
  const BEG = sid(world.batch);

  expect(ok(await admin.post(`${API}/admin/batches/${BEG}/generate-sessions`).send({}))).toEqual({ created: 9, start: "2026-10-01", end: "2026-10-31" });
  expect((await lastAudit("generate_sessions")).summary).toBe("Generated 9 sessions for Batch BEG (2026-10-01 – 2026-10-31)");
  expect(ok(await admin.post(`${API}/admin/batches/${BEG}/generate-sessions`).send({ start: "2026-10-01", end: "2026-10-10" }))).toEqual({
    created: 0,
    start: "2026-10-01",
    end: "2026-10-10",
  });
  const empty = await Batch.create({ academy_id: world.academy._id, code: "NONE", name: "No schedule", status: "upcoming" });
  fails(await admin.post(`${API}/admin/batches/${sid(empty)}/generate-sessions`).send({}), 400, "Add at least one schedule row before generating sessions");
  await Batch.updateOne({ _id: empty._id }, { $set: { status: "cancelled" } });
  fails(await admin.post(`${API}/admin/batches/${sid(empty)}/generate-sessions`).send({}), 409, "Cannot generate sessions for a cancelled batch");

  // New schedule: existing sessions keep their date/time but lose the link to the removed rows.
  const scheduled = ok(
    await admin.put(`${API}/admin/batches/${BEG}/schedules`).send([{ weekday: 1, start_time: "18:00", end_time: "19:00", venue_id: sid(world.venue2), courts: 1 }]),
  );
  expect(scheduled.schedules.map((s) => [s.weekday, s.start_time, s.venue_name])).toEqual([[1, "18:00", "Venue V2"]]);
  expect(await Session.countDocuments({ batch_id: world.batch._id, schedule_id: { $ne: null } })).toBe(0);
  expect(await Session.countDocuments({ batch_id: world.batch._id })).toBe(9);
  const schedAudit = await lastAudit("set_schedules");
  expect(schedAudit.summary).toBe("Updated schedule for Batch BEG");
  expect(schedAudit.old_value_json.schedules).toHaveLength(2);
  fails(await admin.put(`${API}/admin/batches/${BEG}/schedules`).send([{ weekday: 1, start_time: "18:00", end_time: "19:00", venue_id: BEG }]), 404, "Venue not found");
  fails(await admin.put(`${API}/admin/batches/${BEG}/schedules`).send({ weekday: 1 }), 422);
  fails(await admin.put(`${API}/admin/batches/${BEG}/schedules`).send([{ weekday: 7, start_time: "18:00", end_time: "19:00", venue_id: BEG }]), 422);

  // Coaches: upcoming scheduled sessions follow the batch unless told otherwise.
  const both = ok(
    await admin.put(`${API}/admin/batches/${BEG}/coaches`).send([
      { coach_id: sid(world.coach2), role: "lead" },
      { coach_id: sid(world.coach), role: "assistant" },
    ]),
  );
  expect(both.coaches.map((c) => [c.name, c.role])).toEqual([
    ["Coach Two", "lead"],
    ["Coach One", "assistant"],
  ]);
  const coachNames = async (date) => (await sessionOn(world.batch, date)).coaches.map((c) => sid(c.coach_id));
  expect(await coachNames("2026-10-13")).toEqual([sid(world.coach)]);
  expect(await coachNames("2026-10-15")).toEqual([sid(world.coach), sid(world.coach2)]);
  expect((await sessionOn(world.batch, "2026-10-15")).coaches[1].scheduled_hours).toBe(1);
  const coachAudit = await lastAudit("set_coaches");
  expect([coachAudit.old_value_json, coachAudit.new_value_json]).toEqual([{ coaches: [sid(world.coach)] }, { coaches: [sid(world.coach2), sid(world.coach)] }]);

  ok(await admin.put(`${API}/admin/batches/${BEG}/coaches?apply_to_future_sessions=false`).send([{ coach_id: sid(world.coach2) }]));
  expect((await Batch.findById(world.batch._id)).coaches.map((c) => sid(c.coach_id))).toEqual([sid(world.coach2)]);
  expect(await coachNames("2026-10-20")).toEqual([sid(world.coach), sid(world.coach2)]);
  ok(await admin.put(`${API}/admin/batches/${BEG}/coaches`).send([{ coach_id: sid(world.coach2) }]));
  expect(await coachNames("2026-10-20")).toEqual([sid(world.coach2)]);
  expect(await coachNames("2026-10-13")).toEqual([sid(world.coach)]);
  fails(await admin.put(`${API}/admin/batches/${BEG}/coaches`).send([{ coach_id: sid(world.admin) }]), 404, "CoachProfile not found");
  fails(await admin.put(`${API}/admin/batches/${BEG}/coaches`).send([{ coach_id: sid(world.coach), role: "head" }]), 422);

  // Roll-over: current students re-enrolled as pending, sessions generated for the new period.
  const s1 = await world.student();
  const s2 = await world.student();
  const s3 = await world.student();
  await enrollActive(world, s1, world.batch);
  await enrollActive(world, s2, world.batch);
  await enrollActive(world, s3, world.batch);
  await StudentProfile.updateOne({ _id: s3._id }, { $set: { status: "inactive" } });
  const dup = ok(
    await admin.post(`${API}/admin/batches/${BEG}/duplicate`).send({ period_label: "2026-11", start_date: "2026-11-03", end_date: "2026-11-30" }),
    201,
  );
  expect(dup).toEqual({ id: expect.any(String), students_copied: 2, sessions_generated: 4 });
  const next = await Batch.findById(dup.id);
  expect([next.code, next.name, next.period_label, next.status, next.start_date, next.end_date, next.max_players]).toEqual([
    "BEG",
    "Batch BEG",
    "2026-11",
    "upcoming",
    "2026-11-03",
    "2026-11-30",
    6,
  ]);
  expect(next.schedules.map((s) => [s.weekday, s.start_time, sid(s.venue_id)])).toEqual([[1, "18:00", sid(world.venue2)]]);
  expect(next.coaches.map((c) => sid(c.coach_id))).toEqual([sid(world.coach2)]);
  const copied = await BatchStudent.find({ batch_id: next._id }).sort({ _id: 1 });
  expect(copied.map((e) => [sid(e.student_id), e.status, e.joined_on])).toEqual([
    [sid(s1), "pending", "2026-11-03"],
    [sid(s2), "pending", "2026-11-03"],
  ]);
  expect(await StudentFeePlan.countDocuments({ batch_id: next._id, status: "pending" })).toBe(2);
  expect((await Session.find({ batch_id: next._id }).sort({ session_date: 1 })).map((s) => s.session_date)).toEqual([
    "2026-11-03",
    "2026-11-10",
    "2026-11-17",
    "2026-11-24",
  ]);
  expect((await lastAudit("duplicate")).summary).toBe(`Created Batch BEG 2026-11 from batch ${BEG}; 2 students, 4 sessions`);
  fails(await admin.post(`${API}/admin/batches/${BEG}/duplicate`).send({ period_label: "2026-11", start_date: "2026-11-03" }), 409, "This batch already exists for that period");
  const bare = ok(
    await admin.post(`${API}/admin/batches/${BEG}/duplicate`).send({ period_label: "2026-12", start_date: "2026-12-01", copy_students: false }),
    201,
  );
  expect(bare).toMatchObject({ students_copied: 0, sessions_generated: 0 });
  fails(await admin.post(`${API}/admin/batches/${BEG}/duplicate`).send({ period_label: "", start_date: "2026-12-01" }), 422);
});

// ---------------------------------------------------------------------------------------------------------
// Enrollments

test("enrollments: admin enroll with discount, pending approval, end and capacity override", async () => {
  const world = await createWorld();
  const admin = await signIn(ADMIN);
  const BEG = sid(world.batch);
  const [s1, s2, s3, s4] = [await world.student(), await world.student(), await world.student(), await world.student()];

  const first = ok(
    await admin.post(`${API}/admin/batches/${BEG}/enrollments`).send({ student_id: sid(s1), discount_type: "percent", discount_value: 10 }),
    201,
  );
  expect(first.enrollment).toMatchObject({ student_id: sid(s1), batch_id: BEG, status: "active", source: "admin", joined_on: TODAY, capacity_override: false });
  expect(first.plan).toMatchObject({ status: "active", base_fee: 4000, final_fee: 3600, per_session_value: 450, discount_type: "percent", discount_value: 10 });
  expect(first.plan.batch_student_id).toBe(first.enrollment.id);
  expect(await ledger.balance(s1._id)).toBe(-3600);
  expect((await lastAudit("admin_enroll")).summary).toBe("Enrolled Student 1 in Batch BEG");
  fails(await admin.post(`${API}/admin/batches/${BEG}/enrollments`).send({ student_id: sid(s1) }), 409, "Already enrolled (or awaiting confirmation) in this batch");
  fails(await admin.post(`${API}/admin/batches/${BEG}/enrollments`).send({ student_id: sid(world.coach) }), 404, "StudentProfile not found");
  fails(await admin.post(`${API}/admin/batches/${BEG}/enrollments`).send({ student_id: sid(s2), discount_type: "half" }), 422);
  fails(await admin.post(`${API}/admin/batches/${BEG}/enrollments`).send({ student_id: sid(s2), discount_value: -1 }), 422);

  // Pending until approved; approving bills the package.
  const second = ok(await admin.post(`${API}/admin/batches/${BEG}/enrollments`).send({ student_id: sid(s2), activate: false, start_date: "2026-10-20" }), 201);
  expect(second.enrollment).toMatchObject({ status: "pending", joined_on: "2026-10-20" });
  expect(second.plan).toMatchObject({ status: "pending", start_date: "2026-10-20" });
  expect(await ledger.balance(s2._id)).toBe(0);
  const approved = ok(await admin.post(`${API}/admin/enrollments/${second.enrollment.id}/approve`));
  expect(approved).toMatchObject({ id: second.enrollment.id, status: "active" });
  expect((await StudentFeePlan.findById(second.plan.id)).status).toBe("active");
  expect(await ledger.balance(s2._id)).toBe(-4000);
  expect((await lastAudit("approve")).summary).toBe("Approved enrollment");
  ok(await admin.post(`${API}/admin/enrollments/${second.enrollment.id}/approve`));
  fails(await admin.post(`${API}/admin/enrollments/${BEG}/approve`), 404, "Enrollment not found");
  fails(await admin.post(`${API}/admin/enrollments/nope/approve`), 404, "Enrollment not found");

  // Ending: left keeps the plan; rejected cancels the pending plan and its charge.
  const left = ok(await admin.post(`${API}/admin/enrollments/${first.enrollment.id}/end`).send({ status: "left", left_on: "2026-10-20", notes: "Moved city" }));
  expect(left).toMatchObject({ status: "left", left_on: "2026-10-20", notes: "Moved city" });
  expect((await lastAudit("left")).summary).toBe("Enrollment left");
  const third = ok(await admin.post(`${API}/admin/batches/${BEG}/enrollments`).send({ student_id: sid(s3), activate: false }), 201);
  const rejected = ok(await admin.post(`${API}/admin/enrollments/${third.enrollment.id}/end`).send({ status: "rejected" }));
  expect(rejected).toMatchObject({ status: "rejected", left_on: TODAY });
  expect((await StudentFeePlan.findById(third.plan.id)).status).toBe("cancelled");
  fails(await admin.post(`${API}/admin/enrollments/${third.enrollment.id}/approve`), 409, "Enrollment is rejected");
  fails(await admin.post(`${API}/admin/enrollments/${third.enrollment.id}/end`).send({ status: "paused" }), 422);

  // Capacity: a full batch needs an explicit override.
  await Batch.updateOne({ _id: world.batch._id }, { $set: { max_players: 1 } });
  fails(await admin.post(`${API}/admin/batches/${BEG}/enrollments`).send({ student_id: sid(s4) }), 409, "This batch is full");
  const forced = ok(await admin.post(`${API}/admin/batches/${BEG}/enrollments`).send({ student_id: sid(s4), override_capacity: true }), 201);
  expect(forced.enrollment).toMatchObject({ capacity_override: true, status: "active" });
  expect((await lastAudit("admin_enroll")).summary).toBe("Enrolled Student 4 in Batch BEG (capacity override)");

  // A batch price without a fee plan builds the plan from the remaining occurrences.
  const priced = await Batch.create({
    academy_id: world.academy._id,
    code: "PRC",
    name: "Priced",
    period_label: "2026-10",
    start_date: "2026-10-01",
    end_date: "2026-10-31",
    price: 2000,
    status: "active",
    schedules: [{ weekday: 1, start_time: "06:00", end_time: "07:00", venue_id: world.venue._id }],
  });
  const p = ok(await admin.post(`${API}/admin/batches/${sid(priced)}/enrollments`).send({ student_id: sid(s3) }), 201);
  expect(p.plan).toMatchObject({ name: "Priced (2026-10)", final_fee: 2000, sessions_included: 2, status: "active" });
});

// ---------------------------------------------------------------------------------------------------------
// Sessions

test("sessions: list filters, one-off create, patch, coaches & rates, cancel, reinstate, refresh rates and delete", async () => {
  const world = await createWorld();
  const admin = await signIn(ADMIN);
  const BEG = sid(world.batch);
  const s1 = await world.student();
  await enrollActive(world, s1, world.batch);
  await generateOctober(world);

  const list = ok(await admin.get(`${API}/admin/sessions`));
  expect([list.total, list.page, list.page_size]).toEqual([13, 1, 100]);
  expect(list.items[0]).toMatchObject({ session_date: "2026-10-08", batch_name: "Batch BEG", expected_count: 1, present_count: 0, absent_count: 0 });
  expect(list.items.map((s) => s.session_date)).toEqual([...list.items.map((s) => s.session_date)].sort());
  expect(ok(await admin.get(`${API}/admin/sessions?batch_id=${BEG}`)).total).toBe(7);
  expect(ok(await admin.get(`${API}/admin/sessions?venue_id=${sid(world.venue2)}`)).total).toBe(6);
  expect(ok(await admin.get(`${API}/admin/sessions?coach_id=${sid(world.coach2)}`)).total).toBe(6);
  expect(ok(await admin.get(`${API}/admin/sessions?status=completed`)).total).toBe(0);
  expect(ok(await admin.get(`${API}/admin/sessions?start=2026-10-01&end=2026-10-31`)).total).toBe(17);
  const paged = ok(await admin.get(`${API}/admin/sessions?page=2&page_size=5`));
  expect([paged.items.length, paged.total, paged.page_size]).toEqual([5, 13, 5]);
  fails(await admin.get(`${API}/admin/sessions?start=15-10-2026`), 422);

  // One-off session: coaches default to the batch coaches.
  const extra = ok(
    await admin.post(`${API}/admin/sessions`).send({ batch_id: BEG, session_date: "2026-10-24", start_time: "09:00", end_time: "10:30", venue_id: sid(world.venue2), courts_booked: 2, remarks: "Extra class" }),
    201,
  );
  expect(extra).toMatchObject({ status: "scheduled", duration_minutes: 90, schedule_id: null, courts_booked: 2, remarks: "Extra class", venue_name: "Venue V2" });
  expect(extra.coaches.map((c) => [c.coach_id, c.name, c.scheduled_hours])).toEqual([[sid(world.coach), "Coach One", 1.5]]);
  expect((await lastAudit("create")).summary).toBe("Added session Batch BEG 2026-10-24");
  fails(
    await admin.post(`${API}/admin/sessions`).send({ batch_id: BEG, session_date: "2026-10-24", start_time: "09:00", end_time: "10:00", venue_id: sid(world.venue2) }),
    409,
    "A session already exists at that date and time",
  );
  fails(
    await admin.post(`${API}/admin/sessions`).send({ batch_id: BEG, session_date: "2026-10-25", start_time: "10:00", end_time: "10:00", venue_id: sid(world.venue2) }),
    400,
    "End time must be after start time",
  );
  fails(
    await admin.post(`${API}/admin/sessions`).send({ batch_id: BEG, session_date: "2026-10-25", start_time: "09:00", end_time: "10:00", venue_id: BEG }),
    404,
    "Venue not found",
  );
  const chosen = ok(
    await admin.post(`${API}/admin/sessions`).send({ batch_id: BEG, session_date: "2026-10-25", start_time: "09:00", end_time: "10:00", venue_id: sid(world.venue), coach_ids: [sid(world.coach2)] }),
    201,
  );
  expect(chosen.coaches.map((c) => c.name)).toEqual(["Coach Two"]);

  // Patch a scheduled session: time changes recompute duration and scheduled hours.
  const moved = ok(await admin.patch(`${API}/admin/sessions/${extra.id}`).send({ start_time: "09:30", session_date: "2026-10-26" }));
  expect(moved).toMatchObject({ start_time: "09:30", end_time: "10:30", duration_minutes: 60, session_date: "2026-10-26" });
  expect(moved.coaches[0].scheduled_hours).toBe(1);
  fails(await admin.patch(`${API}/admin/sessions/${extra.id}`).send({ end_time: "09:00" }), 400, "End time must be after start time");
  fails(await admin.patch(`${API}/admin/sessions/${extra.id}`).send({ courts_booked: 51 }), 422);

  // Recorded sessions: no date moves; venue changes re-snapshot the court payable.
  await record(world, world.batch, "2026-10-13", { [sid(s1)]: "present" });
  const oct13 = await sessionOn(world.batch, "2026-10-13");
  expect([oct13.venue_rate_applied, oct13.court_payable]).toEqual([800, 1600]);
  fails(await admin.patch(`${API}/admin/sessions/${sid(oct13)}`).send({ session_date: "2026-10-14" }), 409, "Only scheduled sessions can be moved to another date");
  const revenue = ok(await admin.patch(`${API}/admin/sessions/${sid(oct13)}`).send({ venue_id: sid(world.venue2), courts_booked: 1, session_date: "2026-10-13" }));
  expect(revenue).toMatchObject({ venue_rate_applied: 700, court_payable: 700, venue_name: "Venue V2" });
  expect((await lastAudit("update")).summary).toBe("Updated session 2026-10-13");

  // Coaches, hours and rates for one session.
  const coached = ok(
    await admin.put(`${API}/admin/sessions/${sid(oct13)}/coaches`).send([
      { coach_id: sid(world.coach), hours_coached: 1, rate_applied: 1000, adjustment_amount: 50, adjustment_note: "Travel" },
      { coach_id: sid(world.coach2), hours_coached: 0.5 },
    ]),
  );
  expect(coached.coaches.map((c) => [c.name, c.hours_coached, c.rate_applied, c.adjustment_amount, c.payable_amount])).toEqual([
    ["Coach One", 1, 1000, 50, 1050],
    ["Coach Two", 0.5, 600, 0, 300],
  ]);
  expect(coached.coaches[1].scheduled_hours).toBe(1);
  fails(
    await admin.put(`${API}/admin/sessions/${sid(oct13)}/coaches`).send([{ coach_id: sid(world.coach) }, { coach_id: sid(world.coach) }]),
    400,
    "List each coach once",
  );
  fails(await admin.put(`${API}/admin/sessions/${sid(oct13)}/coaches`).send([{ coach_id: sid(world.coach), hours_coached: 25 }]), 422);
  fails(await admin.put(`${API}/admin/sessions/${sid(oct13)}/coaches`).send([{ coach_id: sid(s1) }]), 404, "CoachProfile not found");

  // Refresh rates re-applies the configured coach rate (adjustments kept).
  const refreshed = ok(await admin.post(`${API}/admin/sessions/${sid(oct13)}/refresh-rates`));
  expect(refreshed.coaches.map((c) => [c.rate_applied, c.payable_amount])).toEqual([
    [800, 850],
    [600, 300],
  ]);
  expect(refreshed).toMatchObject({ venue_rate_applied: 700, court_payable: 700 });
  const refreshAudit = await lastAudit("refresh_rates");
  expect([refreshAudit.old_value_json, refreshAudit.new_value_json]).toEqual([
    { venue_rate: 700, coach_rates: [1000, 600] },
    { venue_rate: 700, coach_rates: [800, 600] },
  ]);
  fails(await admin.post(`${API}/admin/sessions/${extra.id}/refresh-rates`), 409, "Rates are applied when the session is recorded");

  // Cancel (refund credits the per-session value) and reinstate (reversed).
  const oct20 = await sessionOn(world.batch, "2026-10-20");
  const cancelled = ok(await admin.post(`${API}/admin/sessions/${sid(oct20)}/cancel`).send({ reason: "Rain", adjustment: "refund" }));
  expect(cancelled).toMatchObject({ status: "cancelled", cancellation_reason: "Rain", cancellation_adjustment: "refund", venue_charge_applies: false, court_payable: 0 });
  expect(await ledger.balance(s1._id)).toBe(-3500);
  expect((await lastAudit("cancel")).summary).toBe("Cancelled Batch BEG 2026-10-20: Rain (refund)");
  const oct22 = await sessionOn(world.batch, "2026-10-22");
  const defaulted = ok(await admin.post(`${API}/admin/sessions/${sid(oct22)}/cancel`).send({ venue_charge_applies: true }));
  expect(defaulted).toMatchObject({ cancellation_adjustment: "carry_forward", venue_charge_applies: true, court_payable: 1600 });
  expect((await lastAudit("cancel")).summary).toBe("Cancelled Batch BEG 2026-10-22:  (carry_forward)");
  fails(await admin.post(`${API}/admin/sessions/${sid(oct13)}/cancel`).send({}), 409, "Attendance has already been recorded for this session");
  fails(await admin.post(`${API}/admin/sessions/${sid(oct22)}/cancel`).send({ adjustment: "voucher" }), 422);

  const reinstated = ok(await admin.post(`${API}/admin/sessions/${sid(oct20)}/reinstate`));
  expect(reinstated).toMatchObject({ status: "scheduled", cancellation_reason: null, venue_rate_applied: null, court_payable: null });
  expect(await ledger.balance(s1._id)).toBe(-4000);
  expect(await SessionAttendance.countDocuments({ session_id: oct20._id })).toBe(0);
  expect((await lastAudit("reinstate")).summary).toBe("Reinstated session 2026-10-20");
  fails(await admin.post(`${API}/admin/sessions/${sid(oct20)}/reinstate`), 409, "Session is not cancelled");

  // Delete: only scheduled sessions without attendance.
  const del = await admin.delete(`${API}/admin/sessions/${extra.id}`);
  expect(del.status, del.text).toBe(204);
  expect(await Session.exists({ _id: extra.id })).toBeNull();
  expect((await lastAudit("delete")).summary).toBe("Deleted session 2026-10-26");
  fails(await admin.delete(`${API}/admin/sessions/${sid(oct13)}`), 409, "Only scheduled sessions without attendance can be deleted; cancel it instead");
  fails(await admin.delete(`${API}/admin/sessions/${extra.id}`), 404, "Session not found");
});

// ---------------------------------------------------------------------------------------------------------
// Make-ups

test("make-ups: list with counts, booking options, book, cancel booking, delete releases, extend and expiry", async () => {
  const world = await createWorld();
  const admin = await signIn(ADMIN);
  const s1 = await world.student();
  const s2 = await world.student();
  await enrollActive(world, s1, world.batch);
  await enrollActive(world, s2, world.batch);
  await generateOctober(world);
  await record(world, world.batch, "2026-10-13", { [sid(s1)]: "absent", [sid(s2)]: "present" });

  const list = ok(await admin.get(`${API}/admin/makeups?status=available`));
  expect([list.total, list.counts]).toEqual([1, { available: 1 }]);
  const credit = list.items[0];
  expect(credit).toMatchObject({
    student_id: sid(s1),
    student_name: "Student 1",
    original_batch_name: "Batch BEG",
    missed_session_date: "2026-10-13",
    expires_on: "2026-11-12",
    status: "available",
    booked_session: null,
    used_session: null,
  });
  expect(ok(await admin.get(`${API}/admin/makeups?student_id=${sid(s2)}`)).total).toBe(0);
  expect(ok(await admin.get(`${API}/admin/makeups?status=booked`)).items).toEqual([]);

  // Options: other batches' upcoming sessions (never the student's own batch).
  const options = ok(await admin.get(`${API}/admin/makeups/${credit.id}/options`));
  expect(options.map((s) => [s.session_date, s.batch_name])).toEqual([
    ["2026-10-19", "Batch INT"],
    ["2026-10-21", "Batch INT"],
    ["2026-10-26", "Batch INT"],
    ["2026-10-28", "Batch INT"],
  ]);

  const target = options[0].id;
  const booked = ok(await admin.post(`${API}/admin/makeups/${credit.id}/book`).send({ session_id: target }));
  expect(booked).toMatchObject({ status: "booked", booked_session_id: target });
  expect(booked.booked_session).toMatchObject({ id: target, session_date: "2026-10-19", batch_name: "Batch INT", venue_name: "Venue V2" });
  expect((await lastAudit("book")).summary).toBe(`Booked into session ${target}`);
  fails(await admin.post(`${API}/admin/makeups/${credit.id}/book`).send({ session_id: target }), 409, "Make-up is booked");
  const own = await sessionOn(world.batch, "2026-10-20");
  fails(await admin.post(`${API}/admin/makeups/${credit.id}/book`).send({ session_id: sid(world.batch) }), 404, "Session not found");

  const unbooked = ok(await admin.post(`${API}/admin/makeups/${credit.id}/cancel-booking`));
  expect(unbooked).toMatchObject({ status: "available", booked_session_id: null });
  expect((await lastAudit("cancel_booking")).summary).toBe("Cancelled booking");
  fails(await admin.post(`${API}/admin/makeups/${credit.id}/cancel-booking`), 409, "Make-up is not booked");
  fails(await admin.post(`${API}/admin/makeups/${credit.id}/book`).send({ session_id: sid(own) }), 409, "The student is already a regular in that batch");

  // Deleting the booked session hands the make-up back.
  ok(await admin.post(`${API}/admin/makeups/${credit.id}/book`).send({ session_id: target }));
  const del = await admin.delete(`${API}/admin/sessions/${target}`);
  expect(del.status, del.text).toBe(204);
  const released = await MakeupCredit.findById(credit.id);
  expect([released.status, released.booked_session_id]).toEqual(["available", null]);

  // Extend / expiry.
  fails(await admin.post(`${API}/admin/makeups/${credit.id}/extend`).send({}), 422);
  const extended = ok(await admin.post(`${API}/admin/makeups/${credit.id}/extend`).send({ expires_on: "2026-12-31" }));
  expect(extended.expires_on).toBe("2026-12-31");
  expect((await lastAudit("extend")).summary).toBe("Expiry 2026-11-12 -> 2026-12-31");
  ok(await admin.post(`${API}/admin/makeups/${credit.id}/extend`).send({ expires_on: null }));
  expect((await lastAudit("extend")).summary).toBe("Expiry 2026-12-31 -> None");
  await MakeupCredit.updateOne({ _id: credit.id }, { $set: { expires_on: "2026-10-10" } });
  const expiredList = ok(await admin.get(`${API}/admin/makeups`));
  expect(expiredList.counts).toEqual({ expired: 1 });
  expect(expiredList.items[0].status).toBe("expired");
  const revived = ok(await admin.post(`${API}/admin/makeups/${credit.id}/extend`).send({ expires_on: "2026-10-30" }));
  expect(revived).toMatchObject({ status: "available", expires_on: "2026-10-30" });
  await MakeupCredit.updateOne({ _id: credit.id }, { $set: { status: "used" } });
  fails(await admin.post(`${API}/admin/makeups/${credit.id}/extend`).send({ expires_on: "2026-11-30" }), 409, "Make-up is used");
  fails(await admin.get(`${API}/admin/makeups/${sid(world.batch)}/options`), 404, "MakeupCredit not found");
});

test("make-ups: approval decisions and admin grants", async () => {
  const world = await createWorld();
  const admin = await signIn(ADMIN);
  await Academy.updateOne({ _id: world.academy._id }, { $set: { "settings.makeup.requires_approval": true } });
  const rules = BusinessRules.parse({ makeup: { requires_approval: true } });
  const s1 = await world.student();
  const s2 = await world.student();
  await enrollActive(world, s1, world.batch);
  await enrollActive(world, s2, world.batch);
  await generateOctober(world);
  await record(world, world.batch, "2026-10-13", { [sid(s1)]: "absent", [sid(s2)]: "absent" }, rules);
  await record(world, world.batch, "2026-10-15", { [sid(s1)]: "present", [sid(s2)]: "present" }, rules);

  const pending = ok(await admin.get(`${API}/admin/makeups?status=pending_approval`));
  expect([pending.total, pending.counts]).toEqual([2, { pending_approval: 2 }]);
  const bySt = Object.fromEntries(pending.items.map((c) => [c.student_id, c]));

  const rejected = ok(await admin.post(`${API}/admin/makeups/${bySt[sid(s1)].id}/decide`).send({ approve: false, note: "Not eligible" }));
  expect(rejected).toMatchObject({ status: "rejected", note: "Not eligible", decided_by_id: sid(world.admin) });
  expect((await lastAudit("reject")).summary).toBe("Not eligible");
  const approved = ok(await admin.post(`${API}/admin/makeups/${bySt[sid(s2)].id}/decide`).send({ approve: true }));
  expect(approved).toMatchObject({ status: "available", note: null });
  fails(await admin.post(`${API}/admin/makeups/${bySt[sid(s2)].id}/decide`).send({ approve: true }), 409, "Make-up is available, not awaiting approval");
  fails(await admin.post(`${API}/admin/makeups/${bySt[sid(s2)].id}/decide`).send({ note: "x" }), 422);
  expect(ok(await admin.get(`${API}/admin/makeups`)).counts).toEqual({ rejected: 1, available: 1 });
  fails(await admin.post(`${API}/admin/makeups/${bySt[sid(s1)].id}/extend`).send({ expires_on: "2026-11-30" }), 409, "Make-up is rejected");

  // Granting re-opens a rejected make-up for the absence; presences cannot get one.
  const absence = await SessionAttendance.findOne({ student_id: s1._id, attendance_status: "absent" });
  const granted = ok(await admin.post(`${API}/admin/attendance/${sid(absence)}/grant-makeup`), 201);
  expect(granted).toMatchObject({ id: bySt[sid(s1)].id, status: "available", expires_on: "2026-11-12", missed_attendance_id: sid(absence) });
  expect((await lastAudit("grant")).summary).toBe(`Granted make-up for attendance ${sid(absence)}`);
  fails(await admin.post(`${API}/admin/attendance/${sid(absence)}/grant-makeup`), 409, "A make-up already exists for this absence (available)");
  const presence = await SessionAttendance.findOne({ student_id: s1._id, attendance_status: "present" });
  fails(await admin.post(`${API}/admin/attendance/${sid(presence)}/grant-makeup`), 409, "Make-ups can only be granted for a regular student's absence");
  fails(await admin.post(`${API}/admin/attendance/${sid(world.batch)}/grant-makeup`), 404, "Attendance not found");

  // An absence without a credit (policy off at the time) gets a manual, pre-approved credit.
  const off = BusinessRules.parse({ makeup: { eligible_on_absence: false } });
  await record(world, world.batch2, "2026-10-14", {}, off);
  await enrollActive(world, s1, world.batch2);
  await record(world, world.batch, "2026-10-08", { [sid(s1)]: "absent" }, off);
  const missed = await SessionAttendance.findOne({ student_id: s1._id, session_date: "2026-10-08" });
  expect(await MakeupCredit.exists({ missed_attendance_id: missed._id })).toBeNull();
  const manual = ok(await admin.post(`${API}/admin/attendance/${sid(missed)}/grant-makeup`), 201);
  expect(manual).toMatchObject({ status: "available", note: "Granted by admin", expires_on: "2026-11-07", missed_session_date: "2026-10-08" });
});
