/** Shared helpers for routers: lookups, pagination, auditing, reporting periods. */
import mongoose from "mongoose";

import { toJSON } from "../models/index.js";
import * as audit from "../services/audit.js";
import { today } from "../utils/clock.js";
import { monthEnd, monthStart } from "../utils/dates.js";
import { badRequest, NotFoundError } from "../utils/errors.js";
import { clientIp } from "../utils/http.js";
import { ValidationError } from "../utils/validate.js";

export { toJSON };

/** Find by id (and academy, when the model is academy-scoped) or throw 404 "<Model> not found". */
export async function getOr404(Model, id, academyId = null) {
  const valid = id && mongoose.isValidObjectId(String(id)) && /^[a-f0-9]{24}$/i.test(String(id));
  const doc = valid ? await Model.findById(id) : null;
  if (!doc || (academyId && doc.academy_id && String(doc.academy_id) !== String(academyId))) {
    throw new NotFoundError(`${Model.modelName} not found`);
  }
  return doc;
}

/**
 * page / page_size query parameters: integers (anything else is a 422, as FastAPI's `int` params), then clamped
 * like Python's paginate(): page >= 1 and 1 <= page_size <= maxSize.
 */
export function pageParams(query, defaultSize = 50, maxSize = 200) {
  const int = (key, fallback) => {
    const raw = query[key];
    if (raw === undefined) return fallback;
    if (typeof raw !== "string" || !/^\s*[-+]?\d+\s*$/.test(raw)) {
      throw new ValidationError(
        [{ path: [key], message: "Input should be a valid integer, unable to parse string as an integer", code: "int_parsing" }],
        "query",
      );
    }
    return Number.parseInt(raw, 10);
  };
  const page = Math.max(int("page", 1), 1);
  const pageSize = Math.min(Math.max(int("page_size", defaultSize), 1), maxSize);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function pageOut(items, total, page, pageSize) {
  return { items, total, page, page_size: pageSize };
}

/** Write an audit-log entry for the current principal. */
export async function log(req, entityType, entityId, action, summary = null, old = null, neu = null) {
  await audit.record({
    academyId: req.academy._id,
    userId: req.principal?.user?._id ?? null,
    entityType,
    entityId,
    action,
    summary,
    old,
    neu,
    ip: clientIp(req),
  });
}

/** Set fields on a document and return [old, new] values of the fields that changed (for the audit log). */
export function applyUpdates(doc, data) {
  const before = audit.snapshot(doc);
  for (const [key, value] of Object.entries(data)) doc.set(key, value);
  const after = audit.snapshot(doc);
  return audit.diff(before, after);
}

/**
 * Resolve a reporting period from ?month=YYYY-MM or ?start=&end=, defaulting to the current month.
 * Returns [start, end] as "YYYY-MM-DD".
 */
export function period(start, end, month) {
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest("month must be YYYY-MM");
    const first = `${month}-01`;
    return [first, monthEnd(first)];
  }
  const t = today();
  const s = start || monthStart(t);
  const e = end || (start ? t : monthEnd(s));
  if (e < s) throw badRequest("end is before start");
  return [s, e];
}

export function userBrief(user) {
  if (!user) return null;
  return { id: String(user._id), name: user.name, mobile: user.mobile, email: user.email, photo_url: user.photo_url };
}

/** Escape user input for use inside a RegExp (search boxes). */
export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function ilike(text) {
  return new RegExp(escapeRegex(text), "i");
}
