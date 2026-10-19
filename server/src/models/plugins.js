import mongoose from "mongoose";

/**
 * Shared schema conventions:
 * - API field names are snake_case (the frontend contract), ids are exposed as `id` strings.
 * - `created_at` / `updated_at` timestamps.
 * - Calendar dates are "YYYY-MM-DD" strings, times "HH:MM" strings, money Number rupees (see utils/money.js).
 */

export const { ObjectId } = mongoose.Schema.Types;

export const TIMESTAMPS = { createdAt: "created_at", updatedAt: "updated_at" };

function transform(_doc, ret) {
  if (ret._id !== undefined) {
    ret.id = String(ret._id);
    delete ret._id;
  }
  delete ret.__v;
  delete ret.password_hash;
  return ret;
}

export const jsonOptions = { virtuals: false, versionKey: false, transform };

/** Create a schema with the shared conventions applied (also used for embedded sub-documents). */
export function schema(definition, options = {}) {
  const s = new mongoose.Schema(definition, {
    toJSON: jsonOptions,
    toObject: jsonOptions,
    id: false,
    ...options,
  });
  return s;
}

/** Plain JSON for a document, a lean object or an array of either (null-safe). */
export function toJSON(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(toJSON);
  if (typeof value.toJSON === "function" && value instanceof mongoose.Document) return value.toJSON();
  if (value instanceof mongoose.Types.ObjectId) return String(value);
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "__v" || k === "password_hash") continue;
      if (k === "_id") out.id = String(v);
      else if (v instanceof mongoose.Types.ObjectId) out[k] = String(v);
      else if (Array.isArray(v)) out[k] = v.map((x) => (x && typeof x === "object" ? toJSON(x) : x));
      else if (v && typeof v === "object" && !(v instanceof Date)) out[k] = toJSON(v);
      else out[k] = v;
    }
    return out;
  }
  return value;
}

/** String form of an id (ObjectId, string, document or null). */
export function sid(value) {
  if (value === null || value === undefined) return null;
  if (value._id !== undefined) return String(value._id);
  return String(value);
}

export function sameId(a, b) {
  return a !== null && a !== undefined && b !== null && b !== undefined && sid(a) === sid(b);
}

export function isObjectId(value) {
  return typeof value === "string" ? mongoose.isValidObjectId(value) && /^[a-f0-9]{24}$/i.test(value) : value instanceof mongoose.Types.ObjectId;
}

export function oid(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  return new mongoose.Types.ObjectId(String(value));
}
