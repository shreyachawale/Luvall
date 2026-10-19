/** API tests for admin finance, reports/exports and the CMS (crud.js, adminFinance, adminReports, adminCms). */
import fs from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";
import sharp from "sharp";
import request from "supertest";
import { expect, test } from "vitest";

import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { withTransaction } from "../src/db.js";
import {
  Academy,
  AuditLog,
  Batch,
  BatchStudent,
  CoachProfile,
  Enquiry,
  GalleryAlbum,
  LedgerTransaction,
  MakeupCredit,
  MediaAsset,
  Payment,
  Post,
  Session,
  SessionAttendance,
  sid,
  StudentFeePlan,
  User,
  Venue,
} from "../src/models/index.js";
import * as batchSvc from "../src/services/batches.js";
import * as ledger from "../src/services/ledger.js";
import { SiteContent } from "../src/services/rules.js";
import { TODAY } from "./setup.js";
import { createWorld, login } from "./world.js";

const app = createApp();
const tx = (fn) => withTransaction(fn);

const ADMIN = ["9000000001", "Admin@12345"];
const COACH = ["9000000011", "Coach@12345"];
const STUDENT1 = ["9000000101", "Student@123"];

const signIn = ([mobile, password]) => login(request.agent(app), mobile, password);
const api = (p) => `/api/v1${p}`;
const fields = (res) => res.body.detail.map((d) => d.loc.at(-1));

/** supertest parser that keeps the raw response bytes (CSV byte-order mark, XLSX zip). */
function binary(res, cb) {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
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

/** An active custom plan created through the ledger service. */
async function activePlan(world, student, { name, baseFee, sessions, start, end }) {
  return tx(async () => {
    const plan = ledger.buildPlan({
      academyId: world.academy._id,
      studentId: student._id,
      name,
      baseFee,
      sessionsIncluded: sessions,
      startDate: start,
      endDate: end,
    });
    await plan.save();
    await ledger.activatePlan(plan, world.admin._id);
    return plan;
  });
}

const auditOf = (entityType) => AuditLog.find({ entity_type: entityType }).sort({ _id: 1 });

// ---------------------------------------------------------------------------------------------------------

test("admin finance, reports and CMS endpoints are admin-only", async () => {
  const world = await createWorld();
  const s1 = await world.student({ password: "Student@123" });
  const anon = request(app);
  const student = await signIn(STUDENT1);
  const coach = await signIn(COACH);
  const admin = await signIn(ADMIN);
  const gets = [
    "/admin/overview",
    "/admin/fee-plans",
    "/admin/expenses",
    "/admin/plans",
    "/admin/payments",
    "/admin/payments/pending-count",
    "/admin/finance/pending",
    "/admin/payouts/coaches",
    "/admin/payouts/venues",
    `/admin/students/${sid(s1)}/ledger`,
    "/admin/reports/finance",
    "/admin/reports/batches",
    "/admin/reports/students/export",
    "/admin/audit",
    "/admin/programs",
    "/admin/posts",
    "/admin/albums",
    "/admin/events",
    "/admin/testimonials",
    "/admin/faqs",
    "/admin/announcements",
    "/admin/enquiries",
    "/admin/media",
    "/admin/site-content",
    "/admin/settings",
    "/admin/academy",
  ];
  for (const p of gets) {
    expect((await anon.get(api(p))).status, p).toBe(401);
    expect((await student.get(api(p))).status, p).toBe(403);
    expect((await coach.get(api(p))).status, p).toBe(403);
    expect((await admin.get(api(p))).status, p).toBe(200);
  }
  const forbidden = await coach.post(api("/admin/faqs")).send({ question: "Coach?", answer: "No" });
  expect(forbidden.status).toBe(403);
  expect(forbidden.body.detail).toBe("You do not have access to this area");
  expect((await student.post(api(`/admin/students/${sid(s1)}/adjustments`)).send({ amount: 100, description: "Self credit" })).status).toBe(403);
  expect((await student.put(api("/admin/settings")).send({})).status).toBe(403);
  expect((await anon.post(api("/admin/payments")).send({})).status).toBe(401);
  expect((await coach.post(api("/admin/media/video")).send({ url: "https://youtu.be/x" })).status).toBe(403);
  expect((await coach.delete(api(`/admin/payouts/coaches/${sid(s1)}`))).status).toBe(403);
  // Cookie-authenticated writes from another site are blocked.
  const evil = await admin.post(api("/admin/faqs")).set("origin", "https://evil.example").send({ question: "Evil?", answer: "Yes" });
  expect(evil.status).toBe(403);
  const ok = await admin.post(api("/admin/faqs")).set("origin", "http://localhost:5173").send({ question: "Good?", answer: "Yes" });
  expect(ok.status).toBe(201);
});

test("fee plan and expense CRUD: validation, ordering, filters, search, pagination and audit", async () => {
  const world = await createWorld();
  const admin = await signIn(ADMIN);

  let r = await admin.post(api("/admin/fee-plans")).send({ name: "X", number_of_sessions: 0, base_fee: -1, plan_type: "yearly" });
  expect(r.status).toBe(422);
  expect(fields(r)).toEqual(expect.arrayContaining(["name", "plan_type", "number_of_sessions", "base_fee"]));
  expect(r.body.detail.find((d) => d.loc.at(-1) === "plan_type").msg).toBe("String should match pattern '^(monthly|package|per_session)$'");
  expect(r.body.detail.find((d) => d.loc.at(-1) === "number_of_sessions").msg).toBe("Input should be greater than or equal to 1");
  expect(fields(await admin.post(api("/admin/fee-plans")).send({ name: "Twelve" }))).toEqual(["number_of_sessions", "base_fee"]);

  r = await admin.post(api("/admin/fee-plans")).send({ name: "12 sessions", number_of_sessions: "12", base_fee: 5400.555, validity_days: 45 });
  expect(r.status, r.text).toBe(201);
  expect(r.body).toMatchObject({
    name: "12 sessions",
    plan_type: "monthly",
    number_of_sessions: 12,
    base_fee: 5400.56,
    validity_days: 45,
    is_public: true,
    status: "active",
    description: null,
    academy_id: sid(world.academy),
  });
  const twelve = r.body;
  r = await admin.post(api("/admin/fee-plans")).send({ name: "Trial", number_of_sessions: 1, base_fee: 300, status: "inactive", is_public: false });
  expect(r.status).toBe(201);

  // Ordered by status, then fee.
  let list = (await admin.get(api("/admin/fee-plans"))).body;
  expect(list).toMatchObject({ total: 3, page: 1, page_size: 50 });
  expect(list.items.map((p) => p.name)).toEqual(["8 sessions", "12 sessions", "Trial"]);
  expect((await admin.get(api("/admin/fee-plans?status=inactive"))).body.items.map((p) => p.name)).toEqual(["Trial"]);
  expect((await admin.get(api("/admin/fee-plans?q=SESS"))).body.total).toBe(2);
  list = (await admin.get(api("/admin/fee-plans?page=2&page_size=2"))).body;
  expect(list).toMatchObject({ total: 3, page: 2, page_size: 2 });
  expect(list.items.map((p) => p.name)).toEqual(["Trial"]);

  expect((await admin.get(api(`/admin/fee-plans/${twelve.id}`))).body.name).toBe("12 sessions");
  r = await admin.get(api(`/admin/fee-plans/${sid(world.batch)}`));
  expect(r.status).toBe(404);
  expect(r.body.detail).toBe("FeePlan not found");
  expect((await admin.patch(api(`/admin/fee-plans/${twelve.id}`)).send({ status: "paused" })).status).toBe(422);
  r = await admin.patch(api(`/admin/fee-plans/${twelve.id}`)).send({ base_fee: 6000 });
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ name: "12 sessions", base_fee: 6000 });

  // Deleting a template keeps the batch (and its plans) but unlinks it.
  await tx(() => StudentFeePlan.create({
    academy_id: world.academy._id,
    student_id: world.admin._id,
    fee_plan_id: world.plan8._id,
    name: "Old",
    base_fee: 4000,
    final_fee: 4000,
    sessions_included: 8,
    per_session_value: 500,
    start_date: "2026-10-01",
  }));
  expect((await admin.delete(api(`/admin/fee-plans/${sid(world.plan8)}`))).status).toBe(204);
  expect((await Batch.findById(world.batch._id)).fee_plan_id).toBeNull();
  expect((await StudentFeePlan.findOne({ name: "Old" })).fee_plan_id).toBeNull();
  expect((await admin.get(api(`/admin/fee-plans/${sid(world.plan8)}`))).status).toBe(404);

  const audit = await auditOf("fee_plan");
  expect(audit.map((a) => a.action)).toEqual(["create", "create", "update", "delete"]);
  expect(audit.map((a) => a.summary)).toEqual(["Created fee_plan", "Created fee_plan", "Updated fee_plan", "Deleted fee_plan"]);
  expect(audit[0].new_value_json).toMatchObject({ name: "12 sessions", base_fee: 5400.56 });
  expect(audit[2].old_value_json).toEqual({ base_fee: 5400.56 });
  expect(audit[2].new_value_json).toEqual({ base_fee: 6000 });
  expect(audit[3].old_value_json).toMatchObject({ name: "8 sessions" });
  expect(audit[3].entity_id).toBe(sid(world.plan8));

  // Expenses
  r = await admin.post(api("/admin/expenses")).send({ category: "food", description: "x", amount: 0, expense_date: "15-10-2026" });
  expect(r.status).toBe(422);
  expect(fields(r)).toEqual(expect.arrayContaining(["category", "description", "amount", "expense_date"]));
  r = await admin.post(api("/admin/expenses")).send({
    category: "equipment",
    description: "Balls",
    vendor: "Sports Hub",
    amount: 1200,
    expense_date: "2026-10-05",
    venue_id: sid(world.venue),
  });
  expect(r.status, r.text).toBe(201);
  expect(r.body).toMatchObject({ category: "equipment", is_paid: true, paid_on: null, venue_name: "Venue V1", batch_name: null });
  const balls = r.body;
  r = await admin.post(api("/admin/expenses")).send({
    category: "marketing",
    description: "Instagram ads",
    amount: 800,
    expense_date: "2026-10-10",
    is_paid: false,
    batch_id: sid(world.batch),
  });
  expect(r.body).toMatchObject({ venue_name: null, batch_name: "Batch BEG", is_paid: false });
  const ads = r.body;

  const names = async (qs) => (await admin.get(api(`/admin/expenses${qs}`))).body.items.map((e) => e.description);
  expect(await names("")).toEqual(["Instagram ads", "Balls"]);
  expect(await names("?is_paid=false")).toEqual(["Instagram ads"]);
  expect(await names("?is_paid=true")).toEqual(["Balls"]);
  expect(await names(`?venue_id=${sid(world.venue)}`)).toEqual(["Balls"]);
  expect(await names(`?batch_id=${sid(world.batch)}`)).toEqual(["Instagram ads"]);
  expect(await names("?category=marketing")).toEqual(["Instagram ads"]);
  expect(await names("?q=HUB")).toEqual(["Balls"]);
  expect(await names("?q=ads&category=equipment")).toEqual([]);
  r = await admin.get(api("/admin/expenses?venue_id=abc"));
  expect(r.status).toBe(400);
  expect(r.body.detail).toBe("Invalid filter value 'abc'");

  r = await admin.patch(api(`/admin/expenses/${ads.id}`)).send({ is_paid: true, paid_on: "2026-10-12" });
  expect(r.body).toMatchObject({ is_paid: true, paid_on: "2026-10-12", batch_name: "Batch BEG", description: "Instagram ads" });
  expect((await admin.delete(api(`/admin/expenses/${balls.id}`))).status).toBe(204);
  r = await admin.get(api(`/admin/expenses/${balls.id}`));
  expect(r.status).toBe(404);
  expect(r.body.detail).toBe("Expense not found");
  expect((await auditOf("expense")).map((a) => a.action)).toEqual(["create", "create", "update", "delete"]);
});

