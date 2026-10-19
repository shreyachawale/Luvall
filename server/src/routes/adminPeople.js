/** Admin: students, coaches and user access (brief section 12). */
import express from "express";

import { adminOnly } from "../middleware/auth.js";
import {
  Batch,
  BatchStudent,
  CoachPayment,
  CoachProfile,
  LedgerTransaction,
  MakeupCredit,
  oid,
  Payment,
  sameId,
  SEAT_HOLDING_STATUSES,
  Session,
  SessionAttendance,
  sid,
  StudentProfile,
  toJSON,
  User,
} from "../models/index.js";
import { isObjectId } from "../models/plugins.js";
import { snapshot } from "../services/audit.js";
import * as finance from "../services/finance.js";
import * as ledger from "../services/ledger.js";
import * as rates from "../services/rates.js";
import { hashPassword } from "../services/security.js";
import { today } from "../utils/clock.js";
import { BusinessRuleError, NotFoundError } from "../utils/errors.js";
import { read, write } from "../utils/http.js";
import { sum } from "../utils/money.js";
import { normalizeMobile, opt, parseBody, parseQuery, z, zBool, zDate, zEmail, zId, zInt, zMobile } from "../utils/validate.js";
import { applyUpdates, escapeRegex, getOr404, ilike, log, pageOut, userBrief } from "./common.js";
import { creditOut, paymentOut, sessionBrief, studentPlans } from "./serializers.js";

const router = express.Router();

// ---- Validation helpers (Pydantic semantics) ----------------------------------------------------------------

/** A JSON number (Pydantic also accepts a numeric string); null is rejected unless wrapped in opt(). */
const number = (schema = z.number().finite()) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v), schema);
const pattern = (re) => z.string().regex(re, `String should match pattern '${re.source}'`);
const zOid = zId.transform((v) => v.toLowerCase());
const ACTIVE_INACTIVE = /^(active|inactive)$/;

/** Python `normalize_mobile(value) if value else value`: an empty value is passed through unchanged. */
const patchMobile = z.string().transform((v, ctx) => {
  if (!v) return v;
  try {
    return normalizeMobile(v);
  } catch (exc) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: exc.message });
    return z.NEVER;
  }
});

const PersonIn = {
  name: z.string().min(2).max(200),
  mobile: zMobile,
  email: opt(zEmail),
  password: opt(z.string().min(8).max(72)),
  dob: opt(zDate),
  gender: opt(z.string().max(20)),
  address: opt(z.string().max(1000)),
  photo_url: opt(z.string().max(500)),
  joined_date: opt(zDate),
};

const PersonPatch = {
  name: opt(z.string().min(2).max(200)),
  mobile: opt(patchMobile),
  email: opt(zEmail),
  dob: opt(zDate),
  gender: opt(z.string().max(20)),
  address: opt(z.string().max(1000)),
  photo_url: opt(z.string().max(500)),
  joined_date: opt(zDate),
  status: opt(pattern(ACTIVE_INACTIVE)),
};

const PageQuery = { page: zInt.default(1), page_size: zInt.default(50) };

