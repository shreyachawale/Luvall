/**
 * Student ledger, fee plans and payments.
 *
 * Ledger amounts are signed from the student's point of view: positive = credit in the student's favour,
 * negative = amount owed. The ledger is append-only: a correction posts a new entry of the same type for the
 * difference, so totals per type always net out correctly and the history stays traceable.
 */
import {
  BatchStudent,
  LedgerTransaction,
  oid,
  sameId,
  SessionAttendance,
  sid,
  StudentFeePlan,
} from "../models/index.js";
import { now, today } from "../utils/clock.js";
import { addDays, maxDate, minDate } from "../utils/dates.js";
import { BusinessRuleError } from "../utils/errors.js";
import { finalFee, perSessionValue, q } from "../utils/money.js";

/** Append one ledger entry. */
export async function post({
  academyId,
  studentId,
  txnType,
  amount,
  description,
  txnDate = null,
  referenceType = null,
  referenceId = null,
  batchId = null,
  studentFeePlanId = null,
  reversalOfId = null,
  createdById = null,
}) {
  return LedgerTransaction.create({
    academy_id: academyId,
    student_id: studentId,
    txn_type: txnType,
    amount: q(amount),
    txn_date: txnDate || today(),
    description: String(description).slice(0, 300),
    reference_type: referenceType,
    reference_id: referenceId ?? null,
    batch_id: batchId ?? null,
    student_fee_plan_id: studentFeePlanId ?? null,
    reversal_of_id: reversalOfId ?? null,
    created_by_id: createdById ?? null,
  });
}

async function sumAmount(match) {
  const [row] = await LedgerTransaction.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
  return q(row?.total ?? 0);
}

/** Net ledger total posted for one source record. */
export async function referenceNet(referenceType, referenceId) {
  return sumAmount({ reference_type: referenceType, reference_id: oid(referenceId) });
}

/**
 * Make the ledger total for one source record equal `desired`, posting only the difference.
 *
 * This is what prevents double charging when attendance, a plan or a payment is edited repeatedly.
 * Returns the posted entry, or null when nothing had to change.
 */
export async function syncReference({
  academyId,
  studentId,
  referenceType,
  referenceId,
  desired,
  txnType,
  description,
  txnDate,
  batchId = null,
  studentFeePlanId = null,
  createdById = null,
}) {
  const current = await referenceNet(referenceType, referenceId);
  const target = q(desired);
  const difference = q(target - current);
  if (difference === 0) return null;
  let type = txnType;
  let text = description;
  if (current !== 0) {
    const last = await LedgerTransaction.findOne({ reference_type: referenceType, reference_id: oid(referenceId) })
      .sort({ _id: -1 })
      .select("txn_type");
    if (target === 0) {
      type = last?.txn_type || txnType;
      text = `Reversal: ${description}`;
    } else {
      text = `Correction: ${description}`;
    }
  }
  return post({
    academyId,
    studentId,
    txnType: type,
    amount: difference,
    description: text,
    txnDate,
    referenceType,
    referenceId,
    batchId,
    studentFeePlanId,
    createdById,
  });
}

/** A student's balance (optionally as of a date). */
export async function balance(studentId, asOf = null) {
  const match = { student_id: oid(studentId) };
  if (asOf) match.txn_date = { $lte: asOf };
  return sumAmount(match);
}

/** Every student's balance in the academy: { [studentId]: amount }. */
export async function balances(academyId) {
  const rows = await LedgerTransaction.aggregate([
    { $match: { academy_id: oid(academyId) } },
    { $group: { _id: "$student_id", total: { $sum: "$amount" } } },
    { $sort: { _id: 1 } },
  ]);
  const out = {};
  for (const r of rows) out[String(r._id)] = q(r.total);
  return out;
}

export const CHARGE_TYPES = ["charge", "drop_in_charge"];
export const CREDIT_TYPES = ["cancellation_credit", "carry_forward"];

/**
 * Opening balance, period movements by category and closing balance (brief section 7).
 * Returns { opening_balance, charges, payments, credits, refunds, adjustments, closing_balance, entries }.
 */