test("student plans: create from a template or custom, edit, activate, close, cancel and list", async () => {
  const world = await createWorld();
  const s1 = await world.student();
  const admin = await signIn(ADMIN);
  const base = api(`/admin/students/${sid(s1)}/plans`);

  let r = await admin.post(base).send({ start_date: "2026-10-01" });
  expect(r.status).toBe(400);
  expect(r.body.detail).toBe("Choose a fee plan or enter name, fee and number of sessions");
  expect(fields(await admin.post(base).send({ start_date: "2026-10-01", discount_type: "half" }))).toEqual(["discount_type"]);
  r = await admin.post(api(`/admin/students/${sid(world.coach)}/plans`)).send({ fee_plan_id: sid(world.plan8), start_date: "2026-10-01" });
  expect(r.status).toBe(404);
  expect(r.body.detail).toBe("StudentProfile not found");
  r = await admin.post(base).send({ fee_plan_id: sid(world.venue), start_date: "2026-10-01" });
  expect(r.body.detail).toBe("FeePlan not found");

  // From the template: end date from validity_days, discount, billed on activation.
  r = await admin.post(base).send({
    fee_plan_id: sid(world.plan8),
    start_date: "2026-10-01",
    discount_type: "percent",
    discount_value: 10,
    batch_id: sid(world.batch),
  });
  expect(r.status, r.text).toBe(201);
  expect(r.body).toMatchObject({
    name: "8 sessions",
    base_fee: 4000,
    final_fee: 3600,
    per_session_value: 450,
    sessions_included: 8,
    start_date: "2026-10-01",
    end_date: "2026-10-31",
    status: "active",
    fee_plan_id: sid(world.plan8),
    batch_id: sid(world.batch),
    batch_name: "Batch BEG",
    student_name: "Student 1",
  });
  expect(r.body.usage).toEqual({ sessions_included: 8, used: 0, refunded: 0, carried_forward: 0, makeups_attended: 0, remaining: 8 });
  const p1 = r.body;
  expect(await ledger.balance(s1._id)).toBe(-3600);
  const created = await AuditLog.findOne({ entity_type: "student_fee_plan", action: "create", entity_id: p1.id });
  expect(created.summary).toBe(`Plan 8 sessions for student ${sid(s1)}: 3600.00`);

  // Custom price, not activated yet.
  r = await admin.post(base).send({ name: "Private coaching", base_fee: 3000, sessions_included: 4, start_date: "2026-11-01", activate: false });
  expect(r.body).toMatchObject({ status: "pending", end_date: null, final_fee: 3000, per_session_value: 750, batch_name: null });
  const p2 = r.body;
  expect(await ledger.balance(s1._id)).toBe(-3600);

  // A fee change is posted as a correction of the original charge.
  r = await admin.patch(api(`/admin/plans/${p1.id}`)).send({ discount_type: "none" });
  expect(r.status, r.text).toBe(200);
  expect(r.body).toMatchObject({ final_fee: 4000, per_session_value: 500, discount_type: "none" });
  const charges = await LedgerTransaction.find({ reference_type: "student_fee_plan", reference_id: p1.id }).sort({ _id: 1 });
  expect(charges.map((t) => t.amount)).toEqual([-3600, -400]);
  expect(charges[1].description).toMatch(/^Correction: Fee: 8 sessions/);
  r = await admin.patch(api(`/admin/plans/${p1.id}`)).send({ end_date: "2026-09-01" });
  expect(r.status).toBe(400);
  expect(r.body.detail).toBe("Plan end date is before its start date");
  expect((await admin.patch(api(`/admin/plans/${p1.id}`)).send({ sessions_included: 0 })).status).toBe(422);

  r = await admin.post(api(`/admin/plans/${p2.id}/activate`));
  expect(r.body.status).toBe("active");
  expect(await ledger.balance(s1._id)).toBe(-7000);

  // A plan that ended last month: listed for closing, closed with the academy default (carry forward).
  const sept = await activePlan(world, s1, { name: "September", baseFee: 4000, sessions: 8, start: "2026-09-01", end: "2026-09-30" });
  const pending = (await admin.get(api("/admin/finance/pending"))).body;
  expect(pending.payments).toEqual([]);
  expect(pending.plans_to_close.map((p) => p.id)).toEqual([sid(sept)]);
  expect(pending.plans_to_close[0].usage.remaining).toBe(8);
  r = await admin.post(api(`/admin/plans/${sid(sept)}/close`)).send({});
  expect(r.status, r.text).toBe(200);
  expect(r.body).toMatchObject({ status: "completed", closing_action: "carry_forward" });
  expect(await ledger.referenceNet("student_fee_plan_close", sept._id)).toBe(4000);
  // Re-closing as forfeit reverses the credit.
  r = await admin.post(api(`/admin/plans/${sid(sept)}/close`)).send({ action: "forfeit" });
  expect(r.body.closing_action).toBe("forfeit");
  expect(await ledger.referenceNet("student_fee_plan_close", sept._id)).toBe(0);
  expect((await admin.post(api(`/admin/plans/${sid(sept)}/close`)).send({ action: "keep" })).status).toBe(422);
  expect((await admin.get(api("/admin/finance/pending"))).body.plans_to_close).toEqual([]);

  // Cancel: charge reversed, then no more edits.
  r = await admin.post(api(`/admin/plans/${p2.id}/cancel`));
  expect(r.body.status).toBe("cancelled");
  expect(await ledger.referenceNet("student_fee_plan", p2.id)).toBe(0);
  r = await admin.patch(api(`/admin/plans/${p2.id}`)).send({ notes: "x" });
  expect(r.status).toBe(409);
  expect(r.body.detail).toBe("Cancelled plans cannot be edited");
  r = await admin.post(api(`/admin/plans/${p2.id}/activate`));
  expect(r.status).toBe(409);
  expect(r.body.detail).toBe("This plan was cancelled");
  r = await admin.post(api(`/admin/plans/${p2.id}/close`)).send({});
  expect(r.status).toBe(409);
  expect(r.body.detail).toBe("Only active plans can be closed");

  // Listing: soonest end date first, open-ended plans last.
  let list = (await admin.get(api("/admin/plans"))).body;
  expect(list.total).toBe(3);
  expect(list.items.map((p) => p.id)).toEqual([sid(sept), p1.id, p2.id]);
  expect(list.items[1].usage.remaining).toBe(8);
  list = (await admin.get(api("/admin/plans?status=active"))).body;
  expect(list.items.map((p) => p.id)).toEqual([p1.id]);
  list = (await admin.get(api("/admin/plans?ending_before=2026-10-15"))).body;
  expect(list.items.map((p) => p.id)).toEqual([sid(sept)]);
  list = (await admin.get(api("/admin/plans?page=2&page_size=2"))).body;
  expect(list.items.map((p) => p.id)).toEqual([p2.id]);
  expect((await admin.get(api("/admin/plans?ending_before=soon"))).status).toBe(422);

  const actions = (await auditOf("student_fee_plan")).map((a) => a.action);
  expect(actions).toEqual(["create", "create", "update", "activate", "close", "close", "cancel"]);
  const closes = await AuditLog.find({ entity_type: "student_fee_plan", action: "close" }).sort({ _id: 1 });
  expect(closes.map((a) => a.summary)).toEqual(["Closed plan September (carry_forward)", "Closed plan September (forfeit)"]);
});

