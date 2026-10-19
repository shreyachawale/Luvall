import mongoose from "mongoose";

import { ObjectId, TIMESTAMPS, schema } from "./plugins.js";

export const BATCH_STATUSES = ["upcoming", "active", "completed", "cancelled"];
export const ENROLLMENT_STATUSES = ["pending", "active", "left", "cancelled", "rejected"];
/** Enrollments that hold a seat in the batch. */
export const SEAT_HOLDING_STATUSES = ["pending", "active"];

const scheduleSchema = schema({
  weekday: { type: Number, min: 0, max: 6, required: true }, // 0 = Monday ... 6 = Sunday
  start_time: { type: String, required: true }, // "HH:MM"
  end_time: { type: String, required: true },
  venue_id: { type: ObjectId, ref: "Venue", required: true },
  courts: { type: Number, default: 1 },
  effective_from: { type: String, default: null },
  effective_to: { type: String, default: null },
});

const batchCoachSchema = schema(
  {
    coach_id: { type: ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["lead", "assistant"], default: "lead" },
    effective_from: { type: String, default: null },
    effective_to: { type: String, default: null },
  },
  { _id: false },
);

const batchSchema = schema(
  {
    academy_id: { type: ObjectId, ref: "Academy", required: true, index: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    program_id: { type: ObjectId, ref: "Program", default: null },
    skill_level: { type: String, default: null },
    period_label: { type: String, default: "" },
    start_date: { type: String, default: null },
    end_date: { type: String, default: null },
    duration_minutes: { type: Number, default: 60 },
    min_players: { type: Number, default: 4 },
    max_players: { type: Number, default: 6 },
    fee_plan_id: { type: ObjectId, ref: "FeePlan", default: null },
    price: { type: Number, default: null },
    description: { type: String, default: null },
    is_public: { type: Boolean, default: true },
    status: { type: String, enum: BATCH_STATUSES, default: "upcoming" },
    schedules: { type: [scheduleSchema], default: [] },
    coaches: { type: [batchCoachSchema], default: [] },
  },
  { timestamps: TIMESTAMPS },
);
batchSchema.index({ academy_id: 1, code: 1, period_label: 1 }, { unique: true });
batchSchema.index({ "coaches.coach_id": 1 });

export const Batch = mongoose.model("Batch", batchSchema, "batches");

/** A student's enrollment in a batch, with history (joined_on / left_on). */
const batchStudentSchema = schema(
  {
    batch_id: { type: ObjectId, ref: "Batch", required: true, index: true },
    student_id: { type: ObjectId, ref: "User", required: true, index: true },
    status: { type: String, enum: ENROLLMENT_STATUSES, default: "pending" },
    joined_on: { type: String, default: null },
    left_on: { type: String, default: null },
    capacity_override: { type: Boolean, default: false },
    source: { type: String, default: "self" },
    notes: { type: String, default: null },
  },
  { timestamps: TIMESTAMPS },
);
batchStudentSchema.index({ batch_id: 1, status: 1 });

export const BatchStudent = mongoose.model("BatchStudent", batchStudentSchema, "batch_students");
