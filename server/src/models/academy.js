import mongoose from "mongoose";

import { ObjectId, TIMESTAMPS, schema } from "./plugins.js";

const academySchema = schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: null },
    location: { type: String, default: null },
    sport_scope: { type: String, default: "pickleball" },
    owner_name: { type: String, default: null },
    contact_no: { type: String, default: null },
    email: { type: String, default: null },
    logo_url: { type: String, default: null },
    status: { type: String, default: "active" },
    // Business rules — validated by services/rules.js (BusinessRules).
    settings: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    // Homepage/marketing sections — validated by services/rules.js (SiteContent).
    site_content: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: TIMESTAMPS, minimize: false },
);

/** Tenant boundary. LuvAll Sports is the single tenant for the first release (FR-002). */
export const Academy = mongoose.model("Academy", academySchema, "academies");

const auditSchema = schema({
  academy_id: { type: ObjectId, ref: "Academy", required: true, index: true },
  user_id: { type: ObjectId, ref: "User", default: null, index: true },
  entity_type: { type: String, required: true, index: true },
  entity_id: { type: String, default: null },
  action: { type: String, required: true },
  summary: { type: String, default: null },
  old_value_json: { type: mongoose.Schema.Types.Mixed, default: null },
  new_value_json: { type: mongoose.Schema.Types.Mixed, default: null },
  ip_address: { type: String, default: null },
  created_at: { type: Date, default: () => new Date(), index: true },
});

export const AuditLog = mongoose.model("AuditLog", auditSchema, "audit_logs");