test("payments: record, list, verify (confirms a pending enrollment), reject and pending count", async () => {
  const world = await createWorld();
  const s1 = await world.student();
  const s2 = await world.student();
  const admin = await signIn(ADMIN);
  // A pending enrollment with its pending plan, as after a student's self-enrollment.
  const [enrollment, plan] = await tx(() => batchSvc.enroll({ batch: world.batch, student: s1, source: "self", startDate: "2026-10-01" }));

  let r = await admin.post(api("/admin/payments")).send({ student_id: sid(s2), student_fee_plan_id: sid(plan), amount: 4000 });
  expect(r.status).toBe(400);
  expect(r.body.detail).toBe("That plan belongs to another student");
  expect(fields(await admin.post(api("/admin/payments")).send({ student_id: sid(s1), amount: 0, method: "cheque" }))).toEqual(["amount", "method"]);
  r = await admin.post(api("/admin/payments")).send({ student_id: sid(world.coach), amount: 10 });
  expect(r.body.detail).toBe("StudentProfile not found");

  r = await admin.post(api("/admin/payments")).send({
    student_id: sid(s1),
    student_fee_plan_id: sid(plan),
    amount: 4000,
    method: "upi",
    reference_no: "UTR1",
    payment_date: "2026-10-02",
    verified: false,
  });
  expect(r.status, r.text).toBe(201);
  expect(r.body).toMatchObject({
    status: "pending",
    amount: 4000,
    method: "upi",
    student_name: "Student 1",
    student_mobile: "9000000101",
    plan_name: "8 sessions",
    plan_final_fee: 4000,
    batch_name: "Batch BEG",
    verified_by_name: null,
    submitted_by_id: sid(world.admin),
  });
  const claim = r.body;

  r = await admin.post(api("/admin/payments")).send({ student_id: sid(s2), amount: 1500 });
  expect(r.body).toMatchObject({ status: "verified", method: "cash", payment_date: TODAY, verified_by_name: "Admin", plan_name: null });
  const cash = r.body;
  expect(await ledger.balance(s2._id)).toBe(1500);
  expect((await AuditLog.findOne({ entity_type: "payment", entity_id: cash.id })).summary).toBe("Recorded cash payment 1500");

  expect((await admin.get(api("/admin/payments/pending-count"))).body).toEqual({ count: 1 });
  const ids = async (qs) => (await admin.get(api(`/admin/payments${qs}`))).body.items.map((p) => p.id);
  expect(await ids("")).toEqual([claim.id, cash.id]);
  expect(await ids("?status=verified")).toEqual([cash.id]);
  expect(await ids(`?student_id=${sid(s2)}`)).toEqual([cash.id]);
  expect(await ids("?start=2026-10-03")).toEqual([cash.id]);
  expect(await ids("?end=2026-10-02")).toEqual([claim.id]);
  expect((await admin.get(api("/admin/payments?student_id=7"))).status).toBe(422);
  expect((await admin.get(api("/admin/finance/pending"))).body.payments.map((p) => p.id)).toEqual([claim.id]);

  // Verifying confirms the plan (billed) and the pending enrollment (BR-11).
  r = await admin.post(api(`/admin/payments/${claim.id}/verify`));
  expect(r.status, r.text).toBe(200);
  expect(r.body).toMatchObject({ status: "verified", verified_by_name: "Admin", rejection_reason: null });
  expect((await BatchStudent.findById(enrollment._id)).status).toBe("active");
  expect((await StudentFeePlan.findById(plan._id)).status).toBe("active");
  expect(await ledger.balance(s1._id)).toBe(0);
  expect((await AuditLog.findOne({ entity_type: "payment", action: "verify" })).summary).toBe("Verified payment 4000.00 (UTR1)");
  expect((await admin.get(api("/admin/payments/pending-count"))).body.count).toBe(0);

  // Rejecting a verified payment reverses its ledger entry.
  expect(fields(await admin.post(api(`/admin/payments/${claim.id}/reject`)).send({ reason: "no" }))).toEqual(["reason"]);
  r = await admin.post(api(`/admin/payments/${claim.id}/reject`)).send({ reason: "UTR not found" });
  expect(r.body).toMatchObject({ status: "rejected", rejection_reason: "UTR not found" });
  expect(await ledger.balance(s1._id)).toBe(-4000);
  expect((await AuditLog.findOne({ entity_type: "payment", action: "reject" })).summary).toBe(
    "Rejected payment 4000.00 (was verified): UTR not found",
  );
  r = await admin.post(api(`/admin/payments/${sid(world.batch)}/verify`));
  expect(r.status).toBe(404);
  expect(r.body.detail).toBe("Payment not found");
});

