import mongoose from "mongoose";

import { ObjectId, TIMESTAMPS, schema } from "./plugins.js";

export const DAY_TYPES = ["weekday", "weekend"];
export const TIME_SLOTS = ["morning", "evening"];

/** Effective-dated hourly court rate per day type and time slot (FR-007). */
const venueRateSchema = schema({
  day_type: { type: String, enum: DAY_TYPES, required: true },
  time_slot: { type: String, enum: TIME_SLOTS, required: true },
  hourly_rate: { type: Number, required: true },
  effective_from: { type: String, required: true },
  effective_to: { type: String, default: null },
  created_at: { type: Date, default: () => new Date() },
});

const venueSchema = schema(
  {
    academy_id: { type: ObjectId, ref: "Academy", required: true, index: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    address: { type: String, default: null },
    city: { type: String, default: null },
    map_url: { type: String, default: null },
    owner_name: { type: String, default: null },
    contact_no: { type: String, default: null },
    courts_available: { type: Number, default: 1 },
    description: { type: String, default: null },
    photo_url: { type: String, default: null },
    amenities: { type: String, default: null },
    is_public: { type: Boolean, default: true },
    status: { type: String, default: "active" },
    rates: { type: [venueRateSchema], default: [] },
  },
  { timestamps: TIMESTAMPS },
);
venueSchema.index({ academy_id: 1, code: 1 }, { unique: true });

export const Venue = mongoose.model("Venue", venueSchema, "venues");
