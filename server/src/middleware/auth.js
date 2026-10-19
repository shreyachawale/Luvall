import { config } from "../config.js";
import { Academy, User } from "../models/index.js";
import { businessRules } from "../services/rules.js";
import { decodeAccessToken, tokenMatchesPassword } from "../services/security.js";
import { BusinessRuleError, forbidden, unauthorized } from "../utils/errors.js";

/** Loads the tenant (single academy for the first release) onto req.academy. */
export async function withAcademy(req, _res, next) {
  const academy = await Academy.findOne({ code: config.defaultAcademyCode });
  // Signing out only clears the cookie, so it works before the academy exists (as in the Python app).
  if (!academy && req.method === "POST" && req.path === "/auth/logout") return next();
  if (!academy) throw new BusinessRuleError("Academy is not set up yet; run `npm run cli -- init`", 503);
  req.academy = academy;
  req.rules = businessRules(academy);
  next();
}

function tokenFrom(req) {
  const header = req.headers.authorization ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return req.cookies?.[config.cookieName] ?? null;
}

/**
 * Principal for the request:
 *   { user, id, roles: Set<string>, academy, isAdmin, isCoach, isStudent }
 */
export async function resolvePrincipal(req) {
  const token = tokenFrom(req);
  if (!token) return null;
  const decoded = decodeAccessToken(token);
  if (!decoded) return null;
  const user = await User.findById(decoded.userId).catch(() => null);
  if (!user || user.status !== "active" || !tokenMatchesPassword(decoded.fingerprint, user.password_hash)) return null;
  const roles = new Set(user.rolesFor(req.academy._id));
  return {
    user,
    id: String(user._id),
    roles,
    academy: req.academy,
    get isAdmin() {
      return roles.has("admin");
    },
    get isCoach() {
      return roles.has("coach");
    },
    get isStudent() {
      return roles.has("student");
    },
  };
}

/** Attach req.principal (or null) without requiring sign-in. */
export async function optionalAuth(req, _res, next) {
  req.principal = await resolvePrincipal(req);
  next();
}

export async function requireAuth(req, _res, next) {
  req.principal = req.principal ?? (await resolvePrincipal(req));
  if (!req.principal) throw unauthorized();
  next();
}

/** Allow only users holding at least one of the given roles in this academy. */
export function requireRole(...roles) {
  return async (req, res, next) => {
    await requireAuth(req, res, () => undefined);
    if (!roles.some((r) => req.principal.roles.has(r))) throw forbidden();
    next();
  };
}

export const adminOnly = requireRole("admin");
export const coachOrAdmin = requireRole("coach", "admin");
export const studentOnly = requireRole("student");