test("ledger adjustments, refunds and the student statement", async () => {
  const world = await createWorld();
  const s = await world.student();
  const admin = await signIn(ADMIN);
  const url = (p) => api(`/admin/students/${sid(s)}${p}`);

  let r = await admin.post(url("/adjustments")).send({ amount: 0, description: "Nothing" });
  expect(r.status).toBe(400);
  expect(r.body.detail).toBe("Amount cannot be zero");
  expect(fields(await admin.post(url("/adjustments")).send({ amount: 5, description: "ab", kind: "bonus" }))).toEqual(["description", "kind"]);
  r = await admin.post(url("/adjustments")).send({ amount: -1200, description: "Migrated dues", kind: "opening_balance", txn_date: "2026-09-30" });
  expect(r.status, r.text).toBe(201);
  expect(r.body).toMatchObject({
    txn_type: "opening_balance",
    amount: -1200,
    txn_date: "2026-09-30",
    reference_type: "manual",
    student_id: sid(s),
    created_by_id: sid(world.admin),
  });
  r = await admin.post(url("/adjustments")).send({ amount: "200", description: "Goodwill credit" });
  expect(r.body).toMatchObject({ txn_type: "adjustment", amount: 200, txn_date: TODAY });

  r = await admin.post(url("/refunds")).send({ amount: 150, method: "bank_transfer", reference_no: "NEFT9" });
  expect(r.status).toBe(201);
  expect(r.body).toMatchObject({ txn_type: "refund", amount: -150, description: "Refund paid (BANK_TRANSFER NEFT9)", reference_type: "refund" });
  r = await admin.post(url("/refunds")).send({ amount: 50, description: "Overpaid", refund_date: "2026-10-01" });
  expect(r.body).toMatchObject({ amount: -50, description: "Overpaid (UPI)", txn_date: "2026-10-01" });
  expect(fields(await admin.post(url("/refunds")).send({ amount: -5 }))).toEqual(["amount"]);

  let st = (await admin.get(url("/ledger"))).body;
  expect(st).toMatchObject({ opening_balance: 0, charges: 0, payments: 0, credits: 0, refunds: 200, adjustments: -1000, closing_balance: -1200 });
  expect(st.entries.map((e) => [e.txn_date, e.txn_type, e.amount])).toEqual([
    ["2026-09-30", "opening_balance", -1200],
    ["2026-10-01", "refund", -50],
    ["2026-10-15", "adjustment", 200],
    ["2026-10-15", "refund", -150],
  ]);
  st = (await admin.get(url("/ledger?start=2026-10-01&end=2026-10-14"))).body;
  expect(st).toMatchObject({ opening_balance: -1200, refunds: 50, adjustments: 0, closing_balance: -1250 });
  expect(st.entries).toHaveLength(1);
  expect((await admin.get(url("/ledger?start=yesterday"))).status).toBe(422);
  expect((await admin.get(api(`/admin/students/${sid(world.venue)}/ledger`))).status).toBe(404);

  const audit = await auditOf("ledger_transaction");
  expect(audit.map((a) => [a.action, a.summary])).toEqual([
    ["opening_balance", "-1200: Migrated dues"],
    ["adjustment", "200: Goodwill credit"],
    ["refund", "Refund 150"],
    ["refund", "Refund 50"],
  ]);
  expect(audit[0].new_value_json).toMatchObject({ amount: -1200, txn_type: "opening_balance" });
});

test("coach and venue payouts", async () => {
  const world = await createWorld();
  const s = await world.student();
  await enrollActive(world, s, world.batch);
  await generateOctober(world);
  const session = await Session.findOne({ batch_id: world.batch._id, session_date: "2026-10-13" });
  const admin = await signIn(ADMIN);
  const rec = await admin
    .post(api(`/sessions/${sid(session)}/attendance`))
    .send({ entries: [{ student_id: sid(s), status: "present" }], coaches: [{ coach_id: sid(world.coach), hours_coached: 1 }] });
  expect(rec.status, rec.text).toBe(200);

  let c = (await admin.get(api("/admin/payouts/coaches?month=2026-10"))).body;
  expect(c.period).toEqual({ start: "2026-10-01", end: "2026-10-31", month: "2026-10" });
  expect(c.summary).toEqual([
    { coach_id: sid(world.coach), coach: "Coach One", sessions: 1, hours: 1, payable: 800, paid: 0, balance: 800, status: "pending" },
  ]);
  expect(c.detail).toHaveLength(1);
  expect(c.detail[0]).toMatchObject({ session_id: sid(session), date: "2026-10-13", coach: "Coach One", batch: "Batch BEG", venue: "Venue V1", payable: 800 });
  expect(c.payments).toEqual([]);

  const pay = (body) => admin.post(api("/admin/payouts/coaches")).send(body);
  expect(fields(await pay({ coach_id: sid(world.coach), month: "Oct 2026", amount: 0 }))).toEqual(["month", "amount"]);
  let r = await pay({ coach_id: sid(world.venue), month: "2026-10", amount: 100 });
  expect(r.status).toBe(404);
  expect(r.body.detail).toBe("CoachProfile not found");
  r = await pay({ coach_id: sid(world.coach), month: "2026-13", amount: 100 });
  expect(r.status).toBe(400);
  expect(r.body.detail).toBe("month must be YYYY-MM");
  expect((await admin.get(api("/admin/payouts/coaches?month=2026-13"))).status).toBe(400);

  r = await pay({ coach_id: sid(world.coach), month: "2026-10", amount: 500, reference_no: "NEFT1" });
  expect(r.status, r.text).toBe(201);
  expect(r.body).toMatchObject({
    coach_id: sid(world.coach),
    period_month: "2026-10-01",
    amount: 500,
    paid_on: TODAY,
    method: "bank_transfer",
    reference_no: "NEFT1",
    created_by_id: sid(world.admin),
  });
  const first = r.body;
  // A coach paid for a month in which they coached nothing still appears.
  r = await pay({ coach_id: sid(world.coach2), month: "2026-10", amount: 300, paid_on: "2026-10-05", method: "upi" });
  const second = r.body;
  c = (await admin.get(api("/admin/payouts/coaches?month=2026-10"))).body;
  expect(c.summary).toEqual([
    { coach_id: sid(world.coach), coach: "Coach One", sessions: 1, hours: 1, payable: 800, paid: 500, balance: 300, status: "partial" },
    { coach_id: sid(world.coach2), coach: "Coach Two", sessions: 0, hours: 0, payable: 0, paid: 300, balance: -300, status: "paid" },
  ]);
  expect(c.payments.map((p) => [p.id, p.coach])).toEqual([
    [second.id, "Coach Two"],
    [first.id, "Coach One"],
  ]);
  c = (await admin.get(api("/admin/payouts/coaches?month=2026-09"))).body;
  expect(c).toMatchObject({ summary: [], detail: [], payments: [] });

  expect((await admin.delete(api(`/admin/payouts/coaches/${second.id}`))).status).toBe(204);
  r = await admin.delete(api(`/admin/payouts/coaches/${second.id}`));
  expect(r.status).toBe(404);
  expect(r.body.detail).toBe("CoachPayment not found");
  const coachAudit = await auditOf("coach_payment");
  expect(coachAudit.map((a) => a.action)).toEqual(["create", "create", "delete"]);
  expect(coachAudit[0].summary).toBe(`Paid coach ${sid(world.coach)} 500 for 2026-10`);
  expect(coachAudit[2].old_value_json).toMatchObject({ amount: 300 });

  // Venues
  let v = (await admin.get(api("/admin/payouts/venues?month=2026-10"))).body;
  expect(v.summary).toEqual([
    {
      venue_id: sid(world.venue),
      venue: "Venue V1",
      sessions: 1,
      hours_booked: 1,
      court_hours: 2,
      payable: 1600,
      paid: 0,
      balance: 1600,
      status: "pending",
    },
  ]);
  expect(v.detail[0]).toMatchObject({ day_type: "weekday", time_slot: "evening", courts: 2, rate_applied: 800, payable: 1600 });
  r = await admin.post(api("/admin/payouts/venues")).send({ venue_id: sid(world.venue), month: "2026-10", amount: 1600 });
  expect(r.status).toBe(201);
  r = await admin.post(api("/admin/payouts/venues")).send({ venue_id: sid(world.venue2), month: "2026-10", amount: 100, method: "cash" });
  const v2 = r.body;
  expect(v2).toMatchObject({ venue_id: sid(world.venue2), method: "cash", period_month: "2026-10-01" });
  v = (await admin.get(api("/admin/payouts/venues"))).body;
  expect(v.period.month).toBe("2026-10");
  expect(v.summary.map((x) => [x.venue, x.paid, x.balance, x.status])).toEqual([
    ["Venue V1", 1600, 0, "paid"],
    ["Venue V2", 100, -100, "paid"],
  ]);
  expect(v.summary[1]).toMatchObject({ sessions: 0, hours_booked: 0, court_hours: 0, payable: 0 });
  expect(v.payments.map((p) => p.venue).sort()).toEqual(["Venue V1", "Venue V2"]);
  r = await admin.post(api("/admin/payouts/venues")).send({ venue_id: sid(world.coach), month: "2026-10", amount: 100 });
  expect(r.body.detail).toBe("Venue not found");
  expect((await admin.delete(api(`/admin/payouts/venues/${v2.id}`))).status).toBe(204);
  expect((await auditOf("venue_payment")).map((a) => [a.action, a.summary])).toEqual([
    ["create", `Paid venue ${sid(world.venue)} 1600 for 2026-10`],
    ["create", `Paid venue ${sid(world.venue2)} 100 for 2026-10`],
    ["delete", "Deleted venue payment"],
  ]);
});

