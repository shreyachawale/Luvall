/** Registration, sign-in (httpOnly cookie session), own profile and password changes. */
import express from "express";

import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { CoachProfile, StudentProfile, toJSON, User } from "../models/index.js";
import { authRateLimiter, createAccessToken, hashPassword, verifyPassword } from "../services/security.js";
import { now, today } from "../utils/clock.js";
import { badRequest, BusinessRuleError, forbidden, unauthorized } from "../utils/errors.js";
import { clientIp, read, write } from "../utils/http.js";
import { normalizeMobile, opt, parseBody, z, zDate, zEmail, zMobile } from "../utils/validate.js";
import { log } from "./common.js";

export { normalizeMobile };

const router = express.Router();

const RegisterIn = z.object({
  name: z.string().min(2).max(200),
  mobile: zMobile,
  email: opt(zEmail),
  password: z.string().min(8).max(72),
  skill_level: opt(z.string().max(30)),
  dob: opt(zDate),
  gender: opt(z.string().max(20)),
  guardian_name: opt(z.string().max(200)),
});

const LoginIn = z.object({
  identifier: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
});

/** PATCH body: only the keys that were sent are applied. */
const ProfileIn = z.object({
  name: opt(z.string().min(2).max(200)),
  email: opt(zEmail),
  dob: opt(zDate),
  gender: opt(z.string().max(20)),
  address: opt(z.string().max(1000)),
  photo_url: opt(z.string().max(500)),
  skill_level: opt(z.string().max(30)),
  guardian_name: opt(z.string().max(200)),
  emergency_contact: opt(z.string().max(20)),
});

const PasswordIn = z.object({
  current_password: z.string(),
  new_password: z.string().min(8).max(72),
});

/** Fields of PATCH /auth/me that live on the student profile rather than the user. */
const PROFILE_FIELDS = new Set(["skill_level", "guardian_name", "emergency_contact"]);

/**
 * Readable by the client (the session cookie is httpOnly) so public pages only call /auth/me when a session
 * may exist. It carries no credentials.
 */
export const SIGNED_IN_HINT_COOKIE = "luvall_signed_in";

export function setSessionCookie(res, user) {
  const options = { maxAge: config.accessTokenMinutes * 60 * 1000, secure: config.cookieSecure, sameSite: "lax", path: "/" };
  res.cookie(config.cookieName, createAccessToken(user._id, user.password_hash), { ...options, httpOnly: true });
  res.cookie(SIGNED_IN_HINT_COOKIE, "1", options);
}

/** The signed-in user with their roles in this academy (sorted) and any student / coach profile. */
export async function meOut(user, academyId) {
  const roles = [...new Set(user.rolesFor(academyId))].sort();
  const data = { ...toJSON(user), roles };
  const studentProfile = await StudentProfile.findById(user._id);
  if (studentProfile) data.student_profile = toJSON(studentProfile);
  const coachProfile = await CoachProfile.findById(user._id);
  if (coachProfile) {
    // Profile columns only: effective-dated rates are not part of the profile record.
    const profile = toJSON(coachProfile);
    delete profile.rates;
    data.coach_profile = profile;
  }
  return data;
}

function rateLimit(key) {
  if (!authRateLimiter.allow(key, config.loginRateLimit, config.loginRateWindowSeconds)) {
    throw new BusinessRuleError("Too many attempts. Please wait a few minutes.", 429);
  }
}

/**
 * Validate the body into res.locals.body, then apply the auth rate limit for the key built from it. Runs before
 * the transaction starts so a retried transaction never counts an attempt twice.
 */
function limited(schema, keyOf) {
  return (req, res, next) => {
    res.locals.body = parseBody(schema, req);
    rateLimit(keyOf(req, res.locals.body));
    next();
  };
}

