import crypto from "node:crypto";

import helmet from "helmet";

import { config } from "../config.js";
import { log } from "../utils/logger.js";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Cookie-authenticated state changes must come from our own site (CSRF defence alongside SameSite=Lax). */
export function originCheck(req, res, next) {
  if (UNSAFE.has(req.method) && req.cookies?.[config.cookieName]) {
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      res.status(403).json({ detail: "Cross-site request blocked" });
      return;
    }
  }
  next();
}

export function requestLogger(req, res, next) {
  const requestId = req.headers["x-request-id"] || crypto.randomUUID().slice(0, 12);
  const start = process.hrtime.bigint();
  res.setHeader("x-request-id", requestId);
  res.on("finish", () => {
    if (req.path.startsWith("/media") || req.path.startsWith("/assets")) return;
    log("info", "request", {
      request_id: requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Number(process.hrtime.bigint() - start) / 1e6,
    });
  });
  next();
}

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "img-src": ["'self'", "data:", "blob:", "https:"],
      "frame-src": [
        "https://www.youtube-nocookie.com",
        "https://www.youtube.com",
        "https://www.instagram.com",
        "https://player.vimeo.com",
        "https://www.facebook.com",
        "https://www.google.com",
      ],
      "connect-src": ["'self'"],
      "upgrade-insecure-requests": config.isProduction ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "same-site" },
  // As in the original app; embedded YouTube/Vimeo players refuse to play without a Referer.
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
});
