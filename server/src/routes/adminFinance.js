/** Admin: pricing, student plans, payment verification, ledger, payouts and expenses (brief sections 7–11). */
import express from "express";

import { adminOnly } from "../middleware/auth.js";
import {
  Batch,
  CoachPayment,
  CoachProfile,
  Expense,
  FeePlan,
  oid,
  Payment,
  sameId,
  sid,
  StudentFeePlan,
  StudentProfile,
  toJSON,
  User,
  Venue,
  VenuePayment,
} from "../models/index.js";
import { snapshot } from "../services/audit.js";
import * as finance from "../services/finance.js";
import * as ledger from "../services/ledger.js";
import { today } from "../utils/clock.js";
import { addDays } from "../utils/dates.js";
import { BusinessRuleError } from "../utils/errors.js";
import { read, write } from "../utils/http.js";
import { q } from "../utils/money.js";
import { opt, parseBody, parseQuery, z, zDate, zId } from "../utils/validate.js";
import { reportPeriod } from "./adminReports.js";
import { applyUpdates, getOr404, log, pageOut, pageParams } from "./common.js";
import { bool, crudRouter, money, nul, num, pattern, sortedPage, str } from "./crud.js";
import { paymentOut, planOut } from "./serializers.js";

const router = express.Router();

const PAYMENT_METHOD = /^(upi|cash|bank_transfer|other)$/;

/** Money as Python printed a stored Numeric(…, 2) value in summaries ("4000.00"). */
const money2 = (value) => q(value).toFixed(2);
/** Python's str() of an optional value. */
const pyStr = (value) => (value === null || value === undefined ? "None" : String(value));

// --- Fee plan templates --------------------------------------------------------------------------------------

const PLAN_TYPE = /^(monthly|package|per_session)$/;
const ACTIVE_STATUS = /^(active|inactive)$/;

const FeePlanIn = z.object({
  name: str({ min: 2, max: 200 }),
  description: nul(str({ max: 2000 })),
  plan_type: pattern(PLAN_TYPE).default("monthly"),
  number_of_sessions: num({ int: true, ge: 1, le: 500 }),
  base_fee: money({ ge: 0 }),
  validity_days: nul(num({ int: true, ge: 1, le: 730 })),
  is_public: bool().default(true),
  status: pattern(ACTIVE_STATUS).default("active"),
});

const FeePlanPatch = z.object({
  name: opt(str({ min: 2, max: 200 })),
  description: opt(str({ max: 2000 })),
  plan_type: opt(pattern(PLAN_TYPE)),
  number_of_sessions: opt(num({ int: true, ge: 1, le: 500 })),
  base_fee: opt(money({ ge: 0 })),
  validity_days: opt(num({ int: true, ge: 1, le: 730 })),
  is_public: opt(bool()),
  status: opt(pattern(ACTIVE_STATUS)),
});

/** Batches and student plans keep their data when a template is deleted (FK ON DELETE SET NULL). */
async function unlinkFeePlan(plan) {
  await Batch.updateMany({ fee_plan_id: plan._id }, { $set: { fee_plan_id: null } });
  await StudentFeePlan.updateMany({ fee_plan_id: plan._id }, { $set: { fee_plan_id: null } });
}

const feePlansRouter = crudRouter({
  path: "/admin/fee-plans",
  Model: FeePlan,
  createSchema: FeePlanIn,
  updateSchema: FeePlanPatch,
  entity: "fee_plan",
  sort: [["status", 1], ["base_fee", 1], ["_id", 1]],
  searchFields: ["name"],
  filterFields: ["status"],
  onDelete: unlinkFeePlan,
});

// --- Student plans -------------------------------------------------------------------------------------------

const DISCOUNT_TYPE = /^(none|fixed|percent)$/;

const StudentPlanIn = z.object({
  fee_plan_id: nul(zId),
  name: nul(str({ max: 200 })),
  base_fee: nul(money({ ge: 0 })),
  sessions_included: nul(num({ int: true, ge: 1, le: 500 })),
  discount_type: pattern(DISCOUNT_TYPE).default("none"),
  discount_value: money({ ge: 0 }).default(0),
  start_date: zDate,
  end_date: nul(zDate),
  batch_id: nul(zId),
  notes: nul(str({ max: 1000 })),
  activate: bool().default(true),
});

