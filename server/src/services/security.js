import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { config } from "../config.js";

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, passwordHash) {
  if (!passwordHash) return false;
  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    return false;
  }
}

// Changing the password changes the fingerprint, which invalidates existing tokens.
function fingerprint(passwordHash) {
  return (passwordHash ?? "").slice(-12);
}

export function createAccessToken(userId, passwordHash) {
  return jwt.sign({ sub: String(userId), pwf: fingerprint(passwordHash) }, config.jwtSecret, {
    algorithm: "HS256",
    expiresIn: config.accessTokenMinutes * 60,
  });
}

/** Returns { userId, fingerprint } or null for an invalid/expired token. */
export function decodeAccessToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    return { userId: String(payload.sub), fingerprint: payload.pwf ?? "" };
  } catch {
    return null;
  }
}

export function tokenMatchesPassword(tokenFingerprint, passwordHash) {
  return tokenFingerprint === fingerprint(passwordHash);
}

/** Small in-process sliding-window limiter for authentication endpoints. */
export class RateLimiter {
  constructor() {
    this.hits = new Map();
  }

  allow(key, limit, windowSeconds) {
    const now = Date.now();
    const cutoff = now - windowSeconds * 1000;
    const hits = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (hits.length >= limit) {
      this.hits.set(key, hits);
      return false;
    }
    hits.push(now);
    this.hits.set(key, hits);
    return true;
  }

  reset() {
    this.hits.clear();
  }
}

export const authRateLimiter = new RateLimiter();
