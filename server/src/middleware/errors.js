import mongoose from "mongoose";
import multer from "multer";

import { log } from "../utils/logger.js";

/** Maps known errors to HTTP responses with the `{ detail }` shape the client expects. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return;
  // A cookie set by a handler whose transaction then failed must not reach the client.
  res.removeHeader("Set-Cookie");
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ detail: "Malformed JSON body" });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ detail: "Request body too large" });
    return;
  }
  if (err?.name === "ValidationError" && Array.isArray(err.detail)) {
    res.status(422).json({ detail: err.detail });
    return;
  }
  if (err?.statusCode && err?.message && err.name !== "ValidationError") {
    res.status(err.statusCode).json({ detail: err.message });
    return;
  }
  if (err instanceof mongoose.Error.CastError) {
    res.status(404).json({ detail: "Not found" });
    return;
  }
  if (err instanceof mongoose.Error.ValidationError) {
    res.status(422).json({
      detail: Object.values(err.errors).map((e) => ({ loc: ["body", e.path], msg: e.message, type: e.kind })),
    });
    return;
  }
  if (err?.code === 11000) {
    res.status(409).json({ detail: "A record with these details already exists" });
    return;
  }
  if (err instanceof multer.MulterError) {
    res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ detail: err.message });
    return;
  }
  // Client errors raised by Express or its middleware (e.g. a path parameter with malformed percent-encoding).
  const status = err?.status ?? err?.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    res.status(status).json({ detail: err.expose === false ? "Bad request" : err.message || "Bad request" });
    return;
  }
  log("error", "unhandled error", { path: req.path, method: req.method, error: err?.stack ?? String(err) });
  res.status(500).json({ detail: "Something went wrong. Please try again." });
}

/** HTTP methods of the routes in `stack` (recursing into mounted routers) whose path matches `path`. */
function allowedMethods(stack, path) {
  const out = new Set();
  for (const layer of stack) {
    if (layer.route) {
      if (layer.match(path)) {
        for (const [method, on] of Object.entries(layer.route.methods)) if (on && method !== "_all") out.add(method.toUpperCase());
      }
    } else if (layer.handle?.stack && layer.match(path)) {
      for (const method of allowedMethods(layer.handle.stack, path.slice(layer.path.length) || "/")) out.add(method);
    }
  }
  if (out.has("GET")) out.add("HEAD");
  return out;
}

/**
 * Mount last on a router: a request that reached it matched no route for its method, so if the path exists
 * under another method answer 405 with an Allow header (as FastAPI does) instead of falling through to 404.
 */
export function methodNotAllowed(router) {
  return (req, res, next) => {
    if (req.method === "OPTIONS") return next();
    const allowed = allowedMethods(router.stack, req.path);
    if (!allowed.size || allowed.has(req.method)) return next();
    res.set("Allow", [...allowed].join(", "));
    res.status(405).json({ detail: "Method Not Allowed" });
  };
}

export function notFoundApi(req, res) {
  res.status(404).json({ detail: "Not Found" });
}
