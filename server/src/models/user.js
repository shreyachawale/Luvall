import mongoose from "mongoose";

import { ObjectId, TIMESTAMPS, jsonOptions, schema } from "./plugins.js";

export const ROLES = ["admin", "coach", "student"];

const roleSchema = schema(
  {
    academy_id: { type: ObjectId, ref: "Academy", required: true },
    role: { type: String, enum: ROLES, required: true },
    assigned_at: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const userSchema = schema(
  {
    name: { type: String, required: true },
    mobile: { type: String, required: true, unique: true },
    email: { type: String, default: null },
    password_hash: { type: String, default: null },
    auth_provider: { type: String, default: "password" },
    dob: { type: String, default: null },
    gender: { type: String, default: null },
    address: { type: String, default: null },
    joined_date: { type: String, default: null },
    photo_url: { type: String, default: null },
    status: { type: String, default: "active" },
    last_login_at: { type: Date, default: null },
    // Role assignments per academy (UserRole in the BRD data model).
    roles: { type: [roleSchema], default: [] },
  },
  { timestamps: TIMESTAMPS },
);
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });
userSchema.index({ "roles.academy_id": 1, "roles.role": 1 });

userSchema.methods.rolesFor = function rolesFor(academyId) {
  return this.roles.filter((r) => String(r.academy_id) === String(academyId)).map((r) => r.role);
};

export const User = mongoose.model("User", userSchema, "users");

function profileTransform(doc, ret) {
  jsonOptions.transform(doc, ret);
  ret.user_id = ret.id;
  return ret;
}
const profileJson = { ...jsonOptions, transform: profileTransform };

const rateSchema = schema({
  hourly_rate: { type: Number, required: true },
  effective_from: { type: String, required: true },
  effective_to: { type: String, default: null },
  created_at: { type: Date, default: () => new Date() },
});

/** Coach-specific attributes; _id is the coach's user id. Rates are effective-dated (never rewrite history). */
const coachProfileSchema = schema(
  {
    _id: { type: ObjectId, ref: "User" },
    academy_id: { type: ObjectId, ref: "Academy", required: true, index: true },
    title: { type: String, default: null },
    certifications: { type: String, default: null },
    profile_bio: { type: String, default: null },
    specialties: { type: String, default: null },
    experience_years: { type: Number, default: null },
    is_public: { type: Boolean, default: true },
    display_order: { type: Number, default: 0 },
    status: { type: String, default: "active" },
    rates: { type: [rateSchema], default: [] },
  },
  { timestamps: TIMESTAMPS, toJSON: profileJson, toObject: profileJson },
);

export const CoachProfile = mongoose.model("CoachProfile", coachProfileSchema, "coach_profiles");

/** Student-specific attributes; _id is the student's user id. */
const studentProfileSchema = schema(
  {
    _id: { type: ObjectId, ref: "User" },
    academy_id: { type: ObjectId, ref: "Academy", required: true, index: true },
    skill_level: { type: String, default: null },
    guardian_name: { type: String, default: null },
    emergency_contact: { type: String, default: null },
    notes: { type: String, default: null },
    // self = registered on the website, admin = created by admin, walk_in = added by a coach at a session.
    source: { type: String, default: "self" },
    status: { type: String, default: "active" },
  },
  { timestamps: TIMESTAMPS, toJSON: profileJson, toObject: profileJson },
);

export const StudentProfile = mongoose.model("StudentProfile", studentProfileSchema, "student_profiles");
