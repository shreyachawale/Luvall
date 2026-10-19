import mongoose from "mongoose";

import { ObjectId, TIMESTAMPS, schema } from "./plugins.js";

/** Reusable package / fee template (e.g. "8 sessions / month"). */
const feePlanSchema = schema(
  {
    academy_id: { type: ObjectId, ref: "Academy", required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: null },
    plan_type: { type: String, enum: ["monthly", "package", "per_session"], default: "monthly" },
    number_of_sessions: { type: Number, required: true },
    base_fee: { type: Number, required: true },
    validity_days: { type: Number, default: null },
    is_public: { type: Boolean, default: true },
    status: { type: String, default: "active" },
  },
  { timestamps: TIMESTAMPS },
);
export const FeePlan = mongoose.model("FeePlan", feePlanSchema, "fee_plans");

export const PLAN_STATUSES = ["pending", "active", "completed", "cancelled"];
export const DISCOUNT_TYPES = ["none", "fixed", "percent"];

/** The actual commercial agreement with a student (BR-05, BR-06, BR-07). */
const studentFeePlanSchema = schema(
  {
    academy_id: { type: ObjectId, ref: "Academy", required: true, index: true },
    student_id: { type: ObjectId, ref: "User", required: true, index: true },
    fee_plan_id: { type: ObjectId, ref: "FeePlan", default: null },
    batch_id: { type: ObjectId, ref: "Batch", default: null, index: true },
    batch_student_id: { type: ObjectId, ref: "BatchStudent", default: null, index: true },
    name: { type: String, required: true },
    base_fee: { type: Number, required: true },
    discount_type: { type: String, enum: DISCOUNT_TYPES, default: "none" },
    discount_value: { type: Number, default: 0 },
    final_fee: { type: Number, required: true },
    sessions_included: { type: Number, required: true },
    per_session_value: { type: Number, required: true },
    start_date: { type: String, required: true },
    end_date: { type: String, default: null },
    status: { type: String, enum: PLAN_STATUSES, default: "pending", index: true },
    activated_at: { type: Date, default: null },
    closed_at: { type: Date, default: null },
    // carry_forward | forfeit: what happened to unused sessions when the plan was closed.
    closing_action: { type: String, default: null },
    notes: { type: String, default: null },
  },
  { timestamps: TIMESTAMPS },
);
export const StudentFeePlan = mongoose.model("StudentFeePlan", studentFeePlanSchema, "student_fee_plans");

export const PAYMENT_STATUSES = ["pending", "verified", "rejected"];
export const PAYMENT_METHODS = ["upi", "cash", "bank_transfer", "other"];

const paymentSchema = schema(
  {
    academy_id: { type: ObjectId, ref: "Academy", required: true, index: true },
    student_id: { type: ObjectId, ref: "User", required: true, index: true },
    student_fee_plan_id: { type: ObjectId, ref: "StudentFeePlan", default: null, index: true },
    amount: { type: Number, required: true },
    payment_date: { type: String, required: true, index: true },
    method: { type: String, enum: PAYMENT_METHODS, default: "upi" },
    reference_no: { type: String, default: null },
    proof_url: { type: String, default: null },
    status: { type: String, enum: PAYMENT_STATUSES, default: "pending", index: true },
    submitted_by_id: { type: ObjectId, ref: "User", default: null },
    verified_by_id: { type: ObjectId, ref: "User", default: null },
    verified_at: { type: Date, default: null },
    rejection_reason: { type: String, default: null },
    notes: { type: String, default: null },
  },
  { timestamps: TIMESTAMPS },
);
export const Payment = mongoose.model("Payment", paymentSchema, "payments");

// Signed amounts: positive is in the student's favour (credit), negative is owed by the student (debit).
export const LEDGER_TYPES = [
  "opening_balance", // migrated balance (±)
  "charge", // fee plan billed (−)
  "drop_in_charge", // drop-in fee for an extra attendee (−)
  "payment", // verified cash receipt (+)
  "cancellation_credit", // value of a cancelled session under the refund policy (+)
  "carry_forward", // unused package sessions carried forward when a plan is closed (+)
  "refund", // money paid back to the student (−)
  "adjustment", // manual admin adjustment (±)
];

/** Append-only student ledger. Entries are never edited; corrections post a new entry for the difference. */
const ledgerSchema = schema({
  academy_id: { type: ObjectId, ref: "Academy", required: true },
  student_id: { type: ObjectId, ref: "User", required: true },
  txn_type: { type: String, enum: LEDGER_TYPES, required: true },
  amount: { type: Number, required: true },
  txn_date: { type: String, required: true },
  description: { type: String, required: true },
  reference_type: { type: String, default: null },
  reference_id: { type: ObjectId, default: null },
  batch_id: { type: ObjectId, ref: "Batch", default: null },
  student_fee_plan_id: { type: ObjectId, ref: "StudentFeePlan", default: null },
  reversal_of_id: { type: ObjectId, ref: "LedgerTransaction", default: null },
  created_by_id: { type: ObjectId, ref: "User", default: null },
  created_at: { type: Date, default: () => new Date() },
});
ledgerSchema.index({ reference_type: 1, reference_id: 1 });
ledgerSchema.index({ student_id: 1, txn_date: 1 });
ledgerSchema.index({ academy_id: 1, txn_date: 1, txn_type: 1 });
ledgerSchema.index({ batch_id: 1, txn_date: 1 });
export const LedgerTransaction = mongoose.model("LedgerTransaction", ledgerSchema, "ledger_transactions");

const payoutFields = {
  academy_id: { type: ObjectId, ref: "Academy", required: true, index: true },
  period_month: { type: String, required: true, index: true }, // first day of the month "YYYY-MM-01"
  amount: { type: Number, required: true },
  paid_on: { type: String, required: true },
  method: { type: String, enum: PAYMENT_METHODS, default: "bank_transfer" },
  reference_no: { type: String, default: null },
  notes: { type: String, default: null },
  created_by_id: { type: ObjectId, ref: "User", default: null },
};

/** Money paid to a coach against a month's payable. */
export const CoachPayment = mongoose.model(
  "CoachPayment",
  schema({ ...payoutFields, coach_id: { type: ObjectId, ref: "User", required: true, index: true } }, { timestamps: TIMESTAMPS }),
  "coach_payments",
);

/** Money paid to a venue against a month's court payable. */
export const VenuePayment = mongoose.model(
  "VenuePayment",
  schema({ ...payoutFields, venue_id: { type: ObjectId, ref: "Venue", required: true, index: true } }, { timestamps: TIMESTAMPS }),
  "venue_payments",
);

export const EXPENSE_CATEGORIES = ["equipment", "marketing", "staff", "rent", "utilities", "travel", "tournament", "maintenance", "software", "other"];

/** Other manually recorded operating expenses. */
const expenseSchema = schema(
  {
    academy_id: { type: ObjectId, ref: "Academy", required: true, index: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    description: { type: String, required: true },
    vendor: { type: String, default: null },
    amount: { type: Number, required: true },
    expense_date: { type: String, required: true, index: true },
    is_paid: { type: Boolean, default: true },
    paid_on: { type: String, default: null },
    venue_id: { type: ObjectId, ref: "Venue", default: null },
    batch_id: { type: ObjectId, ref: "Batch", default: null },
    reference_no: { type: String, default: null },
    created_by_id: { type: ObjectId, ref: "User", default: null },
  },
  { timestamps: TIMESTAMPS },
);
export const Expense = mongoose.model("Expense", expenseSchema, "expenses");
