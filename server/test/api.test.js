/** API tests: authentication, role-based access, enrollment/payment workflow, coach attendance, CMS and exports. */
import sharp from "sharp";
import request from "supertest";
import { expect, test } from "vitest";

import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { withTransaction } from "../src/db.js";
import { Session, sid } from "../src/models/index.js";
import * as batchSvc from "../src/services/batches.js";
import { freeze, now } from "../src/utils/clock.js";
import { addDays } from "../src/utils/dates.js";
import { TODAY } from "./setup.js";
import { createWorld, login } from "./world.js";

const app = createApp();
const DAY_MS = 24 * 60 * 60 * 1000;

/** A fresh cookie jar (the TestClient of the Python suite). */
const newClient = () => request.agent(app);

/** Collect a binary response body into a Buffer. */
function binary(res, cb) {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

/** Enrol a student into world.batch from 1 Oct, approve it and generate October sessions for both batches. */
async function enrollAndGenerate(world, student) {
  await withTransaction(async () => {
    const [e] = await batchSvc.enroll({
      batch: world.batch,
      student,
      source: "admin",
      actorId: world.admin._id,
      startDate: "2026-10-01",
    });
    await batchSvc.approveEnrollment(e, world.admin._id);
    await batchSvc.generateSessions(world.batch, "2026-10-01", "2026-10-31");
    await batchSvc.generateSessions(world.batch2, "2026-10-01", "2026-10-31");
  });
}

test("register, login and me", async () => {
  await createWorld();
  const c = newClient();
  const r = await c.post("/api/v1/auth/register").send({ name: "New Player", mobile: "+91 98765 43210", password: "Secret@123" });
  expect(r.status, r.text).toBe(201);
  expect(r.body.roles).toEqual(["student"]);
  expect(r.body.mobile).toBe("9876543210");
  expect((await c.get("/api/v1/auth/me")).status).toBe(200);
  const dup = await newClient().post("/api/v1/auth/register").send({ name: "Again", mobile: "9876543210", password: "Secret@123" });
  expect(dup.status).toBe(409);
  await c.post("/api/v1/auth/logout");
  expect((await c.get("/api/v1/auth/me")).status).toBe(401);
  const bad = await newClient().post("/api/v1/auth/login").send({ identifier: "9876543210", password: "wrong-pass" });
  expect(bad.status).toBe(401);
});

test("password change invalidates old sessions", async () => {
  const world = await createWorld();
  await world.student({ password: "Student@123" });
  const a = await login(newClient(), "9000000101", "Student@123");
  const b = await login(newClient(), "9000000101", "Student@123");
  const r = await a.post("/api/v1/auth/change-password").send({ current_password: "Student@123", new_password: "Changed@123" });
  expect(r.status, r.text).toBe(204);
  expect((await a.get("/api/v1/auth/me")).status).toBe(200); // cookie re-issued
  expect((await b.get("/api/v1/auth/me")).status).toBe(401);
});

test("login rate limited", async () => {
  await createWorld();
  const c = newClient();
  const codes = [];
  for (let i = 0; i < 12; i += 1) {
    codes.push((await c.post("/api/v1/auth/login").send({ identifier: "9000000001", password: "nope" })).status);
  }
  expect(codes.at(-1)).toBe(429);
});

test("role-based access", async () => {
  const world = await createWorld();
  await world.student({ password: "Student@123" });
  const student = await login(newClient(), "9000000101", "Student@123");
  const coach = await login(newClient(), "9000000011", "Coach@12345");
  const admin = await login(newClient(), "9000000001", "Admin@12345");
  const anon = newClient();
  expect((await anon.get("/api/v1/admin/overview")).status).toBe(401);
  expect((await student.get("/api/v1/admin/overview")).status).toBe(403);
  expect((await coach.get("/api/v1/admin/students")).status).toBe(403);
  expect((await student.get("/api/v1/coach/dashboard")).status).toBe(403);
  expect((await coach.get("/api/v1/student/dashboard")).status).toBe(403);
  expect((await admin.get("/api/v1/admin/overview")).status).toBe(200);
  expect((await coach.get("/api/v1/coach/dashboard")).status).toBe(200);
  expect((await student.get("/api/v1/student/dashboard")).status).toBe(200);
});

test("cross-site writes blocked", async () => {
  await createWorld();
  const admin = await login(newClient(), "9000000001", "Admin@12345");
  const r = await admin.post("/api/v1/admin/faqs").set("origin", "https://evil.example").send({ question: "Evil?", answer: "Yes" });
  expect(r.status).toBe(403);
  // Our own front-end origin (the Vite dev server here; the Python suite used Next's localhost:3000).
  const ok = await admin.post("/api/v1/admin/faqs").set("origin", config.allowedOrigins[0]).send({ question: "Good?", answer: "Yes" });
  expect(ok.status, ok.text).toBe(201);
});

test("self-enrollment UPI flow", async () => {
  const world = await createWorld();
  await world.student({ password: "Student@123" });
  const student = await login(newClient(), "9000000101", "Student@123");
  const admin = await login(newClient(), "9000000001", "Admin@12345");
  const bid = sid(world.batch);

  const preview = (await student.get(`/api/v1/student/enroll/${bid}`)).body;
  expect(preview.batch.seats_left).toBe(6);
  const r = await student.post("/api/v1/student/enroll").send({ batch_id: bid, amount: 4000, reference_no: "UTR12345" });
  expect(r.status, r.text).toBe(201);
  expect(r.body.enrollment.status).toBe("pending");
  // Pending enrollment holds a seat on the public listing.
  expect((await newClient().get(`/api/v1/public/batches/${bid}`)).body.seats_left).toBe(5);
  expect((await student.post("/api/v1/student/enroll").send({ batch_id: bid })).status).toBe(409);

  const pending = (await admin.get("/api/v1/admin/payments?status=pending")).body.items;
  expect(pending).toHaveLength(1);
  const v = await admin.post(`/api/v1/admin/payments/${pending[0].id}/verify`);
  expect(v.status, v.text).toBe(200);
  expect(v.body.status).toBe("verified");

  const dash = (await student.get("/api/v1/student/dashboard")).body;
  expect(dash.batches[0].status).toBe("active");
  expect(dash.balance).toBe(0);
  expect(dash.plans[0].usage.remaining).toBe(8);
  const ledgerRows = (await student.get("/api/v1/student/ledger")).body.entries;
  expect(ledgerRows.map((e) => e.txn_type).sort()).toEqual(["charge", "payment"]);
  const audit = (await admin.get("/api/v1/admin/audit")).body.items;
  const actions = new Set(audit.map((a) => a.action));
  expect(actions.has("self_enroll") && actions.has("verify")).toBe(true);
});

test("coach attendance permissions and window", async () => {
  const world = await createWorld();
  const s1 = await world.student();
  await enrollAndGenerate(world, s1);
  const todaySession = await Session.findOne({ batch_id: world.batch._id, session_date: TODAY });
  const oldSession = await Session.findOne({ batch_id: world.batch._id, session_date: { $lt: addDays(TODAY, -5) } });
  const futureSession = await Session.findOne({ batch_id: world.batch._id, session_date: { $gt: TODAY } });
  const coach = await login(newClient(), "9000000011", "Coach@12345");
  const coach2 = await login(newClient(), "9000000012", "Coach@12345");

  const detail = (await coach.get(`/api/v1/sessions/${sid(todaySession)}`)).body;
  expect(detail.can_edit).toBeTruthy();
  expect(detail.roster.map((r) => r.student_id)).toEqual([sid(s1)]);
  expect((await coach2.get(`/api/v1/sessions/${sid(todaySession)}`)).status).toBe(403); // not their batch

  const body = {
    entries: [{ student_id: sid(s1), status: "present" }],
    coaches: [{ coach_id: sid(world.coach), hours_coached: 1 }],
  };
  let r = await coach.post(`/api/v1/sessions/${sid(todaySession)}/attendance`).send(body);
  expect(r.status, r.text).toBe(200);
  expect(r.body.status).toBe("completed");
  expect((await coach.post(`/api/v1/sessions/${sid(oldSession)}/attendance`).send(body)).status).toBe(403);
  expect((await coach.post(`/api/v1/sessions/${sid(futureSession)}/attendance`).send(body)).status).toBe(403);
  // Coaches cannot set money adjustments; the field is ignored for them.
  body.coaches[0].adjustment_amount = 5000;
  await coach.post(`/api/v1/sessions/${sid(todaySession)}/attendance`).send(body);
  const hours = (await coach.get("/api/v1/coach/hours")).body;
  expect(hours.totals.payable).toBe(800);

  // Walk-in drop-in player added by the coach is charged the configured fee.
  const w = await coach.post(`/api/v1/sessions/${sid(todaySession)}/walk-in`).send({ name: "Guest", mobile: "9111111111" });
  body.entries.push({ student_id: w.body.student_id, status: "present", attendee_type: "drop_in" });
  r = await coach.post(`/api/v1/sessions/${sid(todaySession)}/attendance`).send(body);
  const guestRow = r.body.roster.find((x) => x.student_id === w.body.student_id);
  expect(guestRow.billing_mode).toBe("drop_in");
  expect(guestRow.drop_in_fee).toBe(500);
});

test("student books and cancels makeup", async () => {
  const world = await createWorld();
  const s = await world.student({ password: "Student@123" });
  await enrollAndGenerate(world, s);
  const missed = await Session.findOne({ batch_id: world.batch._id }).sort({ session_date: 1 });
  const admin = await login(newClient(), "9000000001", "Admin@12345");
  await admin
    .post(`/api/v1/sessions/${sid(missed)}/attendance`)
    .send({ entries: [{ student_id: sid(s), status: "absent" }], coaches: [] });

  const student = await login(newClient(), "9000000101", "Student@123");
  const credits = (await student.get("/api/v1/student/makeups")).body.items;
  expect(credits).toHaveLength(1);
  expect(credits[0].status).toBe("available");
  const options = (await student.get(`/api/v1/student/makeups/${credits[0].id}/options`)).body;
  expect(options.length).toBeGreaterThan(0);
  expect(options.every((o) => o.batch_id === sid(world.batch2))).toBe(true); // never their own batch
  freeze(TODAY);
  const target = options.find((o) => o.session_date > TODAY);
  let r = await student.post(`/api/v1/student/makeups/${credits[0].id}/book`).send({ session_id: target.id });
  expect(r.status, r.text).toBe(200);
  expect(r.body.status).toBe("booked");
  const upcoming = (await student.get("/api/v1/student/sessions")).body;
  expect(upcoming.some((u) => u.kind === "makeup")).toBe(true);
  r = await student.post(`/api/v1/student/makeups/${credits[0].id}/cancel`);
  expect(r.body.status).toBe("available");
});

test("CMS publish controls", async () => {
  await createWorld();
  const admin = await login(newClient(), "9000000001", "Admin@12345");
  const t = now().getTime();
  const daysAgo = (n) => new Date(t - n * DAY_MS).toISOString();
  const draft = (await admin.post("/api/v1/admin/posts").send({ title: "Draft news", category: "academy_update" })).body;
  const live = (
    await admin.post("/api/v1/admin/posts").send({
      title: "State gold!",
      category: "achievement",
      status: "published",
      video_url: "https://www.instagram.com/reel/abc123/",
      publish_from: daysAgo(1),
    })
  ).body;
  await admin.post("/api/v1/admin/posts").send({
    title: "Old campaign",
    category: "event",
    status: "published",
    publish_from: daysAgo(10),
    publish_to: daysAgo(1),
  });
  const bad = await admin.post("/api/v1/admin/posts").send({ title: "Bad video", category: "event", video_url: "http://evil.example/x.mp4" });
  expect(bad.status).toBe(400);
  const pub = (await newClient().get("/api/v1/public/posts")).body.items;
  expect(pub.map((p) => p.slug)).toEqual([live.slug]);
  expect((await newClient().get(`/api/v1/public/posts/${draft.slug}`)).status).toBe(404);
  const again = (await admin.post("/api/v1/admin/posts").send({ title: "State gold!", category: "achievement" })).body;
  expect(again.slug).toBe("state-gold-2");
});

test("media upload rejects non-images", async () => {
  await createWorld();
  const admin = await login(newClient(), "9000000001", "Admin@12345");
  const bad = await admin
    .post("/api/v1/admin/media/upload")
    .attach("file", Buffer.from("not an image"), { filename: "x.png", contentType: "image/png" });
  expect(bad.status).toBe(400);
  const jpeg = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 10, g: 120, b: 80 } } })
    .jpeg()
    .toBuffer();
  const ok = await admin
    .post("/api/v1/admin/media/upload")
    .attach("file", jpeg, { filename: "court.jpg", contentType: "image/jpeg" })
    .field("caption", "Court");
  expect(ok.status, ok.text).toBe(201);
  expect(ok.body.width).toBe(1920);
  expect(ok.body.storage_url.endsWith(".webp")).toBe(true);
});