function paging(query, maxSize = 200) {
  const page = Math.max(query.page, 1);
  const pageSize = Math.min(Math.max(query.page_size, 1), maxSize);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

/** The user's roles in this academy as a sorted list. */
function rolesOf(user, academyId) {
  return [...new Set(user.rolesFor(academyId))].sort();
}

const byNewest = (rows) => [...rows].sort((a, b) => (a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : 0));
const nameCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

async function createUser(req, body, role) {
  if (await User.exists({ mobile: body.mobile })) throw new BusinessRuleError("A user with this mobile number already exists");
  const email = body.email ? body.email.toLowerCase() : null;
  if (email && (await User.exists({ email }))) throw new BusinessRuleError("A user with this email already exists");
  return User.create({
    name: body.name.trim(),
    mobile: body.mobile,
    email,
    password_hash: body.password ? await hashPassword(body.password) : null,
    dob: body.dob ?? null,
    gender: body.gender ?? null,
    address: body.address ?? null,
    photo_url: body.photo_url ?? null,
    joined_date: body.joined_date || today(),
    status: "active",
    roles: [{ academy_id: req.academy._id, role }],
  });
}

/** Apply user-level PATCH fields (mobile/email must stay unique); returns [old, new] for the audit log. */
async function patchUser(user, data) {
  if (data.mobile && data.mobile !== user.mobile) {
    if (await User.exists({ mobile: data.mobile, _id: { $ne: user._id } })) {
      throw new BusinessRuleError("Another user has this mobile number");
    }
  }
  if (data.email) {
    data.email = data.email.toLowerCase();
    if (await User.exists({ email: data.email, _id: { $ne: user._id } })) throw new BusinessRuleError("Another user has this email");
  }
  return applyUpdates(user, data);
}

/** Move profile fields (and profile_status -> status) out of a PATCH body. */
function splitProfile(data, fields) {
  const profileData = {};
  for (const key of fields) {
    if (Object.hasOwn(data, key)) {
      profileData[key] = data[key];
      delete data[key];
    }
  }
  if (Object.hasOwn(data, "profile_status")) {
    profileData.status = data.profile_status;
    delete data.profile_status;
  }
  return profileData;
}

async function userOr404(id) {
  return getOr404(User, id);
}

// --- Students ------------------------------------------------------------------------------------------------

const STUDENT_PROFILE_FIELDS = ["skill_level", "guardian_name", "emergency_contact", "notes"];

const StudentIn = z.object({
  ...PersonIn,
  skill_level: opt(z.string().max(30)),
  guardian_name: opt(z.string().max(200)),
  emergency_contact: opt(z.string().max(20)),
  notes: opt(z.string().max(2000)),
  opening_balance: opt(number()),
});

const StudentPatch = z.object({
  ...PersonPatch,
  skill_level: opt(z.string().max(30)),
  guardian_name: opt(z.string().max(200)),
  emergency_contact: opt(z.string().max(20)),
  notes: opt(z.string().max(2000)),
  profile_status: opt(pattern(ACTIVE_INACTIVE)),
});

const StudentsQuery = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  batch_id: zOid.optional(),
  dues: zBool.default(false),
  ...PageQuery,
});

router.get(
  "/admin/students",
  adminOnly,
  read(async (req) => {
    const query = parseQuery(StudentsQuery, req);
    const academyId = req.academy._id;
    const match = { academy_id: oid(academyId) };
    const idFilters = [];
    if (query.status) match.status = query.status;
    if (query.batch_id) {
      const ids = await BatchStudent.distinct("student_id", { batch_id: oid(query.batch_id), status: { $in: SEAT_HOLDING_STATUSES } });
      idFilters.push({ _id: { $in: ids } });
    }
    const balances = await ledger.balances(academyId);
    if (query.dues) {
      const due = Object.entries(balances)
        .filter(([, b]) => b < 0)
        .map(([id]) => oid(id));
      idFilters.push({ _id: { $in: due } });
    }
    if (idFilters.length) match.$and = idFilters;
    const pipeline = [
      { $match: match },
      { $lookup: { from: User.collection.name, localField: "_id", foreignField: "_id", as: "user" } },
      { $unwind: "$user" },
    ];
    if (query.q) {
      pipeline.push({
        $match: { $or: [{ "user.name": ilike(query.q) }, { "user.mobile": new RegExp(escapeRegex(query.q)) }, { "user.email": ilike(query.q) }] },
      });
    }
    const { page, pageSize, skip } = paging(query);
    const [result] = await StudentProfile.aggregate([
      ...pipeline,
      {
        $facet: {
          total: [{ $count: "n" }],
          rows: [{ $sort: { "user.name": 1, _id: 1 } }, { $skip: skip }, { $limit: pageSize }],
        },
      },
    ]);
    const total = result.total[0]?.n ?? 0;
    const rows = result.rows;
    const counts = {};
    if (rows.length) {
      const grouped = await BatchStudent.aggregate([
        { $match: { student_id: { $in: rows.map((r) => r._id) }, status: { $in: SEAT_HOLDING_STATUSES } } },
        { $group: { _id: "$student_id", n: { $sum: 1 } } },
      ]);
      for (const g of grouped) counts[String(g._id)] = g.n;
    }
    const items = rows.map((p) => ({
      ...userBrief({ ...p.user, email: p.user.email ?? null, photo_url: p.user.photo_url ?? null }),
      status: p.user.status,
      profile_status: p.status,
      skill_level: p.skill_level ?? null,
      source: p.source,
      has_login: !!p.user.password_hash,
      joined_date: p.user.joined_date ?? null,
      active_batches: counts[String(p._id)] ?? 0,
      balance: balances[String(p._id)] ?? 0,
    }));
    return pageOut(items, total, page, pageSize);
  }),
);

