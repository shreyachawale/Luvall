/** Shared test fixtures: a small academy (port of tests/conftest.py World) and a supertest login helper. */
import { expect } from "vitest";

import { config } from "../src/config.js";
import { Academy, Batch, CoachProfile, FeePlan, StudentProfile, User, Venue } from "../src/models/index.js";
import * as rates from "../src/services/rates.js";
import { BusinessRules, SiteContent } from "../src/services/rules.js";
import { hashPassword } from "../src/services/security.js";
import { today } from "../src/utils/clock.js";

async function ensureAcademy() {
  const existing = await Academy.findOne({ code: config.defaultAcademyCode });
  if (existing) return existing;
  return Academy.create({
    code: config.defaultAcademyCode,
    name: "LuvAll Sports",
    sport_scope: "pickleball",
    description: "Pickleball coaching academy",
    settings: BusinessRules.parse({}),
    site_content: SiteContent.parse({}),
  });
}

/** Create (or update the password of) a user and give them a role in the academy. */
async function createUser(academy, { name, mobile, role, password = null, email = null }) {
  let user = await User.findOne({ mobile });
  if (!user) {
    user = new User({
      name,
      mobile,
      email,
      joined_date: today(),
      status: "active",
      password_hash: password ? await hashPassword(password) : null,
    });
  } else if (password) {
    user.password_hash = await hashPassword(password);
  }
  if (!user.roles.some((r) => String(r.academy_id) === String(academy._id) && r.role === role)) {
    user.roles.push({ academy_id: academy._id, role });
  }
  await user.save();
  return user;
}

/**
 * A small academy: one admin, two coaches, two venues, two batches and a helper to add students.
 *   world.admin / coach / coach2 are Users; world.venue / venue2, world.plan8, world.batch (BEG) / batch2 (INT).
 */
export async function createWorld() {
  const academy = await ensureAcademy();
  const admin = await createUser(academy, { name: "Admin", mobile: "9000000001", role: "admin", password: "Admin@12345" });

  async function coach(name, mobile, rate) {
    const u = await createUser(academy, { name, mobile, role: "coach", password: "Coach@12345" });
    await CoachProfile.create({ _id: u._id, academy_id: academy._id });
    await rates.setCoachRate(u._id, rate, "2026-01-01");
    return u;
  }

  async function venue(code, r) {
    const v = await Venue.create({ academy_id: academy._id, code, name: `Venue ${code}`, courts_available: 4 });
    for (const [key, value] of Object.entries(r)) {
      const [dayType, slot] = key.split("_");
      await rates.setVenueRate(v._id, dayType, slot, value, "2026-01-01");
    }
    return Venue.findById(v._id);
  }

  const coach1 = await coach("Coach One", "9000000011", 800);
  const coach2 = await coach("Coach Two", "9000000012", 600);
  const venue1 = await venue("V1", { weekday_morning: 600, weekday_evening: 800, weekend_morning: 900, weekend_evening: 1000 });
  const venue2 = await venue("V2", { weekday_morning: 500, weekday_evening: 700, weekend_morning: 800, weekend_evening: 900 });
  const plan8 = await FeePlan.create({
    academy_id: academy._id,
    name: "8 sessions",
    number_of_sessions: 8,
    base_fee: 4000,
    validity_days: 31,
  });

  async function batch(code, schedules, coaches) {
    return Batch.create({
      academy_id: academy._id,
      code,
      name: `Batch ${code}`,
      period_label: "2026-10",
      start_date: "2026-10-01",
      end_date: "2026-10-31",
      max_players: 6,
      min_players: 4,
      fee_plan_id: plan8._id,
      status: "active",
      schedules: schedules.map(([weekday, start, end, v, courts]) => ({
        weekday,
        start_time: start,
        end_time: end,
        venue_id: v._id,
        courts,
      })),
      coaches: coaches.map((c) => ({ coach_id: c._id })),
    });
  }

  // Tue/Thu 17:00-18:00 at V1, 2 courts, Coach One
  const begBatch = await batch("BEG", [[1, "17:00", "18:00", venue1, 2], [3, "17:00", "18:00", venue1, 2]], [coach1]);
  // Mon/Wed 07:00-08:30 at V2, 1 court, both coaches
  const intBatch = await batch("INT", [[0, "07:00", "08:30", venue2, 1], [2, "07:00", "08:30", venue2, 1]], [coach1, coach2]);

  const world = {
    academy,
    admin,
    coach: coach1,
    coach2,
    venue: venue1,
    venue2,
    plan8,
    batch: begBatch,
    batch2: intBatch,
    n: 0,
    /** Add a student (mobile 90000001NN in creation order); returns the StudentProfile. */
    async student({ name = null, password = null } = {}) {
      world.n += 1;
      const u = await createUser(academy, {
        name: name || `Student ${world.n}`,
        mobile: `90000001${String(world.n).padStart(2, "0")}`,
        role: "student",
        password,
      });
      return StudentProfile.create({ _id: u._id, academy_id: academy._id });
    },
  };
  return world;
}

/** Sign a supertest agent in (cookie session); fails the test unless the login succeeds. */
export async function login(agent, mobile, password) {
  const res = await agent.post("/api/v1/auth/login").send({ identifier: mobile, password });
  expect(res.status, res.text).toBe(200);
  return agent;
}
