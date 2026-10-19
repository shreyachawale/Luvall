import { withTransaction } from "../db.js";

function send(res, out) {
  if (res.headersSent) return;
  if (out === undefined) {
    res.status(res.statusCode === 200 ? 204 : res.statusCode).end();
    return;
  }
  res.json(out);
}

/**
 * Wrap a read-only handler: `return` the JSON body (undefined -> 204). Errors go to the error middleware.
 *   router.get("/x", read(async (req) => ({ ... })))
 */
export function read(fn) {
  return async (req, res) => {
    send(res, await fn(req, res));
  };
}

/**
 * Wrap a state-changing handler in a MongoDB transaction; the response is sent only after commit.
 * Use res.status(201) before returning to signal creation.
 */
export function write(fn) {
  return async (req, res) => {
    const out = await withTransaction(() => fn(req, res));
    send(res, out);
  };
}

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.socket?.remoteAddress ?? null;
}
