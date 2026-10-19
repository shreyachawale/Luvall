import mongoose from "mongoose";

import { ObjectId, TIMESTAMPS, schema } from "./plugins.js";

export const SESSION_STATUSES = ["scheduled", "completed", "cancelled"];
export const CANCELLATION_ADJUSTMENTS = ["refund", "carry_forward", "no_adjustment"];

/** Actual coach participation; supports one or two coaches per session (FR-018). */
const sessionCoachSchema = schema({
  coach_id: { type: ObjectId, ref: "User", required: true },
  scheduled_hours: { type: Number, required: true },
  hours_coached: { type: Number, default: null },
  rate_applied: { type: Number, default: null },
  adjustment_amount: { type: Number, default: 0 },
  adjustment_note: { type: String, default: null },
  payable_amount: { type: Number, default: null },
});

/** A concrete occurrence of a batch class. */
const sessionSchema = schema(
  {
    academy_id: { type: ObjectId, ref: "Academy", required: true },
    batch_id: { type: ObjectId, ref: "Batch", required: true, index: true },
    schedule_id: { type: ObjectId, default: null },
    session_date: { type: String, required: true },
    start_time: { type: String, required: true },
    end_time: { type: String, required: true },
    duration_minutes: { type: Number, required: true },
    venue_id: { type: ObjectId, ref: "Venue", required: true, index: true },
    courts_booked: { type: Number, default: 1 },
    // scheduled -> completed | cancelled (FR-011)
    status: { type: String, enum: SESSION_STATUSES, default: "scheduled", index: true },
    cancellation_reason: { type: String, default: null },
    // refund | carry_forward | no_adjustment (FR-016)
    cancellation_adjustment: { type: String, enum: [...CANCELLATION_ADJUSTMENTS, null], default: null },
    venue_charge_applies: { type: Boolean, default: true },
    // Snapshots taken when the session is recorded so rate changes never alter history.
    day_type: { type: String, default: null },
    time_slot: { type: String, default: null },
    venue_rate_applied: { type: Number, default: null },
    court_payable: { type: Number, default: null },
    remarks: { type: String, default: null },
    recorded_by_id: { type: ObjectId, ref: "User", default: null },
    recorded_at: { type: Date, default: null },
    coaches: { type: [sessionCoachSchema], default: [] },
  },
  { timestamps: TIMESTAMPS },
);
sessionSchema.index({ batch_id: 1, session_date: 1, start_time: 1 }, { unique: true });
sessionSchema.index({ academy_id: 1, session_date: 1 });
sessionSchema.index({ "coaches.coach_id": 1, session_date: 1 });

export const Session = mongoose.model("Session", sessionSchema, "sessions");

export const ATTENDANCE_STATUSES = ["present", "absent", "session_cancelled"];
export const ATTENDEE_TYPES = ["regular", "makeup", "drop_in", "other"];
// package: consumes one package session; makeup: uses a make-up credit; drop_in: charged the drop-in fee;
// complimentary: no charge; carried_forward / refunded: outcome for a cancelled session.
export const BILLING_MODES = ["package", "makeup", "drop_in", "complimentary", "carried_forward", "refunded", "none"];

const attendanceSchema = schema(
  {
    session_id: { type: ObjectId, ref: "Session", required: true, index: true },
    student_id: { type: ObjectId, ref: "User", required: true, index: true },
    // Denormalised from the session for reporting (a session's date never changes once it has attendance).
    academy_id: { type: ObjectId, ref: "Academy", required: true },
    session_date: { type: String, required: true },
    original_batch_id: { type: ObjectId, ref: "Batch", default: null },
    attended_batch_id: { type: ObjectId, ref: "Batch", required: true },
    attendance_status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    attendee_type: { type: String, enum: ATTENDEE_TYPES, default: "regular" },
    billing_mode: { type: String, enum: BILLING_MODES, default: "package" },
    is_makeup: { type: Boolean, default: false },
    student_fee_plan_id: { type: ObjectId, ref: "StudentFeePlan", default: null, index: true },
    makeup_credit_id: { type: ObjectId, ref: "MakeupCredit", default: null },
    drop_in_fee: { type: Number, default: null },
    remarks: { type: String, default: null },
    recorded_by_id: { type: ObjectId, ref: "User", default: null },
  },
  { timestamps: TIMESTAMPS },
);
attendanceSchema.index({ session_id: 1, student_id: 1 }, { unique: true });
attendanceSchema.index({ academy_id: 1, session_date: 1 });
attendanceSchema.index({ attended_batch_id: 1, session_date: 1 });

export const SessionAttendance = mongoose.model("SessionAttendance", attendanceSchema, "session_attendance");

export const MAKEUP_STATUSES = ["pending_approval", "available", "booked", "used", "expired", "rejected", "cancelled"];

/** A make-up entitlement created from a missed session (brief section 7). */
const makeupSchema = schema(
  {
    academy_id: { type: ObjectId, ref: "Academy", required: true, index: true },
    student_id: { type: ObjectId, ref: "User", required: true, index: true },
    missed_attendance_id: { type: ObjectId, ref: "SessionAttendance", default: null },
    missed_session_id: { type: ObjectId, ref: "Session", required: true },
    original_batch_id: { type: ObjectId, ref: "Batch", required: true },
    status: { type: String, enum: MAKEUP_STATUSES, default: "available", index: true },
    expires_on: { type: String, default: null },
    booked_session_id: { type: ObjectId, ref: "Session", default: null, index: true },
    used_attendance_id: { type: ObjectId, ref: "SessionAttendance", default: null },
    decided_by_id: { type: ObjectId, ref: "User", default: null },
    decided_at: { type: Date, default: null },
    note: { type: String, default: null },
  },
  { timestamps: TIMESTAMPS },
);
makeupSchema.index(
  { missed_attendance_id: 1 },
  { unique: true, partialFilterExpression: { missed_attendance_id: { $type: "objectId" } } },
);

export const MakeupCredit = mongoose.model("MakeupCredit", makeupSchema, "makeup_credits");
