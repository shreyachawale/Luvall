/** Admin CRUD router factory for simple academy-scoped entities (CMS content, fee plans, expenses...). */
import express from "express";

import { adminOnly } from "../middleware/auth.js";
import { oid, toJSON } from "../models/index.js";
import { isObjectId } from "../models/plugins.js";
import { snapshot } from "../services/audit.js";
import { slugify } from "../services/media.js";
import { badRequest } from "../utils/errors.js";
import { read, write } from "../utils/http.js";
import { q } from "../utils/money.js";
import { parseBody, z } from "../utils/validate.js";
import { applyUpdates, getOr404, ilike, log, pageOut, pageParams } from "./common.js";

// ---- Pydantic-style field schemas (same constraints and messages as the FastAPI models) ---------------------

const REQUIRED = { required_error: "Field required" };

/** str with optional min/max length. */
export function str({ min = null, max = null } = {}) {
  let s = z.string({ ...REQUIRED, invalid_type_error: "Input should be a valid string" });
  if (min !== null) s = s.min(min, `String should have at least ${min} character${min === 1 ? "" : "s"}`);
  if (max !== null) s = s.max(max, `String should have at most ${max} character${max === 1 ? "" : "s"}`);
  return s;
}

/** str constrained by a regex (Field(pattern=...)). */
export function pattern(re) {
  return z.string({ ...REQUIRED, invalid_type_error: "Input should be a valid string" }).regex(re, `String should match pattern '${re.source}'`);
}

/** A number, or a numeric string as Pydantic's lax mode accepts; null and "" are rejected (unlike z.coerce). */
export function num({ int = false, ge = null, gt = null, le = null } = {}) {
  let s = z.number({ ...REQUIRED, invalid_type_error: int ? "Input should be a valid integer" : "Input should be a valid number" });
  if (int) s = s.int("Input should be a valid integer, got a number with a fractional part");
  if (ge !== null) s = s.gte(ge, `Input should be greater than or equal to ${ge}`);
  if (gt !== null) s = s.gt(gt, `Input should be greater than ${gt}`);
  if (le !== null) s = s.lte(le, `Input should be less than or equal to ${le}`);
  return z.preprocess((v) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v), s);
}

/** Decimal money: validated like num(), then rounded to paise. */
export const money = (bounds = {}) => num(bounds).transform(q);

const TRUE = new Set(["1", "true", "t", "yes", "y", "on"]);
const FALSE = new Set(["0", "false", "f", "no", "n", "off"]);

/** bool in Pydantic's lax mode (true/false, 1/0, "yes"/"no", "on"/"off"...). */
export function bool() {
  return z.preprocess(
    (v) => {
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (TRUE.has(s)) return true;
        if (FALSE.has(s)) return false;
      }
      if (v === 0 || v === 1) return v === 1;
      return v;
    },
    z.boolean({ ...REQUIRED, invalid_type_error: "Input should be a valid boolean" }),
  );
}

/** Optional field of a create model: may be omitted or null, defaults to null. */
export const nul = (s) => s.nullable().default(null);

// ---- Listing helpers ----------------------------------------------------------------------------------------

/**
 * One page of documents ordered like an SQL ORDER BY. `sort` is a list of [field, direction] pairs where the
 * field may also be an aggregation expression (e.g. `{ $ne: ["$status", "new"] }` puts "new" first), so
 * computed orderings work too. `match` must already be cast (aggregate does not cast).
 */
export async function sortedPage(Model, match, sort, skip, limit) {
  const computed = {};
  const order = {};
  sort.forEach(([key, dir], i) => {
    if (typeof key === "string") {
      order[key] = dir;
    } else {
      computed[`_sort${i}`] = key;
      order[`_sort${i}`] = dir;
    }
  });
  const pipeline = [{ $match: match }];
  if (Object.keys(computed).length) pipeline.push({ $addFields: computed });
  pipeline.push({ $sort: order }, { $skip: skip }, { $limit: limit });
  if (Object.keys(computed).length) pipeline.push({ $project: Object.fromEntries(Object.keys(computed).map((k) => [k, 0])) });
  return (await Model.aggregate(pipeline)).map((raw) => Model.hydrate(raw));
}