router.post(
  "/auth/register",
  limited(RegisterIn, (req) => `register:${clientIp(req)}`),
  write(async (req, res) => {
    const body = res.locals.body;
    if (await User.findOne({ mobile: body.mobile })) {
      throw new BusinessRuleError(
        "An account with this mobile number already exists. Sign in, or contact the academy if you were " +
          "added at a session.",
      );
    }
    if (body.email && (await User.findOne({ email: body.email }))) {
      throw new BusinessRuleError("An account with this email already exists");
    }
    const user = await User.create({
      name: body.name.trim(),
      mobile: body.mobile,
      email: body.email || null,
      password_hash: await hashPassword(body.password),
      dob: body.dob ?? null,
      gender: body.gender ?? null,
      joined_date: today(),
      status: "active",
      roles: [{ academy_id: req.academy._id, role: "student" }],
    });
    await StudentProfile.create({
      _id: user._id,
      academy_id: req.academy._id,
      skill_level: body.skill_level ?? null,
      guardian_name: body.guardian_name ?? null,
      source: "self",
    });
    setSessionCookie(res, user);
    res.status(201);
    return meOut(user, req.academy._id);
  }),
);

router.post(
  "/auth/login",
  limited(LoginIn, (req, body) => `login:${clientIp(req)}:${body.identifier.trim().toLowerCase()}`),
  write(async (req, res) => {
    const identifier = res.locals.body.identifier.trim().toLowerCase();
    const conditions = [{ email: identifier }];
    try {
      conditions.push({ mobile: normalizeMobile(identifier) });
    } catch {
      // Not a mobile number: match on email only.
    }
    const user = await User.findOne({ $or: conditions });
    if (!user || !(await verifyPassword(res.locals.body.password, user.password_hash))) {
      throw unauthorized("Incorrect mobile/email or password");
    }
    if (user.status !== "active") throw forbidden("This account is inactive. Please contact the academy.");
    if (!user.rolesFor(req.academy._id).length) throw forbidden("This account has no access to this academy");
    user.last_login_at = now();
    await user.save();
    setSessionCookie(res, user);
    return meOut(user, req.academy._id);
  }),
);

router.post(
  "/auth/logout",
  read(async (_req, res) => {
    res.clearCookie(config.cookieName, { path: "/", httpOnly: true, secure: config.cookieSecure, sameSite: "lax" });
    res.clearCookie(SIGNED_IN_HINT_COOKIE, { path: "/", secure: config.cookieSecure, sameSite: "lax" });
    res.status(204);
  }),
);

router.get(
  "/auth/me",
  requireAuth,
  read(async (req) => meOut(req.principal.user, req.academy._id)),
);

router.patch(
  "/auth/me",
  requireAuth,
  write(async (req) => {
    const data = parseBody(ProfileIn, req);
    const user = req.principal.user;
    if ("email" in data && data.email) {
      const clash = await User.findOne({ email: data.email, _id: { $ne: user._id } });
      if (clash) throw new BusinessRuleError("That email is already in use");
    }
    const profile = await StudentProfile.findById(user._id);
    for (const [key, value] of Object.entries(data)) {
      if (PROFILE_FIELDS.has(key)) {
        if (profile) profile.set(key, value);
      } else {
        user.set(key, value);
      }
    }
    await log(req, "user", user._id, "update_profile", "Updated own profile");
    await user.save();
    if (profile) await profile.save();
    return meOut(user, req.academy._id);
  }),
);

router.post(
  "/auth/change-password",
  requireAuth,
  limited(PasswordIn, (req) => `password:${req.principal.id}`),
  write(async (req, res) => {
    const body = res.locals.body;
    const user = req.principal.user;
    if (!(await verifyPassword(body.current_password, user.password_hash))) {
      throw badRequest("Current password is incorrect");
    }
    user.password_hash = await hashPassword(body.new_password);
    await log(req, "user", user._id, "change_password", "Changed password");
    await user.save();
    setSessionCookie(res, user);
  }),
);

export default router;