test("overview alerts, finance report, reports, CSV/Excel exports and the audit log", async () => {
  const world = await createWorld();
  const aid = world.academy._id;
  const s1 = await world.student();
  const s2 = await world.student();
  const s3 = await world.student({ name: 'Rao, "Ace"' });
  await enrollActive(world, s1, world.batch);
  await tx(() => batchSvc.enroll({ batch: world.batch2, student: s2, source: "self", startDate: "2026-10-01" }));
  await generateOctober(world);
  await Payment.create({ academy_id: aid, student_id: s2._id, amount: 4000, payment_date: TODAY, method: "upi", status: "pending" });
  await activePlan(world, s2, { name: "September", baseFee: 2000, sessions: 4, start: "2026-09-01", end: "2026-09-30" });
  const missed = await Session.findOne({ batch_id: world.batch._id, session_date: "2026-10-01" });
  await MakeupCredit.create({ academy_id: aid, student_id: s1._id, missed_session_id: missed._id, original_batch_id: world.batch._id, status: "pending_approval" });
  await Enquiry.create({ academy_id: aid, name: "Asha", message: "Do you have kids batches?" });
  const u = await User.create({ name: "Coach Three", mobile: "9000000013", roles: [{ academy_id: aid, role: "coach" }] });
  await CoachProfile.create({ _id: u._id, academy_id: aid });
  const v3 = await Venue.create({ academy_id: aid, code: "V3", name: "Venue V3" });
  // A session recorded with zero coach and venue rates, and an attendance not drawing on any plan.
  const zero = await Session.create({
    academy_id: aid,
    batch_id: world.batch2._id,
    session_date: "2026-10-10",
    start_time: "09:00",
    end_time: "10:00",
    duration_minutes: 60,
    venue_id: v3._id,
    status: "completed",
    venue_rate_applied: 0,
    court_payable: 0,
    coaches: [{ coach_id: u._id, scheduled_hours: 1, hours_coached: 1, rate_applied: 0, payable_amount: 0 }],
  });
  await SessionAttendance.create({
    session_id: zero._id,
    student_id: s2._id,
    academy_id: aid,
    session_date: "2026-10-10",
    attended_batch_id: world.batch2._id,
    attendance_status: "present",
    billing_mode: "package",
  });
  // An expired available make-up is expired by the overview.
  const expiring = await MakeupCredit.create({
    academy_id: aid,
    student_id: s1._id,
    missed_session_id: missed._id,
    original_batch_id: world.batch._id,
    status: "available",
    expires_on: "2026-10-14",
  });
  const admin = await signIn(ADMIN);

  const ov = (await admin.get(api("/admin/overview"))).body;
  expect(ov.month).toBe("October 2026");
  expect(ov.alerts.map((a) => [a.count, a.level, a.text, a.link])).toEqual([
    [1, "warning", "payments awaiting verification", "/admin/finance"],
    [1, "warning", "enrollments awaiting confirmation", "/admin/batches"],
    [8, "danger", "past sessions without attendance", "/admin/sessions?status=scheduled&past=1"],
    [1, "warning", "make-up requests awaiting approval", "/admin/makeups?status=pending_approval"],
    [1, "info", "plans past their end date to close", "/admin/finance"],
    [1, "warning", "attendances not linked to any fee plan (last 90 days)", "/admin/reports"],
    [1, "danger", "coach entries recorded with a zero rate (last 90 days)", "/admin/coaches"],
    [1, "danger", "sessions recorded with a zero venue rate (last 90 days)", "/admin/venues"],
    [1, "danger", "active coaches without an hourly rate", "/admin/coaches"],
    [1, "danger", "active venues without a rate card", "/admin/venues"],
    [2, "info", "students with outstanding dues", "/admin/students?dues=1"],
    [1, "info", "new website enquiries", "/admin/website/enquiries"],
  ]);
  expect(ov.counts).toEqual({ active_students: 3, active_enrollments: 1 });
  expect(ov.summary.income.billed).toBe(4000);
  expect(ov.summary.receivables).toMatchObject({ outstanding_balances: 6000, students_with_dues: 2, pending_verification_count: 1 });
  expect(ov.series.map((x) => x.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  expect(ov.upcoming_sessions.map((x) => [x.session_date, x.batch_name, x.expected_count, x.present_count])).toEqual([
    ["2026-10-15", "Batch BEG", 1, 0],
  ]);
  expect((await MakeupCredit.findById(expiring._id)).status).toBe("expired");

  // Finance report + series
  let r = await admin.get(api("/admin/reports/finance?month=2026-10"));
  expect(r.status).toBe(200);
  expect(Object.keys(r.body.summary)).toEqual(expect.arrayContaining(["income", "expenses", "net", "receivables", "liabilities"]));
  expect(r.body.summary.period).toEqual({ start: "2026-10-01", end: "2026-10-31" });
  expect(r.body.series).toHaveLength(6);
  expect((await admin.get(api("/admin/reports/finance?month=2026-10&months=30"))).body.series).toHaveLength(24);
  expect((await admin.get(api("/admin/reports/finance?month=2026-10&months=0"))).body.series.map((x) => x.month)).toEqual(["2026-10"]);
  r = await admin.get(api(`/admin/reports/finance?start=2026-09-01&end=2026-09-30&batch_id=${sid(world.batch)}`));
  expect(r.body.summary.period).toEqual({ start: "2026-09-01", end: "2026-09-30" });
  expect(r.body.summary.income.billed).toBe(0);
  r = await admin.get(api("/admin/reports/finance?start=2026-10-10&end=2026-10-01"));
  expect(r.status).toBe(400);
  expect(r.body.detail).toBe("end is before start");
  expect((await admin.get(api("/admin/reports/finance?month=2026-13"))).body.detail).toBe("month must be YYYY-MM");
  expect((await admin.get(api("/admin/reports/finance?coach_id=abc"))).status).toBe(422);

  for (const kind of ["batches", "coaches", "venues", "students", "monthly"]) {
    r = await admin.get(api(`/admin/reports/${kind}?month=2026-10`));
    expect(r.status, kind).toBe(200);
    expect(r.body.period).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(Array.isArray(r.body.rows) && Array.isArray(r.body.detail)).toBe(true);
  }
  const batches = (await admin.get(api("/admin/reports/batches?month=2026-10"))).body.rows;
  expect(batches.map((b) => [b.batch, b.enrolled, b.billed])).toEqual([
    ["Batch BEG", 1, 4000],
    ["Batch INT", 1, 0],
  ]);
  const students = (await admin.get(api("/admin/reports/students?month=2026-10"))).body.rows;
  expect(students.map((x) => [x.student, x.billed, x.balance, x.present, x.sessions_remaining])).toEqual([
    ['Rao, "Ace"', 0, 0, 0, 0],
    ["Student 1", 4000, -4000, 0, 8],
    ["Student 2", 0, -2000, 1, 4],
  ]);
  const coaches = (await admin.get(api("/admin/reports/coaches?month=2026-10"))).body;
  expect(coaches.rows.map((x) => [x.coach, x.sessions, x.status])).toEqual([["Coach Three", 1, "nothing_due"]]);
  expect(coaches.detail).toHaveLength(1);
  const monthly = (await admin.get(api("/admin/reports/monthly?start=2026-08-01&end=2026-10-15"))).body;
  expect(monthly.rows.map((x) => x.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
  expect(monthly.rows[1].billed).toBe(2000);
  r = await admin.get(api("/admin/reports/payroll?month=2026-10"));
  expect(r.status).toBe(404);
  expect(r.body.detail).toBe("Unknown report");

  // CSV: UTF-8 with BOM, Python csv quoting, CRLF line endings.
  r = await admin.get(api("/admin/reports/students/export?month=2026-10&format=csv")).buffer(true).parse(binary);
  expect(r.status).toBe(200);
  expect(r.headers["content-type"]).toContain("text/csv");
  expect(r.headers["content-disposition"]).toBe('attachment; filename="luvall-students-2026-10-01-to-2026-10-31.csv"');
  expect([...r.body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const lines = r.body.subarray(3).toString("utf8").split("\r\n");
  expect(lines[0]).toBe("student_id,student,mobile,status,billed,paid,credits,refunds,balance,present,makeups,absent,cancelled,sessions_remaining");
  expect(lines[1]).toBe(`${sid(s3)},"Rao, ""Ace""",9000000103,active,0,0,0,0,0,0,0,0,0,0`);
  expect(lines[2]).toBe(`${sid(s1)},Student 1,9000000101,active,4000,0,0,0,-4000,0,0,0,0,8`);
  expect(lines).toHaveLength(5);
  expect(lines[4]).toBe("");
  r = await admin.get(api("/admin/reports/coaches/export?month=2026-09")).buffer(true).parse(binary);
  expect(r.body.toString("utf8")).toBe("﻿no_data\r\n");
  expect(r.headers["content-disposition"]).toBe('attachment; filename="luvall-coaches-2026-09-01-to-2026-09-30.csv"');
  expect((await admin.get(api("/admin/reports/coaches/export?format=pdf"))).status).toBe(422);
  expect((await admin.get(api("/admin/reports/payroll/export?month=2026-10"))).status).toBe(404);

  // Excel: title-cased headers, values and column widths.
  r = await admin.get(api("/admin/reports/coaches/export?month=2026-10&format=xlsx&detail=true")).buffer(true).parse(binary);
  expect(r.status).toBe(200);
  expect(r.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  expect(r.headers["content-disposition"]).toBe('attachment; filename="luvall-coaches-detail-2026-10-01-to-2026-10-31.xlsx"');
  expect(r.body.subarray(0, 2).toString()).toBe("PK");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.body);
  const ws = wb.getWorksheet("coaches");
  expect(ws.getRow(1).values.slice(1)).toEqual([
    "Session Id",
    "Date",
    "Coach Id",
    "Coach",
    "Batch",
    "Venue",
    "Status",
    "Scheduled Hours",
    "Hours Coached",
    "Rate Applied",
    "Adjustment",
    "Adjustment Note",
    "Payable",
  ]);
  expect(ws.getRow(2).values.slice(1, 8)).toEqual([sid(zero), "2026-10-10", sid(u), "Coach Three", "Batch INT", "Venue V3", "completed"]);
  expect(ws.getRow(2).getCell(8).value).toBe(1);
  expect(ws.getColumn(1).width).toBe(26);
  expect(ws.getColumn(2).width).toBe(12);
  expect(ws.getColumn(8).width).toBe(17);
  r = await admin.get(api("/admin/reports/batches/export?month=2026-10&format=xlsx")).buffer(true).parse(binary);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(r.body);
  expect(wb2.getWorksheet("batches").getRow(1).values.slice(1, 4)).toEqual(["Batch Id", "Batch", "Code"]);
  expect(wb2.getWorksheet("batches").rowCount).toBe(3);

  // Audit log
  await admin.post(api("/admin/faqs")).send({ question: "Where?", answer: "Here" });
  await admin.post(api(`/admin/students/${sid(s1)}/adjustments`)).send({ amount: 100, description: "Goodwill" });
  await AuditLog.create({ academy_id: aid, entity_type: "system", action: "reminders", summary: "Sent 3 reminders" });
  let audit = (await admin.get(api("/admin/audit"))).body;
  expect(audit.total).toBe(3);
  expect(audit.entity_types).toEqual(["faq", "ledger_transaction", "system"]);
  expect(audit.items.map((a) => [a.entity_type, a.user_name])).toEqual([
    ["system", null],
    ["ledger_transaction", "Admin"],
    ["faq", "Admin"],
  ]);
  expect(audit.items[2]).toMatchObject({ action: "create", summary: "Created faq", user_id: sid(world.admin), academy_id: sid(world.academy) });
  expect((await admin.get(api("/admin/audit?entity_type=faq"))).body.items.map((a) => a.summary)).toEqual(["Created faq"]);
  expect((await admin.get(api("/admin/audit?q=GOODWILL"))).body.total).toBe(1);
  expect((await admin.get(api(`/admin/audit?user_id=${sid(world.admin)}`))).body.total).toBe(2);
  audit = (await admin.get(api("/admin/audit?page=2&page_size=2"))).body;
  expect(audit).toMatchObject({ total: 3, page: 2, page_size: 2 });
  expect(audit.items.map((a) => a.entity_type)).toEqual(["faq"]);
});

test("CMS content: unique slugs, publish window, video links, post images, albums, events and enquiries", async () => {
  const world = await createWorld();
  const aid = world.academy._id;
  const admin = await signIn(ADMIN);

  // Programs: unique slugs, filters, search; deleting one unlinks its batches.
  let r = await admin.post(api("/admin/programs")).send({ title: "Kids Pickleball", status: "published" });
  expect(r.status, r.text).toBe(201);
  expect(r.body).toMatchObject({ slug: "kids-pickleball", display_order: 0, status: "published", summary: null });
  const p1 = r.body;
  const p2 = (await admin.post(api("/admin/programs")).send({ title: "Kids pickleball!", display_order: 2 })).body;
  expect(p2.slug).toBe("kids-pickleball-2");
  const p3 = (await admin.post(api("/admin/programs")).send({ title: "Adults", slug: "Kids Pickleball", display_order: 1 })).body;
  expect(p3.slug).toBe("kids-pickleball-3");
  expect(fields(await admin.post(api("/admin/programs")).send({ title: "K", status: "live" }))).toEqual(["title", "status"]);
  r = await admin.post(api("/admin/programs")).send({ title: "Live", status: "live" });
  expect(r.body.detail[0].msg).toBe("String should match pattern '^(draft|published|archived)$'");
  expect((await admin.get(api("/admin/programs"))).body.items.map((p) => p.title)).toEqual(["Kids Pickleball", "Adults", "Kids pickleball!"]);
  expect((await admin.get(api("/admin/programs?status=published"))).body.items.map((p) => p.id)).toEqual([p1.id]);
  expect((await admin.get(api("/admin/programs?q=PICKLE"))).body.total).toBe(2);
  r = await admin.patch(api(`/admin/programs/${p2.id}`)).send({ slug: null });
  expect(r.body.slug).toBe("kids-pickleball-2");
  r = await admin.patch(api(`/admin/programs/${p2.id}`)).send({ slug: "Adult League" });
  expect(r.body.slug).toBe("adult-league");
  r = await admin.patch(api(`/admin/programs/${p3.id}`)).send({ title: "Adults & seniors" });
  expect(r.body).toMatchObject({ title: "Adults & seniors", slug: "kids-pickleball-3" });
  await Batch.updateOne({ _id: world.batch._id }, { program_id: p1.id });
  expect((await admin.delete(api(`/admin/programs/${p1.id}`))).status).toBe(204);
  expect((await Batch.findById(world.batch._id)).program_id).toBeNull();
  expect((await admin.get(api(`/admin/programs/${p1.id}`))).body.detail).toBe("Program not found");

  // Posts: video host check, publish window, ordered de-duplicated images.
  r = await admin.post(api("/admin/posts")).send({ title: "Bad video", category: "event", video_url: "http://evil.example/x.mp4" });
  expect(r.status).toBe(400);
  expect(r.body.detail).toBe("Use an https YouTube, Instagram, Vimeo or Facebook video link");
  r = await admin.post(api("/admin/posts")).send({
    title: "Window",
    category: "event",
    publish_from: "2026-10-20T00:00:00Z",
    publish_to: "2026-10-19T00:00:00Z",
  });
  expect(r.status).toBe(400);
  expect(r.body.detail).toBe("Expiry must be after the publication date");
  expect(fields(await admin.post(api("/admin/posts")).send({ title: "No category" }))).toEqual(["category"]);
  const m1 = await MediaAsset.create({ academy_id: aid, media_type: "image", storage_url: "/media/cms/a.webp" });
  const m2 = await MediaAsset.create({ academy_id: aid, media_type: "image", storage_url: "/media/cms/b.webp" });
  r = await admin.post(api("/admin/posts")).send({
    title: "State gold!",
    category: "achievement",
    status: "published",
    video_url: " https://www.instagram.com/reel/abc123/ ",
    image_ids: [sid(m2), sid(m1), sid(m2)],
  });
  expect(r.status, r.text).toBe(201);
  expect(r.body).toMatchObject({ slug: "state-gold", video_url: "https://www.instagram.com/reel/abc123/", is_featured: false, publish_from: null });
  expect(r.body.images.map((m) => m.id)).toEqual([sid(m2), sid(m1)]);
  expect(r.body.images[0]).toMatchObject({ storage_url: "/media/cms/b.webp", media_type: "image" });
  const post = r.body;
  r = await admin.post(api("/admin/posts")).send({ title: "State gold!", category: "achievement" });
  expect(r.body).toMatchObject({ slug: "state-gold-2", status: "draft", images: [] });
  r = await admin.patch(api(`/admin/posts/${post.id}`)).send({ image_ids: [sid(m1)] });
  expect(r.body.images.map((m) => m.id)).toEqual([sid(m1)]);
  r = await admin.patch(api(`/admin/posts/${post.id}`)).send({ title: "State gold medal", publish_from: "2026-10-10T00:00:00Z", image_ids: null });
  expect(r.body).toMatchObject({ title: "State gold medal", slug: "state-gold", publish_from: "2026-10-10T00:00:00.000Z" });
  expect(r.body.images.map((m) => m.id)).toEqual([sid(m1)]);
  r = await admin.patch(api(`/admin/posts/${post.id}`)).send({ publish_to: "2026-10-09T00:00:00Z" });
  expect(r.status).toBe(400);
  r = await admin.patch(api(`/admin/posts/${post.id}`)).send({ image_ids: [sid(world.batch)] });
  expect(r.status).toBe(404);
  expect(r.body.detail).toBe("MediaAsset not found");
  expect((await admin.get(api(`/admin/posts/${post.id}`))).body.images.map((m) => m.id)).toEqual([sid(m1)]);
  expect((await admin.get(api("/admin/posts?category=achievement"))).body.total).toBe(2);
  expect((await admin.get(api("/admin/posts?status=draft"))).body.items.map((p) => p.slug)).toEqual(["state-gold-2"]);
  const postAudit = await auditOf("post");
  expect(postAudit.map((a) => a.action)).toEqual(["create", "create", "update", "update"]);
  expect(postAudit[3].new_value_json).toMatchObject({ title: "State gold medal" });

  // Albums: items in the given order, cover as media JSON.
  r = await admin.post(api("/admin/albums")).send({ title: "Summer camp", cover_media_id: sid(m1) });
  expect(r.status).toBe(201);
  expect(r.body).toMatchObject({ slug: "summer-camp", items: [], status: "draft" });
  expect(r.body.cover.id).toBe(sid(m1));
  const album = r.body;
  r = await admin.put(api(`/admin/albums/${album.id}/items`)).send([sid(m2), sid(m1), sid(m2)]);
  expect(r.status, r.text).toBe(200);
  expect(r.body.items.map((m) => m.id)).toEqual([sid(m2), sid(m1)]);
  expect((await admin.put(api(`/admin/albums/${album.id}/items`)).send(["abc"])).status).toBe(422);
  r = await admin.put(api(`/admin/albums/${album.id}/items`)).send([sid(world.batch)]);
  expect(r.body.detail).toBe("MediaAsset not found");
  expect((await admin.put(api(`/admin/albums/${sid(world.batch)}/items`)).send([])).body.detail).toBe("GalleryAlbum not found");
  expect((await admin.get(api(`/admin/albums/${album.id}`))).body.items.map((m) => m.id)).toEqual([sid(m2), sid(m1)]);
  expect((await admin.get(api("/admin/albums"))).body.items[0].items).toHaveLength(2);
  const setItems = await AuditLog.findOne({ entity_type: "gallery_album", action: "set_items" });
  expect(setItems.summary).toBe("3 items in Summer camp");
  r = await admin.patch(api(`/admin/albums/${album.id}`)).send({ cover_media_id: null });
  expect(r.body.cover).toBeNull();

  // Events, testimonials, FAQs and announcements.
  expect(fields(await admin.post(api("/admin/events")).send({ title: "x" }))).toEqual(["title", "event_date"]);
  r = await admin.post(api("/admin/events")).send({ title: "Autumn Open", event_date: "2026-11-02", venue_id: sid(world.venue) });
  expect(r.body).toMatchObject({ slug: "autumn-open", status: "draft", venue_id: sid(world.venue), end_date: null });
  await admin.post(api("/admin/events")).send({ title: "Winter clinic", event_date: "2026-12-05" });
  expect((await admin.get(api("/admin/events"))).body.items.map((e) => e.title)).toEqual(["Winter clinic", "Autumn Open"]);
  expect((await admin.post(api("/admin/testimonials")).send({ author_name: "Meera", quote: "Great coaching!", rating: 6 })).status).toBe(422);
  r = await admin.post(api("/admin/testimonials")).send({ author_name: "Meera", quote: "Great coaching!", rating: 5 });
  expect(r.body).toMatchObject({ rating: 5, status: "draft" });
  r = await admin.patch(api(`/admin/testimonials/${r.body.id}`)).send({ rating: null });
  expect(r.body.rating).toBeNull();
  expect((await admin.get(api("/admin/testimonials?q=coaching"))).body.total).toBe(1);
  const f1 = (await admin.post(api("/admin/faqs")).send({ question: "Where?", answer: "Here" })).body;
  expect(f1.status).toBe("published");
  const f0 = (await admin.post(api("/admin/faqs")).send({ question: "When?", answer: "Daily", display_order: -1 })).body;
  expect((await admin.get(api("/admin/faqs"))).body.items.map((f) => f.id)).toEqual([f0.id, f1.id]);
  expect((await admin.post(api("/admin/announcements")).send({ title: "Holiday", message: "Closed", audience: "everyone" })).status).toBe(422);
  const pinned = (await admin.post(api("/admin/announcements")).send({ title: "Holiday", message: "Closed on Diwali", audience: "members", is_pinned: true })).body;
  expect(pinned).toMatchObject({ audience: "members", is_pinned: true, status: "draft", link_url: null });
  const plain = (await admin.post(api("/admin/announcements")).send({ title: "New batch", message: "Starting soon" })).body;
  expect((await admin.get(api("/admin/announcements"))).body.items.map((a) => a.id)).toEqual([pinned.id, plain.id]);
  expect((await admin.get(api("/admin/announcements?audience=members"))).body.items.map((a) => a.id)).toEqual([pinned.id]);

  // Enquiries: no create, new first, status only.
  const old = await Enquiry.create({ academy_id: aid, name: "Ravi", message: "Fees?", status: "contacted" });
  const fresh = await Enquiry.create({ academy_id: aid, name: "Asha", mobile: "9876543210", message: "Kids batch?" });
  r = await admin.post(api("/admin/enquiries")).send({ name: "x", message: "y" });
  expect(r.status).toBe(405);
  expect((await admin.get(api("/admin/enquiries"))).body.items.map((e) => e.id)).toEqual([sid(fresh), sid(old)]);
  expect((await admin.get(api("/admin/enquiries?q=kids"))).body.total).toBe(1);
  expect(fields(await admin.patch(api(`/admin/enquiries/${sid(fresh)}`)).send({}))).toEqual(["status"]);
  expect((await admin.patch(api(`/admin/enquiries/${sid(fresh)}`)).send({ status: "replied" })).status).toBe(422);
  r = await admin.patch(api(`/admin/enquiries/${sid(fresh)}`)).send({ status: "contacted" });
  expect(r.body).toMatchObject({ status: "contacted", name: "Asha" });
  expect((await admin.delete(api(`/admin/enquiries/${sid(old)}`))).status).toBe(204);

  const types = (await AuditLog.distinct("entity_type")).sort();
  expect(types).toEqual(["announcement", "enquiry", "event", "faq", "gallery_album", "post", "program", "testimonial"]);
});

test("media library: image upload, video links, captions, delete and quick upload", async () => {
  const world = await createWorld();
  const admin = await signIn(ADMIN);
  const album = (await admin.post(api("/admin/albums")).send({ title: "Courts" })).body;
  const fileOf = (url) => path.join(config.mediaRoot, url.slice(`${config.mediaUrlPrefix}/`.length));

  let r = await admin.post(api("/admin/media/upload")).attach("file", Buffer.from("not an image"), "x.png");
  expect(r.status).toBe(400);
  expect(r.body.detail).toBe("The file is not a supported image");
  r = await admin.post(api("/admin/media/upload")).field("caption", "No file");
  expect(r.status).toBe(422);
  expect(fields(r)).toEqual(["file"]);

  const jpeg = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 10, g: 120, b: 80 } } }).jpeg().toBuffer();
  r = await admin.post(api("/admin/media/upload")).attach("file", jpeg, "court.jpg").field("caption", "Court").field("album_id", album.id);
  expect(r.status, r.text).toBe(201);
  expect(r.body).toMatchObject({ media_type: "image", width: 1920, height: 1280, caption: "Court", alt_text: "Court", uploaded_by_id: sid(world.admin) });
  expect(r.body.storage_url).toMatch(/^\/media\/cms\/[0-9a-f]{32}\.webp$/);
  const image = r.body;
  expect(fs.existsSync(fileOf(image.storage_url))).toBe(true);
  expect(fs.existsSync(fileOf(image.thumbnail_url))).toBe(true);
  r = await admin.post(api("/admin/media/upload")).attach("file", jpeg, "court.jpg").field("album_id", sid(world.batch));
  expect(r.status).toBe(404);
  expect(r.body.detail).toBe("GalleryAlbum not found");

  r = await admin.post(api("/admin/media/video")).send({ url: "http://evil.example/x.mp4" });
  expect(r.status).toBe(400);
  r = await admin.post(api("/admin/media/video")).send({ url: "https://youtu.be/abc", caption: "Rally", album_id: album.id });
  expect(r.status).toBe(201);
  expect(r.body).toMatchObject({ media_type: "video", storage_url: "https://youtu.be/abc", alt_text: "Rally", thumbnail_url: null });
  const video = r.body;

  let list = (await admin.get(api("/admin/media"))).body;
  expect(list).toMatchObject({ total: 2, page: 1, page_size: 48 });
  expect(list.items.map((m) => m.id)).toEqual([video.id, image.id]);
  expect((await admin.get(api("/admin/media?media_type=video"))).body.items.map((m) => m.id)).toEqual([video.id]);
  expect((await admin.get(api(`/admin/albums/${album.id}`))).body.items.map((m) => m.id)).toEqual([image.id, video.id]);

  r = await admin.patch(api(`/admin/media/${image.id}`)).send({ caption: "Centre court", alt_text: "Centre court" });
  expect(r.body).toMatchObject({ caption: "Centre court", alt_text: "Centre court" });
  expect((await admin.patch(api(`/admin/media/${image.id}`)).send({ caption: "x".repeat(301) })).status).toBe(422);

  // Deleting an image removes it from posts and albums and deletes the stored files.
  const post = (await admin.post(api("/admin/posts")).send({ title: "Courts", category: "academy_update", image_ids: [image.id] })).body;
  await admin.patch(api(`/admin/albums/${album.id}`)).send({ cover_media_id: image.id });
  expect((await admin.delete(api(`/admin/media/${image.id}`))).status).toBe(204);
  expect(fs.existsSync(fileOf(image.storage_url))).toBe(false);
  expect(fs.existsSync(fileOf(image.thumbnail_url))).toBe(false);
  expect((await Post.findById(post.id)).image_ids).toEqual([]);
  const a = await GalleryAlbum.findById(album.id);
  expect(a.media_ids.map(String)).toEqual([video.id]);
  expect(a.cover_media_id).toBeNull();
  r = await admin.delete(api(`/admin/media/${image.id}`));
  expect(r.status).toBe(404);
  expect(r.body.detail).toBe("MediaAsset not found");
  expect((await admin.delete(api(`/admin/media/${video.id}`))).status).toBe(204);

  // Quick upload for image fields (logo, cover, QR code).
  const png = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
  r = await admin.post(api("/admin/uploads/image")).attach("file", png, "logo.png");
  expect(r.status, r.text).toBe(201);
  expect(Object.keys(r.body).sort()).toEqual(["id", "thumbnail_url", "url"]);
  expect(fs.existsSync(fileOf(r.body.url))).toBe(true);
  expect(await MediaAsset.findById(r.body.id)).toMatchObject({ caption: "logo.png", width: 200, height: 100 });
  expect((await admin.post(api("/admin/uploads/image"))).status).toBe(422);

  const audit = await auditOf("media_asset");
  expect(audit.map((x) => [x.action, x.summary])).toEqual([
    ["upload", "Uploaded court.jpg"],
    ["add_video", "https://youtu.be/abc"],
    ["update", "Updated media"],
    ["delete", "Deleted media"],
    ["delete", "Deleted media"],
    ["upload", "Uploaded logo.png"],
  ]);
  expect(audit[2].old_value_json).toEqual({ caption: "Court", alt_text: "Court" });
});

test("homepage content, business rules and academy profile", async () => {
  const world = await createWorld();
  const admin = await signIn(ADMIN);

  let r = await admin.get(api("/admin/site-content"));
  expect(r.body).toEqual(SiteContent.parse({}));
  r = await admin.put(api("/admin/site-content")).send({ hero_title: "Play more", stats: [{ label: "Players", value: "600+" }] });
  expect(r.status, r.text).toBe(200);
  expect(r.body).toMatchObject({ hero_title: "Play more", hero_eyebrow: "Pickleball coaching academy", stats: [{ label: "Players", value: "600+" }] });
  expect((await Academy.findById(world.academy._id)).site_content.hero_title).toBe("Play more");
  expect((await admin.get(api("/admin/site-content"))).body.hero_title).toBe("Play more");
  expect((await admin.put(api("/admin/site-content")).send({ stats: [{ label: "x" }] })).status).toBe(422);
  const sc = await AuditLog.findOne({ entity_type: "site_content" });
  expect(sc).toMatchObject({ action: "update", summary: "Updated homepage content", entity_id: sid(world.academy) });
  expect(sc.new_value_json).toMatchObject({ hero_title: "Play more" });
  expect(sc.new_value_json).not.toHaveProperty("hero_eyebrow");

  r = await admin.get(api("/admin/settings"));
  expect(r.body).toMatchObject({ default_min_players: 4, default_max_players: 6, drop_in_fee: 500, morning_evening_boundary: "12:00" });
  expect(r.body.makeup).toMatchObject({ expiry_days: 30, requires_approval: false });
  r = await admin.put(api("/admin/settings")).send({ default_min_players: 8, default_max_players: 6 });
  expect(r.status).toBe(400);
  expect(r.body.detail).toBe("Default minimum players cannot exceed maximum");
  expect((await admin.put(api("/admin/settings")).send({ weekend_days: [7] })).status).toBe(422);
  r = await admin.put(api("/admin/settings")).send({ drop_in_fee: "650", morning_evening_boundary: "11:30:00", makeup: { requires_approval: true } });
  expect(r.status, r.text).toBe(200);
  expect(r.body).toMatchObject({ drop_in_fee: 650, morning_evening_boundary: "11:30", weekend_days: [5, 6] });
  expect(r.body.makeup).toMatchObject({ requires_approval: true, expiry_days: 30, student_can_book: true });
  expect((await admin.get(api("/admin/settings"))).body.drop_in_fee).toBe(650);
  const st = await AuditLog.findOne({ entity_type: "settings" });
  expect(st.summary).toBe("Updated business rules");
  expect(st.old_value_json).toMatchObject({ drop_in_fee: 500, morning_evening_boundary: "12:00" });
  expect(st.new_value_json).toMatchObject({ drop_in_fee: 650, morning_evening_boundary: "11:30" });

  r = await admin.get(api("/admin/academy"));
  expect(r.body).toMatchObject({ id: sid(world.academy), code: "LUVALL", name: "LuvAll Sports", sport_scope: "pickleball" });
  expect(r.body).not.toHaveProperty("settings");
  expect(r.body).not.toHaveProperty("site_content");
  expect(fields(await admin.patch(api("/admin/academy")).send({ email: "not-an-email", name: "L" }))).toEqual(["name", "email"]);
  r = await admin.patch(api("/admin/academy")).send({ name: "LuvAll Sports Academy", email: "hello@luvall.in", contact_no: "9876543210", location: null });
  expect(r.status, r.text).toBe(200);
  expect(r.body).toMatchObject({ name: "LuvAll Sports Academy", email: "hello@luvall.in", contact_no: "9876543210", location: null });
  expect(r.body).not.toHaveProperty("settings");
  const ac = await AuditLog.findOne({ entity_type: "academy" });
  expect(ac.old_value_json).toMatchObject({ name: "LuvAll Sports", email: null });
  expect(ac.new_value_json).toMatchObject({ name: "LuvAll Sports Academy", email: "hello@luvall.in" });
});