router.post(
  "/admin/students",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(StudentIn, req);
    const user = await createUser(req, body, "student");
    await StudentProfile.create({
      _id: user._id,
      academy_id: req.academy._id,
      skill_level: body.skill_level ?? null,
      guardian_name: body.guardian_name ?? null,
      emergency_contact: body.emergency_contact ?? null,
      notes: body.notes ?? null,
      source: "admin",
    });
    if (body.opening_balance) {
      await ledger.post({
        academyId: req.academy._id,
        studentId: user._id,
        txnType: "opening_balance",
        amount: body.opening_balance,
        description: "Opening balance (migrated)",
        createdById: req.principal.user._id,
      });
    }
    await log(req, "student", user._id, "create", `Created student ${user.name}`, null, snapshot(user));
    res.status(201);
    return { id: sid(user) };
  }),
);

const StatementQuery = z.object({ start: zDate.optional(), end: zDate.optional() });

router.get(
  "/admin/students/:student_id",
  adminOnly,
  read(async (req) => {
    const { start, end } = parseQuery(StatementQuery, req);
    const profile = await getOr404(StudentProfile, req.params.student_id, req.academy._id);
    const studentId = profile._id;
    const user = await User.findById(studentId);
    if (!user) throw new NotFoundError("StudentProfile not found");

    const batchCache = new Map();
    const batchOf = async (id) => {
      const key = String(id);
      if (!batchCache.has(key)) batchCache.set(key, await Batch.findById(id).select("name code period_label status"));
      return batchCache.get(key);
    };

    const enrollments = [];
    for (const e of await BatchStudent.find({ student_id: studentId }).sort({ created_at: -1, _id: -1 })) {
      const b = await batchOf(e.batch_id);
      if (!b) continue;
      enrollments.push({ ...toJSON(e), batch_name: b.name, batch_code: b.code, period_label: b.period_label, batch_status: b.status });
    }

    const attendance = [];
    const attRows = await SessionAttendance.find({ student_id: studentId }).sort({ session_date: -1, _id: -1 }).limit(60);
    const sessions = new Map();
    if (attRows.length) {
      for (const s of await Session.find({ _id: { $in: attRows.map((a) => a.session_id) } })) sessions.set(String(s._id), s);
    }
    for (const a of attRows) {
      const s = sessions.get(String(a.session_id));
      if (!s) continue;
      const original = a.original_batch_id ? await batchOf(a.original_batch_id) : null;
      attendance.push({ ...toJSON(a), session: await sessionBrief(s), original_batch_name: original ? original.name : null });
    }

    const payments = [];
    for (const p of await Payment.find({ student_id: studentId }).sort({ payment_date: -1, _id: -1 })) payments.push(await paymentOut(p));
    const credits = [];
    for (const c of await MakeupCredit.find({ student_id: studentId }).sort({ created_at: -1, _id: -1 })) credits.push(await creditOut(c));

    const { entries, ...totals } = await ledger.statement(studentId, start ?? null, end ?? null);
    return {
      ...toJSON(user),
      roles: rolesOf(user, req.academy._id),
      has_login: !!user.password_hash,
      profile: toJSON(profile),
      enrollments,
      plans: await studentPlans(studentId),
      payments,
      makeups: credits,
      attendance,
      ledger: { ...totals, entries: toJSON(entries) },
      balance: await ledger.balance(studentId),
    };
  }),
);