test("reports and exports", async () => {
  await createWorld();
  const admin = await login(newClient(), "9000000001", "Admin@12345");
  for (const kind of ["batches", "coaches", "venues", "students", "monthly"]) {
    expect((await admin.get(`/api/v1/admin/reports/${kind}?month=2026-10`)).status).toBe(200);
    const csvResp = await admin.get(`/api/v1/admin/reports/${kind}/export?month=2026-10&format=csv`).buffer(true).parse(binary);
    expect(csvResp.status).toBe(200);
    expect(csvResp.headers["content-type"]).toContain("text/csv");
  }
  const x = await admin.get("/api/v1/admin/reports/coaches/export?month=2026-10&format=xlsx&detail=true").buffer(true).parse(binary);
  expect(x.status).toBe(200);
  expect(x.body.subarray(0, 2).toString()).toBe("PK");
  const fin = (await admin.get("/api/v1/admin/reports/finance?month=2026-10")).body;
  for (const key of ["income", "expenses", "net", "receivables", "liabilities"]) expect(fin.summary).toHaveProperty(key);
});

test("admin cannot remove last admin", async () => {
  const world = await createWorld();
  const admin = await login(newClient(), "9000000001", "Admin@12345");
  const r = await admin.post(`/api/v1/admin/users/${sid(world.admin)}/roles`).send({ role: "admin", grant: false });
  expect(r.status).toBe(409);
});
