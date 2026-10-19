/**
 * Request validation with zod. Error responses keep the FastAPI-style shape the client understands:
 *   422 { detail: [{ loc: ["body", "field"], msg: "..." }] }
 */
import mongoose from "mongoose";
import { z } from "zod";

import { isDate } from "./dates.js";

export { z };

export class ValidationError extends Error {
  constructor(issues, where = "body") {
    super("Validation failed");
    this.name = "ValidationError";
    this.statusCode = 422;
    this.detail = issues.map((i) => ({ loc: [where, ...i.path], msg: i.message, type: i.code }));
  }
}

function run(schema, data, where) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) throw new ValidationError(result.error.issues, where);
  return result.data;
}

/** Parse req.body. For PATCH schemas (all fields optional) the result only contains keys that were sent. */
export const parseBody = (schema, req) => run(schema, req.body, "body");
export const parseQuery = (schema, req) => run(schema, req.query, "query");

export function normalizeMobile(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length < 8 || digits.length > 15) throw new Error("Enter a valid mobile number");
  return digits;
}

// ---- Reusable field schemas -------------------------------------------------------------------------------

export const zId = z.string().refine((v) => mongoose.isValidObjectId(v) && /^[a-f0-9]{24}$/i.test(v), "Invalid id");
export const zDate = z.string().refine(isDate, "Use YYYY-MM-DD");
export const zTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Use HH:MM")
  .transform((v) => v.slice(0, 5));
export const zMonth = z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM");
/** A user's email: stored lower-cased (sign-in and duplicate checks compare lower-case). */
export const zEmail = z
  .string()
  .trim()
  .email("Enter a valid email")
  .transform((v) => v.toLowerCase());
/** Pydantic EmailStr: a valid address with the domain lower-cased; the local part keeps its case. */
export const zEmailStr = z
  .string()
  .trim()
  .email("Enter a valid email")
  .transform((v) => {
    const at = v.lastIndexOf("@");
    return `${v.slice(0, at)}@${v.slice(at + 1).toLowerCase()}`;
  });
export const zMobile = z.string().transform((v, ctx) => {
  try {
    return normalizeMobile(v);
  } catch (e) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: e.message });
    return z.NEVER;
  }
});
/** Optional + nullable (PATCH-style "may be sent, may be null"). */
export const opt = (s) => s.nullable().optional();
/** Datetime ISO string -> Date. */
export const zDateTime = z.coerce.date();
const TRUE_STRINGS = ["1", "true", "t", "yes", "y", "on"];
const FALSE_STRINGS = ["0", "false", "f", "no", "n", "off"];
/** Boolean that also accepts the strings Pydantic does ("true"/"1"/"yes"/"on", ...); anything else is a 422. */
export const zBool = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const s = v.trim().toLowerCase();
  if (TRUE_STRINGS.includes(s)) return true;
  if (FALSE_STRINGS.includes(s)) return false;
  return v;
}, z.boolean());
export const zInt = z.coerce.number().int();