export async function statement(studentId, start = null, end = null) {
  let opening = 0;
  if (start) opening = await sumAmount({ student_id: oid(studentId), txn_date: { $lt: start } });
  const filter = { student_id: studentId };
  if (start || end) {
    filter.txn_date = {};
    if (start) filter.txn_date.$gte = start;
    if (end) filter.txn_date.$lte = end;
  }
  const entries = await LedgerTransaction.find(filter).sort({ txn_date: 1, _id: 1 });
  const totals = {};
  let movement = 0;
  for (const e of entries) {
    totals[e.txn_type] = q((totals[e.txn_type] ?? 0) + e.amount);
    movement = q(movement + e.amount);
  }
  const get = (t) => totals[t] ?? 0;
  const charges = q(CHARGE_TYPES.reduce((acc, t) => acc + get(t), 0));
  const credits = q(CREDIT_TYPES.reduce((acc, t) => acc + get(t), 0));
  return {
    opening_balance: q(opening),
    charges: q(0 - charges),
    payments: q(get("payment")),
    credits,
    refunds: q(0 - get("refund")),
    adjustments: q(get("adjustment") + get("opening_balance")),
    closing_balance: q(opening + movement),
    entries,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Fee plans

/**
 * Package usage derived from attendance rows, never from stored counters (BR-15).
 * Returns { [planId]: { sessions_included, used, refunded, carried_forward, makeups_attended, remaining } }.
 */
export async function planUsage(plans) {
  const counts = {};
  for (const p of plans) counts[sid(p)] = {};
  if (plans.length) {
    const rows = await SessionAttendance.aggregate([
      { $match: { student_fee_plan_id: { $in: plans.map((p) => oid(p._id)) } } },
      { $group: { _id: { plan: "$student_fee_plan_id", mode: "$billing_mode" }, n: { $sum: 1 } } },
    ]);
    for (const r of rows) counts[String(r._id.plan)][r._id.mode] = r.n;
  }
  const result = {};
  for (const p of plans) {
    const c = counts[sid(p)];
    const used = c.package ?? 0;
    const refunded = c.refunded ?? 0;
    result[sid(p)] = {
      sessions_included: p.sessions_included,
      used,
      refunded,
      carried_forward: c.carried_forward ?? 0,
      makeups_attended: c.makeup ?? 0,
      remaining: p.sessions_included - used - refunded,
    };
  }
  return result;
}

/** A new (unsaved, pending) StudentFeePlan with the discount applied (BR-06, BR-07). The caller saves it. */
export function buildPlan({
  academyId,
  studentId,
  name,
  baseFee,
  sessionsIncluded,
  startDate,
  endDate = null,
  discountType = "none",
  discountValue = 0,
  feePlanId = null,
  batchId = null,
  batchStudentId = null,
  notes = null,
}) {
  if (!(sessionsIncluded > 0)) throw new BusinessRuleError("A plan must include at least one session", 400);
  if (endDate && endDate < startDate) throw new BusinessRuleError("Plan end date is before its start date", 400);
  const fee = finalFee(baseFee, discountType, discountValue);
  return new StudentFeePlan({
    academy_id: academyId,
    student_id: studentId,
    fee_plan_id: feePlanId ?? null,
    batch_id: batchId ?? null,
    batch_student_id: batchStudentId ?? null,
    name,
    base_fee: q(baseFee),
    discount_type: discountType,
    discount_value: q(discountValue),
    final_fee: fee,
    sessions_included: sessionsIncluded,
    per_session_value: perSessionValue(fee, sessionsIncluded),
    start_date: startDate,
    end_date: endDate ?? null,
    status: "pending",
    notes: notes ?? null,
  });
}

/** Recompute final fee and per-session value after an edit (mutates the plan; the caller saves it). */
export function repricePlan(plan) {
  plan.final_fee = finalFee(plan.base_fee, plan.discount_type, plan.discount_value);
  plan.per_session_value = perSessionValue(plan.final_fee, plan.sessions_included);
}

/** The plan's fee is billed while it is active/completed; cancelling it reverses the charge. */
export async function syncPlanCharge(plan, actorId) {
  const billed = plan.status === "active" || plan.status === "completed";
  const discount = plan.discount_type !== "none" ? ` (discount ${plan.discount_type} ${q(plan.discount_value).toFixed(2)})` : "";
  return syncReference({
    academyId: plan.academy_id,
    studentId: plan.student_id,
    referenceType: "student_fee_plan",
    referenceId: plan._id,
    desired: billed ? q(0 - plan.final_fee) : 0,
    txnType: "charge",
    description: `Fee: ${plan.name}${discount}`,
    txnDate: plan.start_date,
    batchId: plan.batch_id,
    studentFeePlanId: plan._id,
    createdById: actorId,
  });
}

export async function activatePlan(plan, actorId) {
  if (plan.status === "cancelled") throw new BusinessRuleError("This plan was cancelled");
  if (plan.status === "pending") {
    plan.status = "active";
    plan.activated_at = now();
  }
  await plan.save();
  await syncPlanCharge(plan, actorId);
}

export async function cancelPlan(plan, actorId) {
  plan.status = "cancelled";
  // Attendance can no longer draw on a cancelled plan; it shows up as unbilled for the admin to resolve.
  await SessionAttendance.updateMany({ student_fee_plan_id: plan._id }, { $set: { student_fee_plan_id: null } });
  await plan.save();
  await syncPlanCharge(plan, actorId);
  await syncPlanClose(plan, actorId);
}

/** Credit unused sessions of a plan closed with carry_forward (reversed if the plan is reopened/changed). */
export async function syncPlanClose(plan, actorId) {
  let desired = 0;
  if (plan.status === "completed" && plan.closing_action === "carry_forward") {
    const usage = (await planUsage([plan]))[sid(plan)];
    if (usage.remaining > 0) desired = q(plan.per_session_value * usage.remaining);
  }
  const t = today();
  return syncReference({
    academyId: plan.academy_id,
    studentId: plan.student_id,
    referenceType: "student_fee_plan_close",
    referenceId: plan._id,
    desired,
    txnType: "carry_forward",
    description: `Unused sessions carried forward from ${plan.name}`,
    txnDate: minDate(plan.end_date || t, t),
    batchId: plan.batch_id,
    studentFeePlanId: plan._id,
    createdById: actorId,
  });
}

/** Close a plan; unused sessions are carried forward as account credit or forfeited. */
export async function closePlan(plan, action, actorId) {
  if (plan.status !== "active" && plan.status !== "completed") throw new BusinessRuleError("Only active plans can be closed");
  plan.status = "completed";
  plan.closing_action = action;
  plan.closed_at = now();
  await plan.save();
  await syncPlanClose(plan, actorId);
}

const STATUS_RANK = { active: 0, pending: 1, completed: 2 };

/** The plan an attendance on `on` draws from: batch-specific first, then a general plan. */
export async function findPlanFor(studentId, batchId, on) {
  const plans = await StudentFeePlan.find({
    student_id: studentId,
    status: { $in: ["active", "pending", "completed"] },
    start_date: { $lte: on },
    $or: [{ end_date: null }, { end_date: { $gte: on } }],
  }).sort({ _id: 1 });
  const hasBatch = batchId !== null && batchId !== undefined;
  const rank = (p) => {
    let batchRank = 2;
    if (hasBatch && sameId(p.batch_id, batchId)) batchRank = 0;
    else if (p.batch_id === null || p.batch_id === undefined) batchRank = 1;
    return [batchRank, STATUS_RANK[p.status]];
  };
  const better = (a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    if (ra[0] !== rb[0]) return ra[0] < rb[0];
    if (ra[1] !== rb[1]) return ra[1] < rb[1];
    return a.start_date > b.start_date; // latest start first
  };
  const candidates = plans.filter((p) => !hasBatch || p.batch_id === null || p.batch_id === undefined || sameId(p.batch_id, batchId));
  let best = null;
  for (const p of candidates) if (!best || better(p, best)) best = p;
  return best;
}

/** Create (and save) a pending StudentFeePlan from a FeePlan template; validity_days sets the end date. */
export async function planFromTemplate({
  academyId,
  studentId,
  feePlan,
  startDate,
  endDate = null,
  batchId = null,
  batchStudentId = null,
  discountType = "none",
  discountValue = 0,
}) {
  let end = endDate ?? null;
  if (end === null && feePlan.validity_days) end = addDays(startDate, feePlan.validity_days - 1);
  const plan = buildPlan({
    academyId,
    studentId,
    name: feePlan.name,
    baseFee: feePlan.base_fee,
    sessionsIncluded: feePlan.number_of_sessions,
    startDate,
    endDate: end,
    discountType,
    discountValue,
    feePlanId: feePlan._id,
    batchId,
    batchStudentId,
  });
  await plan.save();
  return plan;
}

// ---------------------------------------------------------------------------------------------------------
// Payments

/** Post (or reverse) a payment's cash in the ledger according to its status. */
export async function syncPayment(payment, actorId) {
  const plan = payment.student_fee_plan_id ? await StudentFeePlan.findById(payment.student_fee_plan_id) : null;
  const ref = payment.reference_no ? ` ${payment.reference_no}` : "";
  return syncReference({
    academyId: payment.academy_id,
    studentId: payment.student_id,
    referenceType: "payment",
    referenceId: payment._id,
    desired: payment.status === "verified" ? payment.amount : 0,
    txnType: "payment",
    description: `Payment received (${String(payment.method).toUpperCase()}${ref})`,
    txnDate: payment.payment_date,
    batchId: plan ? plan.batch_id : null,
    studentFeePlanId: payment.student_fee_plan_id,
    createdById: actorId,
  });
}

/**
 * Admin verification (BR-11). Verifying confirms the linked plan and its pending enrollment.
 * The plan and enrollment are loaded and saved here; re-read them if you hold copies.
 */
export async function verifyPayment(payment, actorId) {
  if (payment.status === "verified") return;
  payment.status = "verified";
  payment.verified_by_id = actorId;
  payment.verified_at = now();
  payment.rejection_reason = null;
  await payment.save();
  await syncPayment(payment, actorId);
  if (payment.student_fee_plan_id) {
    const plan = await StudentFeePlan.findById(payment.student_fee_plan_id);
    if (plan && plan.status === "pending") {
      await activatePlan(plan, actorId);
      if (plan.batch_student_id) {
        const enrollment = await BatchStudent.findById(plan.batch_student_id);
        if (enrollment && enrollment.status === "pending") {
          enrollment.status = "active";
          enrollment.joined_on = enrollment.joined_on || maxDate(plan.start_date, today());
          await enrollment.save();
        }
      }
    }
  }
}

export async function rejectPayment(payment, reason, actorId) {
  payment.status = "rejected";
  payment.rejection_reason = reason ?? null;
  payment.verified_by_id = actorId;
  payment.verified_at = now();
  await payment.save();
  await syncPayment(payment, actorId);
}