router.patch(
  "/admin/students/:student_id",
  adminOnly,
  write(async (req) => {
    const data = parseBody(StudentPatch, req);
    const profile = await getOr404(StudentProfile, req.params.student_id, req.academy._id);
    const user = await User.findById(profile._id);
    const profileData = splitProfile(data, STUDENT_PROFILE_FIELDS);
    const [old, neu] = await patchUser(user, data);
    const [old2, neu2] = applyUpdates(profile, profileData);
    await user.save();
    await profile.save();
    await log(req, "student", profile._id, "update", `Updated student ${user.name}`, { ...old, ...old2 }, { ...neu, ...neu2 });
    return { ok: true };
  }),
);

// --- Coaches -------------------------------------------------------------------------------------------------

const COACH_PROFILE_FIELDS = ["title", "certifications", "profile_bio", "specialties", "experience_years", "is_public", "display_order"];

const CoachIn = z.object({
  ...PersonIn,
  title: opt(z.string().max(120)),
  certifications: opt(z.string().max(2000)),
  profile_bio: opt(z.string().max(5000)),
  specialties: opt(z.string().max(300)),
  experience_years: opt(number(z.number().int().min(0).max(80))),
  is_public: z.boolean().default(true),
  display_order: number(z.number().int()).default(0),
  hourly_rate: opt(number(z.number().finite().min(0))),
  rate_effective_from: opt(zDate),
});

const CoachPatch = z.object({
  ...PersonPatch,
  title: opt(z.string().max(120)),
  certifications: opt(z.string().max(2000)),
  profile_bio: opt(z.string().max(5000)),
  specialties: opt(z.string().max(300)),
  experience_years: opt(number(z.number().int().min(0).max(80))),
  is_public: opt(z.boolean()),
  display_order: opt(number(z.number().int())),
  profile_status: opt(pattern(ACTIVE_INACTIVE)),
});

/** Coach row for the list: profile, current rate, active batches and this month's hours and payable. */
async function coachSummary(profile, user) {
  const t = today();
  const [s, e] = [finance.monthStart(t), finance.monthEnd(t)];
  const month = await finance.coachSessions(profile.academy_id, s, e, { coachId: user._id });
  return {
    ...userBrief(user),
    ...Object.fromEntries(COACH_PROFILE_FIELDS.map((k) => [k, profile[k] ?? null])),
    status: user.status,
    profile_status: profile.status,
    has_login: !!user.password_hash,
    current_rate: await rates.coachRateOn(user._id, t),
    batches: await Batch.countDocuments({ "coaches.coach_id": user._id, status: { $in: ["upcoming", "active"] } }),
    month_hours: sum(month.map((r) => r.hours_coached)),
    month_payable: sum(month.map((r) => r.payable)),
  };
}

/** Rate rows (newest first) as the CoachRate table returned them. */
function coachRates(profile) {
  return byNewest(profile.rates).map((r) => ({ ...toJSON(r), coach_id: sid(profile) }));
}

const CoachesQuery = z.object({ include_inactive: zBool.default(false) });

router.get(
  "/admin/coaches",
  adminOnly,
  read(async (req) => {
    const { include_inactive: includeInactive } = parseQuery(CoachesQuery, req);
    const filter = { academy_id: req.academy._id };
    if (!includeInactive) filter.status = "active";
    const profiles = await CoachProfile.find(filter).sort({ display_order: 1, _id: 1 });
    const users = new Map();
    if (profiles.length) {
      for (const u of await User.find({ _id: { $in: profiles.map((p) => p._id) } })) users.set(String(u._id), u);
    }
    const out = [];
    for (const p of profiles) {
      const user = users.get(String(p._id));
      if (user) out.push(await coachSummary(p, user));
    }
    return out.sort((a, b) => a.display_order - b.display_order || nameCompare(a.name, b.name));
  }),
);

router.post(
  "/admin/coaches",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(CoachIn, req);
    const user = await createUser(req, body, "coach");
    const profile = await CoachProfile.create({
      _id: user._id,
      academy_id: req.academy._id,
      ...Object.fromEntries(COACH_PROFILE_FIELDS.map((k) => [k, body[k] ?? null])),
    });
    if (body.hourly_rate !== null && body.hourly_rate !== undefined) {
      await rates.setCoachRate(profile, body.hourly_rate, body.rate_effective_from || "2000-01-01");
    }
    await log(req, "coach", user._id, "create", `Created coach ${user.name}`, null, snapshot(user));
    res.status(201);
    return { id: sid(user) };
  }),
);

