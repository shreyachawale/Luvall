import { AuditLog, toJSON } from "../models/index.js";

const SKIP = new Set(["updated_at", "created_at", "password_hash"]);

function jsonable(value) {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.parse(JSON.stringify(toJSON(value)));
  return value;
}

/** JSON-safe snapshot of a document's fields (password hashes excluded). */
export function snapshot(doc) {
  if (!doc) return {};
  const plain = toJSON(doc);
  const out = {};
  for (const [k, v] of Object.entries(plain)) {
    if (k === "password_hash") continue;
    out[k] = jsonable(v);
  }
  return out;
}

/** [old, new] restricted to the keys whose values changed. */
export function diff(before, after) {
  const old = {};
  const neu = {};
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    if (SKIP.has(key)) continue;
    if (JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null)) {
      old[key] = before?.[key] ?? null;
      neu[key] = after?.[key] ?? null;
    }
  }
  return [old, neu];
}

export async function record({ academyId, userId = null, entityType, entityId = null, action, summary = null, old = null, neu = null, ip = null }) {
  await AuditLog.create({
    academy_id: academyId,
    user_id: userId,
    entity_type: entityType,
    entity_id: entityId === null || entityId === undefined ? null : String(entityId),
    action,
    summary: summary ? String(summary).slice(0, 500) : null,
    old_value_json: old && Object.keys(old).length ? jsonable(old) : null,
    new_value_json: neu && Object.keys(neu).length ? jsonable(neu) : null,
    ip_address: ip,
  });
}