/** Record a student-specific commercial agreement (custom price and/or discount, BR-05/06). */
router.post(
  "/admin/students/:student_id/plans",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(StudentPlanIn, req);
    const aid = req.academy._id;
    const student = await getOr404(StudentProfile, req.params.student_id, aid);
    const template = body.fee_plan_id ? await getOr404(FeePlan, body.fee_plan_id, aid) : null;
    if (body.batch_id) await getOr404(Batch, body.batch_id, aid);
    const name = body.name || (template ? template.name : null);
    const baseFee = body.base_fee !== null ? body.base_fee : template ? template.base_fee : null;
    const sessions = body.sessions_included || (template ? template.number_of_sessions : null);
    if (!name || baseFee === null || baseFee === undefined || !sessions) {
      throw new BusinessRuleError("Choose a fee plan or enter name, fee and number of sessions", 400);
    }
    let endDate = body.end_date;
    if (endDate === null && template && template.validity_days) endDate = addDays(body.start_date, template.validity_days - 1);
    const plan = ledger.buildPlan({
      academyId: aid,
      studentId: student._id,
      name,
      baseFee,
      sessionsIncluded: sessions,
      startDate: body.start_date,
      endDate,
      discountType: body.discount_type,
      discountValue: body.discount_value,
      feePlanId: template ? template._id : null,
      batchId: body.batch_id,
      notes: body.notes,
    });
    await plan.save();
    if (body.activate) await ledger.activatePlan(plan, req.principal.user._id);
    await log(
      req,
      "student_fee_plan",
      plan._id,
      "create",
      `Plan ${plan.name} for student ${sid(student)}: ${money2(plan.final_fee)}`,
      null,
      snapshot(plan),
    );
    res.status(201);
    return planOut(plan);
  }),
);

const PlanPatch = z.object({
  name: opt(str({ max: 200 })),
  base_fee: opt(money({ ge: 0 })),
  sessions_included: opt(num({ int: true, ge: 1, le: 500 })),
  discount_type: opt(pattern(DISCOUNT_TYPE)),
  discount_value: opt(money({ ge: 0 })),
  start_date: opt(zDate),
  end_date: opt(zDate),
  batch_id: opt(zId),
  notes: opt(str({ max: 1000 })),
});

router.patch(
  "/admin/plans/:plan_id",
  adminOnly,
  write(async (req) => {
    const data = parseBody(PlanPatch, req);
    const plan = await getOr404(StudentFeePlan, req.params.plan_id, req.academy._id);
    if (plan.status === "cancelled") throw new BusinessRuleError("Cancelled plans cannot be edited");
    const [old, neu] = applyUpdates(plan, data);
    if (plan.end_date && plan.start_date && plan.end_date < plan.start_date) {
      throw new BusinessRuleError("Plan end date is before its start date", 400);
    }
    ledger.repricePlan(plan);
    await plan.save();
    // Any fee change is posted to the ledger as a correction of the original charge.
    await ledger.syncPlanCharge(plan, req.principal.user._id);
    await ledger.syncPlanClose(plan, req.principal.user._id);
    await log(req, "student_fee_plan", plan._id, "update", `Updated plan ${plan.name}`, old, neu);
    return planOut(plan);
  }),
);

router.post(
  "/admin/plans/:plan_id/activate",
  adminOnly,
  write(async (req) => {
    const plan = await getOr404(StudentFeePlan, req.params.plan_id, req.academy._id);
    await ledger.activatePlan(plan, req.principal.user._id);
    await log(req, "student_fee_plan", plan._id, "activate", `Activated plan ${plan.name}`);
    return planOut(plan);
  }),
);

const CloseIn = z.object({ action: opt(pattern(/^(carry_forward|forfeit)$/)) });