router.get(
  "/admin/coaches/:coach_id",
  adminOnly,
  read(async (req) => {
    const profile = await getOr404(CoachProfile, req.params.coach_id, req.academy._id);
    const user = await User.findById(profile._id);
    if (!user) throw new NotFoundError("CoachProfile not found");
    const batches = await Batch.find({ "coaches.coach_id": profile._id }).sort({ status: 1, name: 1, _id: 1 });
    const payouts = await CoachPayment.find({ coach_id: profile._id }).sort({ period_month: -1, _id: -1 }).limit(36);
    return {
      ...(await coachSummary(profile, user)),
      dob: user.dob ?? null,
      gender: user.gender ?? null,
      address: user.address ?? null,
      joined_date: user.joined_date ?? null,
      roles: rolesOf(user, req.academy._id),
      rates: coachRates(profile),
      assigned_batches: batches.map((b) => ({ id: sid(b), name: b.name, code: b.code, status: b.status, period_label: b.period_label })),
      payouts: toJSON(payouts),
    };
  }),
);

router.patch(
  "/admin/coaches/:coach_id",
  adminOnly,
  write(async (req) => {
    const data = parseBody(CoachPatch, req);
    const profile = await getOr404(CoachProfile, req.params.coach_id, req.academy._id);
    const user = await User.findById(profile._id);
    const profileData = splitProfile(data, COACH_PROFILE_FIELDS);
    const [old, neu] = await patchUser(user, data);
    const [old2, neu2] = applyUpdates(profile, profileData);
    await user.save();
    await profile.save();
    await log(req, "coach", profile._id, "update", `Updated coach ${user.name}`, { ...old, ...old2 }, { ...neu, ...neu2 });
    return { ok: true };
  }),
);

const RateIn = z.object({ hourly_rate: number(z.number().finite().min(0)), effective_from: zDate });

router.post(
  "/admin/coaches/:coach_id/rates",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(RateIn, req);
    const profile = await getOr404(CoachProfile, req.params.coach_id, req.academy._id);
    const r = await rates.setCoachRate(profile, body.hourly_rate, body.effective_from);
    await log(
      req,
      "coach_rate",
      r._id,
      "set",
      `Coach ${sid(profile)} rate ${body.hourly_rate} from ${body.effective_from}`,
      null,
      { hourly_rate: String(body.hourly_rate), effective_from: body.effective_from },
    );
    res.status(201);
    return coachRates(profile);
  }),
);

router.delete(
  "/admin/coaches/:coach_id/rates/:rate_id",
  adminOnly,
  write(async (req) => {
    const { coach_id: coachId, rate_id: rateId } = req.params;
    const profile = isObjectId(coachId) ? await CoachProfile.findById(coachId) : null;
    const r = profile && sameId(profile.academy_id, req.academy._id) && isObjectId(rateId) ? profile.rates.id(rateId) : null;
    if (!r) throw new NotFoundError("Rate not found");
    await log(req, "coach_rate", rateId, "delete", `Deleted coach rate from ${r.effective_from}`, { ...snapshot(r), coach_id: sid(profile) });
    profile.rates.pull(r._id);
    await profile.save();
  }),
);

// --- Users & access ------------------------------------------------------------------------------------------

const UsersQuery = z.object({ q: z.string().optional(), role: z.string().optional(), ...PageQuery });

router.get(
  "/admin/users",
  adminOnly,
  read(async (req) => {
    const query = parseQuery(UsersQuery, req);
    const academyId = req.academy._id;
    const filter = { roles: { $elemMatch: query.role ? { academy_id: academyId, role: query.role } : { academy_id: academyId } } };
    if (query.q) filter.$or = [{ name: ilike(query.q) }, { mobile: new RegExp(escapeRegex(query.q)) }];
    const { page, pageSize, skip } = paging(query);
    const total = await User.countDocuments(filter);
    const users = await User.find(filter).sort({ name: 1, _id: 1 }).skip(skip).limit(pageSize);
    return pageOut(
      users.map((u) => ({
        ...userBrief(u),
        status: u.status,
        has_login: !!u.password_hash,
        last_login_at: u.last_login_at ?? null,
        roles: rolesOf(u, academyId),
      })),
      total,
      page,
      pageSize,
    );
  }),
);