/** Python repr() of a string, as shown in "Invalid filter value '...'". */
function pyRepr(text) {
  const s = String(text);
  if (s.includes("'") && !s.includes('"')) return `"${s}"`;
  return `'${s.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

/** Last value of a query parameter (repeated keys arrive as arrays). */
function queryValue(value) {
  return Array.isArray(value) ? value.at(-1) : value;
}

/** A query-string filter value converted to the model field's type (booleans, ids, numbers, dates). */
function coerce(Model, field, raw) {
  const type = Model.schema.path(field)?.instance;
  const invalid = () => badRequest(`Invalid filter value ${pyRepr(raw)}`);
  if (type === "Boolean") return ["1", "true", "yes"].includes(String(raw).toLowerCase());
  if (type === "ObjectId") {
    if (!isObjectId(String(raw))) throw invalid();
    return oid(raw);
  }
  if (type === "Number") {
    const n = Number(raw);
    if (String(raw).trim() === "" || !Number.isFinite(n)) throw invalid();
    return n;
  }
  if (type === "Date") {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw invalid();
    return d;
  }
  return String(raw);
}

/** A slug unique within the academy: base, base-2, base-3, ... */
export async function uniqueSlug(Model, academyId, base, excludeId = null) {
  const root = slugify(base);
  let slug = root;
  let n = 2;
  for (;;) {
    const filter = { academy_id: academyId, slug };
    if (excludeId) filter._id = { $ne: excludeId };
    if (!(await Model.exists(filter))) return slug;
    slug = `${root}-${n}`;
    n += 1;
  }
}

const methodNotAllowed = (_req, res) => {
  res.status(405).json({ detail: "Method Not Allowed" });
};

/**
 * Admin CRUD routes for an academy-scoped model:
 *   GET {path}?q=&page=&page_size=&<filter>=   list (search, filters, pagination)
 *   GET {path}/:id                            one item
 *   POST {path}                               create (201)            — unless allowCreate is false
 *   PATCH {path}/:id                          partial update
 *   DELETE {path}/:id                         delete (204)            — unless allowDelete is false
 *
 * Options:
 *   sort          [[field | expression, 1 | -1], ...] (see sortedPage)
 *   searchFields  fields matched case-insensitively by ?q=
 *   filterFields  fields filterable by query parameter (value coerced to the field's type)
 *   slugSource    field the unique slug is generated from
 *   validate      async (data, doc | null, req) — may normalise `data` or throw
 *   serialize     async (doc) -> JSON (default: the document's JSON)
 *   afterSave     async (doc, extra, req) — receives body fields that are not assigned to the model
 *   extraFields   model fields that are still routed to afterSave instead of being assigned directly
 *   onDelete      async (doc) — clean up references (the SQL schema's ON DELETE SET NULL / CASCADE)
 */
export function crudRouter({
  path,
  Model,
  createSchema,
  updateSchema,
  entity,
  sort,
  searchFields = [],
  filterFields = [],
  slugSource = null,
  validate = null,
  serialize = null,
  afterSave = null,
  extraFields = [],
  onDelete = null,
  allowCreate = true,
  allowDelete = true,
}) {
  const router = express.Router();
  const out = serialize ?? (async (doc) => toJSON(doc));
  const hasSlug = Boolean(slugSource && Model.schema.path("slug"));
  const isColumn = (key) => Boolean(Model.schema.path(key)) && !extraFields.includes(key) && key !== "_id" && key !== "academy_id";

  /** Split parsed body fields into model columns and extras for afterSave. */
  function split(data) {
    const extra = {};
    for (const key of Object.keys(data)) {
      if (!isColumn(key)) {
        extra[key] = data[key];
        delete data[key];
      }
    }
    return extra;
  }

  router.get(
    path,
    adminOnly,
    read(async (req) => {
      const match = { academy_id: req.academy._id };
      for (const field of filterFields) {
        const raw = queryValue(req.query[field]);
        if (raw !== undefined && raw !== null && raw !== "") match[field] = coerce(Model, field, raw);
      }
      const term = queryValue(req.query.q);
      if (term && searchFields.length) match.$or = searchFields.map((f) => ({ [f]: ilike(term) }));
      const total = await Model.countDocuments(match);
      const { page, pageSize, skip } = pageParams(req.query);
      const docs = await sortedPage(Model, match, sort, skip, pageSize);
      const items = [];
      for (const doc of docs) items.push(await out(doc));
      return pageOut(items, total, page, pageSize);
    }),
  );

  router.get(
    `${path}/:id`,
    adminOnly,
    read(async (req) => out(await getOr404(Model, req.params.id, req.academy._id))),
  );

  if (allowCreate) {
    router.post(
      path,
      adminOnly,
      write(async (req, res) => {
        const data = parseBody(createSchema, req);
        const extra = split(data);
        if (validate) await validate(data, null, req);
        if (hasSlug) data.slug = await uniqueSlug(Model, req.academy._id, data.slug || data[slugSource]);
        const doc = new Model({ ...data, academy_id: req.academy._id });
        if (afterSave) await afterSave(doc, extra, req);
        await doc.save();
        await log(req, entity, doc._id, "create", `Created ${entity}`, null, snapshot(doc));
        res.status(201);
        return out(doc);
      }),
    );
  } else {
    router.post(path, methodNotAllowed);
  }

  router.patch(
    `${path}/:id`,
    adminOnly,
    write(async (req) => {
      const data = parseBody(updateSchema, req);
      const doc = await getOr404(Model, req.params.id, req.academy._id);
      const extra = split(data);
      if (validate) await validate(data, doc, req);
      if (hasSlug && "slug" in data) {
        data.slug = await uniqueSlug(Model, req.academy._id, data.slug || doc[slugSource], doc._id);
      }
      const [old, neu] = applyUpdates(doc, data);
      if (afterSave) await afterSave(doc, extra, req);
      await doc.save();
      await log(req, entity, doc._id, "update", `Updated ${entity}`, old, neu);
      return out(doc);
    }),
  );

  if (allowDelete) {
    router.delete(
      `${path}/:id`,
      adminOnly,
      write(async (req, res) => {
        const doc = await getOr404(Model, req.params.id, req.academy._id);
        const old = snapshot(doc);
        if (onDelete) await onDelete(doc);
        await doc.deleteOne();
        await log(req, entity, doc._id, "delete", `Deleted ${entity}`, old);
        res.status(204);
        return undefined;
      }),
    );
  } else {
    router.delete(`${path}/:id`, methodNotAllowed);
  }

  return router;
}