router.post(
  "/admin/plans/:plan_id/close",
  adminOnly,
  write(async (req) => {
    const body = parseBody(CloseIn, req);
    const plan = await getOr404(StudentFeePlan, req.params.plan_id, req.academy._id);
    const action = body.action || req.rules.unused_sessions_on_close;
    await ledger.closePlan(plan, action, req.principal.user._id);
    await log(req, "student_fee_plan", plan._id, "close", `Closed plan ${plan.name} (${action})`);
    return planOut(plan);
  }),
);

router.post(
  "/admin/plans/:plan_id/cancel",
  adminOnly,
  write(async (req) => {
    const plan = await getOr404(StudentFeePlan, req.params.plan_id, req.academy._id);
    await ledger.cancelPlan(plan, req.principal.user._id);
    await log(req, "student_fee_plan", plan._id, "cancel", `Cancelled plan ${plan.name}`);
    return planOut(plan);
  }),
);

const PlansQuery = z.object({ status: opt(z.string()), ending_before: opt(zDate) });

/** Plans with their usage, soonest end date first (open-ended plans last). */
router.get(
  "/admin/plans",
  adminOnly,
  read(async (req) => {
    const qy = parseQuery(PlansQuery, req);
    const match = { academy_id: req.academy._id };
    if (qy.status) match.status = qy.status;
    if (qy.ending_before) match.end_date = { $lt: qy.ending_before };
    const total = await StudentFeePlan.countDocuments(match);
    const { page, pageSize, skip } = pageParams(req.query);
    const plans = await sortedPage(
      StudentFeePlan,
      match,
      [[{ $eq: [{ $ifNull: ["$end_date", null] }, null] }, 1], ["end_date", 1], ["_id", 1]],
      skip,
      pageSize,
    );
    const usage = await ledger.planUsage(plans);
    const items = [];
    for (const p of plans) items.push(await planOut(p, usage[sid(p)]));
    return pageOut(items, total, page, pageSize);
  }),
);

// --- Payments ------------------------------------------------------------------------------------------------

const PaymentsQuery = z.object({ status: opt(z.string()), student_id: opt(zId), start: opt(zDate), end: opt(zDate) });

router.get(
  "/admin/payments",
  adminOnly,
  read(async (req) => {
    const qy = parseQuery(PaymentsQuery, req);
    const match = { academy_id: req.academy._id };
    if (qy.status) match.status = qy.status;
    if (qy.student_id) match.student_id = oid(qy.student_id);
    if (qy.start || qy.end) {
      match.payment_date = {};
      if (qy.start) match.payment_date.$gte = qy.start;
      if (qy.end) match.payment_date.$lte = qy.end;
    }
    const total = await Payment.countDocuments(match);
    const { page, pageSize, skip } = pageParams(req.query);
    // Pending first, then newest.
    const rows = await sortedPage(
      Payment,
      match,
      [[{ $ne: ["$status", "pending"] }, 1], ["payment_date", -1], ["_id", -1]],
      skip,
      pageSize,
    );
    const items = [];
    for (const p of rows) items.push(await paymentOut(p));
    return pageOut(items, total, page, pageSize);
  }),
);

const AdminPaymentIn = z.object({
  student_id: zId,
  student_fee_plan_id: nul(zId),
  amount: money({ gt: 0 }),
  payment_date: nul(zDate),
  method: pattern(PAYMENT_METHOD).default("cash"),
  reference_no: nul(str({ max: 100 })),
  notes: nul(str({ max: 500 })),
  verified: bool().default(true),
});

router.post(
  "/admin/payments",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(AdminPaymentIn, req);
    const aid = req.academy._id;
    const student = await getOr404(StudentProfile, body.student_id, aid);
    if (body.student_fee_plan_id) {
      const plan = await getOr404(StudentFeePlan, body.student_fee_plan_id, aid);
      if (!sameId(plan.student_id, student._id)) throw new BusinessRuleError("That plan belongs to another student", 400);
    }
    const p = await Payment.create({
      academy_id: aid,
      student_id: student._id,
      student_fee_plan_id: body.student_fee_plan_id,
      amount: body.amount,
      payment_date: body.payment_date || today(),
      method: body.method,
      reference_no: body.reference_no,
      notes: body.notes,
      status: "pending",
      submitted_by_id: req.principal.user._id,
    });
    if (body.verified) await ledger.verifyPayment(p, req.principal.user._id);
    await log(req, "payment", p._id, "record", `Recorded ${body.method} payment ${body.amount}`, null, snapshot(p));
    res.status(201);
    return paymentOut(p);
  }),
);