const AdminUserIn = z.object({ ...PersonIn, password: z.string().min(8).max(72) });

router.post(
  "/admin/users",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(AdminUserIn, req);
    const user = await createUser(req, body, "admin");
    await log(req, "user", user._id, "create_admin", `Created admin ${user.name}`);
    res.status(201);
    return { id: sid(user) };
  }),
);

const RoleChange = z.object({ role: pattern(/^(admin|coach|student)$/), grant: z.boolean() });

/** Grant or revoke a role; granting coach/student creates the missing profile. The last admin cannot be removed. */
router.post(
  "/admin/users/:user_id/roles",
  adminOnly,
  write(async (req) => {
    const body = parseBody(RoleChange, req);
    const user = await userOr404(req.params.user_id);
    const academyId = req.academy._id;
    const holds = (r) => sameId(r.academy_id, academyId) && r.role === body.role;
    const existing = user.roles.some(holds);
    if (body.grant && !existing) {
      user.roles.push({ academy_id: academyId, role: body.role });
      await user.save();
      if (body.role === "coach" && !(await CoachProfile.exists({ _id: user._id }))) {
        await CoachProfile.create({ _id: user._id, academy_id: academyId, is_public: false });
      }
      if (body.role === "student" && !(await StudentProfile.exists({ _id: user._id }))) {
        await StudentProfile.create({ _id: user._id, academy_id: academyId, source: "admin" });
      }
    } else if (!body.grant && existing) {
      if (body.role === "admin" && sameId(user._id, req.principal.id)) {
        throw new BusinessRuleError("You cannot remove your own admin access");
      }
      if (body.role === "admin") {
        const admins = await User.countDocuments({ roles: { $elemMatch: { academy_id: academyId, role: "admin" } } });
        if (admins <= 1) throw new BusinessRuleError("At least one admin is required");
      }
      user.roles = user.roles.filter((r) => !holds(r));
      await user.save();
    }
    await log(
      req,
      "user",
      user._id,
      body.grant ? "grant_role" : "revoke_role",
      `${body.grant ? "Granted" : "Revoked"} ${body.role} for ${user.name}`,
    );
    return { roles: rolesOf(user, academyId) };
  }),
);

const StatusIn = z.object({ status: pattern(ACTIVE_INACTIVE) });

router.post(
  "/admin/users/:user_id/status",
  adminOnly,
  write(async (req) => {
    const body = parseBody(StatusIn, req);
    const user = await userOr404(req.params.user_id);
    if (sameId(user._id, req.principal.id) && body.status === "inactive") {
      throw new BusinessRuleError("You cannot deactivate your own account");
    }
    user.status = body.status;
    await user.save();
    await log(req, "user", user._id, "set_status", `${user.name} -> ${body.status}`);
    return { status: user.status };
  }),
);

const PasswordReset = z.object({ new_password: z.string().min(8).max(72) });

router.post(
  "/admin/users/:user_id/password",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(PasswordReset, req);
    const user = await userOr404(req.params.user_id);
    user.password_hash = await hashPassword(body.new_password);
    await user.save();
    await log(req, "user", user._id, "reset_password", `Reset password for ${user.name}`);
    res.status(204);
  }),
);

const RecentQuery = z.object({ limit: zInt.default(50) });

router.get(
  "/admin/ledger/recent",
  adminOnly,
  read(async (req) => {
    const limit = Math.min(parseQuery(RecentQuery, req).limit, 200);
    if (limit <= 0) return [];
    const rows = await LedgerTransaction.find({ academy_id: req.academy._id }).sort({ _id: -1 }).limit(limit);
    const names = new Map();
    if (rows.length) {
      for (const u of await User.find({ _id: { $in: rows.map((t) => t.student_id) } }).select("name")) names.set(String(u._id), u.name);
    }
    return rows.filter((t) => names.has(String(t.student_id))).map((t) => ({ ...toJSON(t), student_name: names.get(String(t.student_id)) }));
  }),
);

export default router;