/** Admin verification (BR-11): confirms the linked plan and its pending enrollment. */
router.post(
  "/admin/payments/:payment_id/verify",
  adminOnly,
  write(async (req) => {
    const p = await getOr404(Payment, req.params.payment_id, req.academy._id);
    await ledger.verifyPayment(p, req.principal.user._id);
    await log(req, "payment", p._id, "verify", `Verified payment ${money2(p.amount)} (${pyStr(p.reference_no)})`);
    return paymentOut(p);
  }),
);

const RejectIn = z.object({ reason: str({ min: 3, max: 300 }) });

router.post(
  "/admin/payments/:payment_id/reject",
  adminOnly,
  write(async (req) => {
    const body = parseBody(RejectIn, req);
    const p = await getOr404(Payment, req.params.payment_id, req.academy._id);
    const was = p.status;
    await ledger.rejectPayment(p, body.reason, req.principal.user._id);
    await log(req, "payment", p._id, "reject", `Rejected payment ${money2(p.amount)} (was ${was}): ${body.reason}`);
    return paymentOut(p);
  }),
);

// --- Ledger adjustments and refunds ---------------------------------------------------------------------------

const AdjustmentIn = z.object({
  // Positive = credit to the student, negative = amount owed.
  amount: money(),
  description: str({ min: 3, max: 300 }),
  txn_date: nul(zDate),
  kind: pattern(/^(adjustment|opening_balance)$/).default("adjustment"),
});

router.post(
  "/admin/students/:student_id/adjustments",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(AdjustmentIn, req);
    const student = await getOr404(StudentProfile, req.params.student_id, req.academy._id);
    if (body.amount === 0) throw new BusinessRuleError("Amount cannot be zero", 400);
    const t = await ledger.post({
      academyId: req.academy._id,
      studentId: student._id,
      txnType: body.kind,
      amount: body.amount,
      description: body.description,
      txnDate: body.txn_date,
      referenceType: "manual",
      createdById: req.principal.user._id,
    });
    await log(req, "ledger_transaction", t._id, body.kind, `${body.amount}: ${body.description}`, null, snapshot(t));
    res.status(201);
    return toJSON(t);
  }),
);

const RefundIn = z.object({
  amount: money({ gt: 0 }),
  refund_date: nul(zDate),
  method: pattern(PAYMENT_METHOD).default("upi"),
  reference_no: nul(str({ max: 100 })),
  description: nul(str({ max: 300 })),
});

/** Money paid back to a student (reduces the credit they hold). */
router.post(
  "/admin/students/:student_id/refunds",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(RefundIn, req);
    const student = await getOr404(StudentProfile, req.params.student_id, req.academy._id);
    const desc = `${body.description || "Refund paid"} (${body.method.toUpperCase()}${body.reference_no ? ` ${body.reference_no}` : ""})`;
    const t = await ledger.post({
      academyId: req.academy._id,
      studentId: student._id,
      txnType: "refund",
      amount: -body.amount,
      description: desc,
      txnDate: body.refund_date,
      referenceType: "refund",
      createdById: req.principal.user._id,
    });
    await log(req, "ledger_transaction", t._id, "refund", `Refund ${body.amount}`, null, snapshot(t));
    res.status(201);
    return toJSON(t);
  }),
);

const LedgerQuery = z.object({ start: opt(zDate), end: opt(zDate) });

router.get(
  "/admin/students/:student_id/ledger",
  adminOnly,
  read(async (req) => {
    const qy = parseQuery(LedgerQuery, req);
    const student = await getOr404(StudentProfile, req.params.student_id, req.academy._id);
    const { entries, ...rest } = await ledger.statement(student._id, qy.start ?? null, qy.end ?? null);
    return { ...rest, entries: toJSON(entries) };
  }),
);

// --- Coach and venue payouts ---------------------------------------------------------------------------------

const payoutFields = {
  month: pattern(/^\d{4}-\d{2}$/),
  amount: money({ gt: 0 }),
  paid_on: nul(zDate),
  method: pattern(PAYMENT_METHOD).default("bank_transfer"),
  reference_no: nul(str({ max: 100 })),
  notes: nul(str({ max: 300 })),
};
const CoachPayoutIn = z.object({ ...payoutFields, coach_id: zId });
const VenuePayoutIn = z.object({ ...payoutFields, venue_id: zId });
const MonthQuery = z.object({ month: opt(z.string()) });

/** Payout records of a month with the payee's name (records whose payee no longer exists are skipped). */
async function payoutsOf(PayoutModel, PayeeModel, key, academyId, periodMonth) {
  const payments = await PayoutModel.find({ academy_id: academyId, period_month: periodMonth }).sort({ paid_on: 1, _id: 1 });
  const payees = await PayeeModel.find({ _id: { $in: payments.map((p) => p[key]) } }).select("name");
  const names = new Map(payees.map((x) => [sid(x), x.name]));
  return payments.filter((p) => names.has(sid(p[key]))).map((p) => [p, names.get(sid(p[key]))]);
}

router.get(
  "/admin/payouts/coaches",
  adminOnly,
  read(async (req) => {
    const { month } = parseQuery(MonthQuery, req);
    const [s, e] = reportPeriod(null, null, month);
    const [summary, detail] = await finance.coachReport(req.academy._id, s, e);
    const payments = await payoutsOf(CoachPayment, User, "coach_id", req.academy._id, s);
    // Coaches who were paid this month but coached nothing still appear.
    const listed = new Set(summary.map((r) => String(r.coach_id)));
    for (const [p, name] of payments) {
      if (!listed.has(sid(p.coach_id))) {
        listed.add(sid(p.coach_id));
        summary.push({
          coach_id: sid(p.coach_id),
          coach: name,
          sessions: 0,
          hours: 0,
          payable: 0,
          paid: p.amount,
          balance: q(0 - p.amount),
          status: "paid",
        });
      }
    }
    return {
      period: { start: s, end: e, month: s.slice(0, 7) },
      summary,
      detail,
      payments: payments.map(([p, name]) => ({ ...toJSON(p), coach: name })),
    };
  }),
);

router.post(
  "/admin/payouts/coaches",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(CoachPayoutIn, req);
    await getOr404(CoachProfile, body.coach_id, req.academy._id);
    const [s] = reportPeriod(null, null, body.month);
    const p = await CoachPayment.create({
      academy_id: req.academy._id,
      coach_id: body.coach_id,
      period_month: s,
      amount: body.amount,
      paid_on: body.paid_on || today(),
      method: body.method,
      reference_no: body.reference_no,
      notes: body.notes,
      created_by_id: req.principal.user._id,
    });
    await log(req, "coach_payment", p._id, "create", `Paid coach ${body.coach_id} ${body.amount} for ${body.month}`, null, snapshot(p));
    res.status(201);
    return toJSON(p);
  }),
);

router.delete(
  "/admin/payouts/coaches/:payment_id",
  adminOnly,
  write(async (req) => {
    const p = await getOr404(CoachPayment, req.params.payment_id, req.academy._id);
    await log(req, "coach_payment", p._id, "delete", "Deleted coach payment", snapshot(p));
    await p.deleteOne();
  }),
);

router.get(
  "/admin/payouts/venues",
  adminOnly,
  read(async (req) => {
    const { month } = parseQuery(MonthQuery, req);
    const [s, e] = reportPeriod(null, null, month);
    const [summary, detail] = await finance.venueReport(req.academy._id, s, e);
    const payments = await payoutsOf(VenuePayment, Venue, "venue_id", req.academy._id, s);
    const listed = new Set(summary.map((r) => String(r.venue_id)));
    for (const [p, name] of payments) {
      if (!listed.has(sid(p.venue_id))) {
        listed.add(sid(p.venue_id));
        summary.push({
          venue_id: sid(p.venue_id),
          venue: name,
          sessions: 0,
          hours_booked: 0,
          court_hours: 0,
          payable: 0,
          paid: p.amount,
          balance: q(0 - p.amount),
          status: "paid",
        });
      }
    }
    return {
      period: { start: s, end: e, month: s.slice(0, 7) },
      summary,
      detail,
      payments: payments.map(([p, name]) => ({ ...toJSON(p), venue: name })),
    };
  }),
);

router.post(
  "/admin/payouts/venues",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(VenuePayoutIn, req);
    await getOr404(Venue, body.venue_id, req.academy._id);
    const [s] = reportPeriod(null, null, body.month);
    const p = await VenuePayment.create({
      academy_id: req.academy._id,
      venue_id: body.venue_id,
      period_month: s,
      amount: body.amount,
      paid_on: body.paid_on || today(),
      method: body.method,
      reference_no: body.reference_no,
      notes: body.notes,
      created_by_id: req.principal.user._id,
    });
    await log(req, "venue_payment", p._id, "create", `Paid venue ${body.venue_id} ${body.amount} for ${body.month}`, null, snapshot(p));
    res.status(201);
    return toJSON(p);
  }),
);

router.delete(
  "/admin/payouts/venues/:payment_id",
  adminOnly,
  write(async (req) => {
    const p = await getOr404(VenuePayment, req.params.payment_id, req.academy._id);
    await log(req, "venue_payment", p._id, "delete", "Deleted venue payment", snapshot(p));
    await p.deleteOne();
  }),
);

// --- Expenses ------------------------------------------------------------------------------------------------

const EXPENSE_CATEGORY = /^(equipment|marketing|staff|rent|utilities|travel|tournament|maintenance|software|other)$/;

const ExpenseIn = z.object({
  category: pattern(EXPENSE_CATEGORY),
  description: str({ min: 2, max: 300 }),
  vendor: nul(str({ max: 200 })),
  amount: money({ gt: 0 }),
  expense_date: zDate,
  is_paid: bool().default(true),
  paid_on: nul(zDate),
  venue_id: nul(zId),
  batch_id: nul(zId),
  reference_no: nul(str({ max: 100 })),
});

const ExpensePatch = z.object({
  category: opt(pattern(EXPENSE_CATEGORY)),
  description: opt(str({ min: 2, max: 300 })),
  vendor: opt(str({ max: 200 })),
  amount: opt(money({ gt: 0 })),
  expense_date: opt(zDate),
  is_paid: opt(bool()),
  paid_on: opt(zDate),
  venue_id: opt(zId),
  batch_id: opt(zId),
  reference_no: opt(str({ max: 100 })),
});

async function expenseOut(e) {
  const venue = e.venue_id ? await Venue.findById(e.venue_id).select("name") : null;
  const batch = e.batch_id ? await Batch.findById(e.batch_id).select("name") : null;
  return { ...toJSON(e), venue_name: venue ? venue.name : null, batch_name: batch ? batch.name : null };
}

const expensesRouter = crudRouter({
  path: "/admin/expenses",
  Model: Expense,
  createSchema: ExpenseIn,
  updateSchema: ExpensePatch,
  entity: "expense",
  sort: [["expense_date", -1], ["_id", -1]],
  searchFields: ["description", "vendor"],
  filterFields: ["category", "is_paid", "venue_id", "batch_id"],
  serialize: expenseOut,
});

/** Items awaiting admin action on the finance screen. */
router.get(
  "/admin/finance/pending",
  adminOnly,
  read(async (req) => {
    const aid = req.academy._id;
    const pending = await Payment.find({ academy_id: aid, status: "pending" }).sort({ created_at: 1, _id: 1 });
    const ended = await StudentFeePlan.find({ academy_id: aid, status: "active", end_date: { $lt: today() } })
      .sort({ end_date: 1, _id: 1 })
      .limit(100);
    const usage = await ledger.planUsage(ended);
    const payments = [];
    for (const p of pending) payments.push(await paymentOut(p));
    const plans = [];
    for (const p of ended) plans.push(await planOut(p, usage[sid(p)]));
    return { payments, plans_to_close: plans };
  }),
);

router.use(feePlansRouter);
router.use(expensesRouter);

export default router;
