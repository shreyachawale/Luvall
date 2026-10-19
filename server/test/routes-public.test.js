/** API tests for the auth and public website routers, plus robots.txt / sitemap.xml and the SEO-injected app shell. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { describe, expect, test } from "vitest";

import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import {
  Academy,
  Announcement,
  AuditLog,
  Batch,
  BatchStudent,
  CoachProfile,
  Enquiry,
  Event,
  Faq,
  FeePlan,
  GalleryAlbum,
  MediaAsset,
  Post,
  Program,
  StudentProfile,
  Testimonial,
  User,
  Venue,
} from "../src/models/index.js";
import { hashPassword } from "../src/services/security.js";
import { now } from "../src/utils/clock.js";
import { TODAY } from "./setup.js";
import { createWorld, login } from "./world.js";

const app = createApp();
const agent = () => request.agent(app);
const DAY = 86400000;
const daysFromNow = (days) => new Date(now().getTime() + days * DAY);
const base = config.siteUrl.replace(/\/+$/, "");

function post(world, fields) {
  return Post.create({ academy_id: world.academy._id, category: "academy_update", status: "published", ...fields });
}

function media(world, fields) {
  return MediaAsset.create({ academy_id: world.academy._id, media_type: "image", ...fields });
}

describe("auth", () => {
  test("register, me, duplicates, logout and wrong password", async () => {
    await createWorld();
    const c = agent();
    const r = await c.post("/api/v1/auth/register").send({
      name: " New Player ",
      mobile: "+91 98765 43210",
      email: "New.Player@Example.com",
      password: "Secret@123",
      skill_level: "beginner",
      guardian_name: "Parent",
      dob: "2010-05-01",
    });
    expect(r.status, r.text).toBe(201);
    expect(r.body.roles).toEqual(["student"]);
    expect(r.body).toMatchObject({ name: "New Player", mobile: "9876543210", email: "new.player@example.com", dob: "2010-05-01", joined_date: TODAY, status: "active" });
    expect(r.body.id).toMatch(/^[a-f0-9]{24}$/);
    expect(r.body.password_hash).toBeUndefined();
    expect(r.body.student_profile).toMatchObject({ id: r.body.id, user_id: r.body.id, skill_level: "beginner", guardian_name: "Parent", source: "self" });
    expect(r.body.coach_profile).toBeUndefined();
    const cookie = r.headers["set-cookie"][0];
    expect(cookie).toMatch(/^luvall_session=[^;]+;/);
    expect(cookie).toMatch(/Max-Age=604800/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/Secure/);

    const me = await c.get("/api/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.mobile).toBe("9876543210");

    const dup = await agent().post("/api/v1/auth/register").send({ name: "Again", mobile: "9876543210", password: "Secret@123" });
    expect(dup.status).toBe(409);
    expect(dup.body.detail).toBe(
      "An account with this mobile number already exists. Sign in, or contact the academy if you were added at a session.",
    );
    const dupEmail = await agent()
      .post("/api/v1/auth/register")
      .send({ name: "Again", mobile: "9876500000", email: "NEW.PLAYER@example.com", password: "Secret@123" });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.detail).toBe("An account with this email already exists");

    const bad = await agent().post("/api/v1/auth/register").send({ name: "X", mobile: "12", password: "short" });
    expect(bad.status).toBe(422);
    expect(bad.body.detail.map((d) => d.loc.join("."))).toEqual(expect.arrayContaining(["body.name", "body.mobile", "body.password"]));

    const out = await c.post("/api/v1/auth/logout");
    expect(out.status).toBe(204);
    expect(out.headers["set-cookie"][0]).toMatch(/^luvall_session=;/);
    const anon = await c.get("/api/v1/auth/me");
    expect(anon.status).toBe(401);
    expect(anon.body.detail).toBe("Please sign in");

    const wrong = await agent().post("/api/v1/auth/login").send({ identifier: "9876543210", password: "wrong-pass" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.detail).toBe("Incorrect mobile/email or password");
    expect(await StudentProfile.countDocuments()).toBe(1);
  });

  test("login by mobile or email; inactive and role-less accounts are refused", async () => {
    const world = await createWorld();
    const admin = await agent().post("/api/v1/auth/login").send({ identifier: "+91 90000 00001", password: "Admin@12345" });
    expect(admin.status, admin.text).toBe(200);
    expect(admin.body.roles).toEqual(["admin"]);
    expect(admin.body.student_profile).toBeUndefined();
    expect((await User.findById(world.admin._id)).last_login_at).toBeInstanceOf(Date);

    await User.updateOne({ _id: world.coach._id }, { email: "coach1@example.com" });
    const coach = await agent().post("/api/v1/auth/login").send({ identifier: "  Coach1@Example.com ", password: "Coach@12345" });
    expect(coach.status, coach.text).toBe(200);
    expect(coach.body.roles).toEqual(["coach"]);
    expect(coach.body.coach_profile).toMatchObject({ id: String(world.coach._id), user_id: String(world.coach._id), status: "active" });
    expect(coach.body.coach_profile.rates).toBeUndefined();

    await User.updateOne({ _id: world.coach2._id }, { status: "inactive" });
    const inactive = await agent().post("/api/v1/auth/login").send({ identifier: "9000000012", password: "Coach@12345" });
    expect(inactive.status).toBe(403);
    expect(inactive.body.detail).toBe("This account is inactive. Please contact the academy.");

    await User.create({ name: "Elsewhere", mobile: "9000000099", password_hash: await hashPassword("Other@12345") });
    const noRole = await agent().post("/api/v1/auth/login").send({ identifier: "9000000099", password: "Other@12345" });
    expect(noRole.status).toBe(403);
    expect(noRole.body.detail).toBe("This account has no access to this academy");

    expect((await agent().post("/api/v1/auth/login").send({ identifier: "ab", password: "" })).status).toBe(422);
  });

  test("register is rate limited per ip; the cookie is Secure when configured", async () => {
    await createWorld();
    const send = (ip) =>
      request(app).post("/api/v1/auth/register").set("X-Forwarded-For", ip).send({ name: "Dup", mobile: "9000000001", password: "Secret@123" });
    for (let i = 0; i < 10; i += 1) expect((await send("10.1.1.1")).status).toBe(409);
    const limited = await send("10.1.1.1");
    expect(limited.status).toBe(429);
    expect(limited.body.detail).toBe("Too many attempts. Please wait a few minutes.");
    expect((await send("10.1.1.2")).status).toBe(409);
    // Validation errors are rejected before the limiter counts the attempt.
    expect((await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.1.1.3").send({})).status).toBe(422);

    const previous = config.cookieSecure;
    config.cookieSecure = true;
    try {
      const r = await request(app).post("/api/v1/auth/login").send({ identifier: "9000000001", password: "Admin@12345" });
      expect(r.status).toBe(200);
      expect(r.headers["set-cookie"][0]).toMatch(/; Secure/);
    } finally {
      config.cookieSecure = previous;
    }
  });

  test("login is rate limited per ip and identifier", async () => {
    await createWorld();
    const c = agent();
    const codes = [];
    for (let i = 0; i < 12; i += 1) {
      codes.push((await c.post("/api/v1/auth/login").send({ identifier: "9000000001", password: "nope" })).status);
    }
    expect(codes.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(codes.at(-1)).toBe(429);
    const limited = await c.post("/api/v1/auth/login").send({ identifier: "9000000001", password: "Admin@12345" });
    expect(limited.status).toBe(429);
    expect(limited.body.detail).toBe("Too many attempts. Please wait a few minutes.");
    // A different identifier has its own bucket.
    expect((await c.post("/api/v1/auth/login").send({ identifier: "9000000011", password: "Coach@12345" })).status).toBe(200);
  });

  test("password change re-issues the cookie and invalidates other sessions", async () => {
    const world = await createWorld();
    const s = await world.student({ password: "Student@123" });
    const a = await login(agent(), "9000000101", "Student@123");
    const b = await login(agent(), "9000000101", "Student@123");
    const wrong = await a.post("/api/v1/auth/change-password").send({ current_password: "nope", new_password: "Changed@123" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.detail).toBe("Current password is incorrect");
    expect((await a.post("/api/v1/auth/change-password").send({ current_password: "Student@123", new_password: "short" })).status).toBe(422);
    const ok = await a.post("/api/v1/auth/change-password").send({ current_password: "Student@123", new_password: "Changed@123" });
    expect(ok.status).toBe(204);
    expect(ok.headers["set-cookie"][0]).toMatch(/^luvall_session=[^;]+;/);
    expect((await a.get("/api/v1/auth/me")).status).toBe(200);
    expect((await b.get("/api/v1/auth/me")).status).toBe(401);
    await login(agent(), "9000000101", "Changed@123");
    const entry = await AuditLog.findOne({ action: "change_password" });
    expect(entry).toMatchObject({ entity_type: "user", entity_id: String(s._id), summary: "Changed password" });
    expect(String(entry.user_id)).toBe(String(s._id));
    expect((await agent().post("/api/v1/auth/change-password").send({ current_password: "x", new_password: "Changed@123" })).status).toBe(401);

    // Attempts are rate limited per user (two counted above, validation failures are not).
    const fresh = await login(agent(), "9000000101", "Changed@123");
    for (let i = 0; i < 8; i += 1) {
      expect((await fresh.post("/api/v1/auth/change-password").send({ current_password: "nope", new_password: "Another@123" })).status).toBe(400);
    }
    const limited = await fresh.post("/api/v1/auth/change-password").send({ current_password: "Changed@123", new_password: "Another@123" });
    expect(limited.status).toBe(429);
  });

  test("PATCH /auth/me updates the user and student profile", async () => {
    const world = await createWorld();
    const s = await world.student({ password: "Student@123" });
    const c = await login(agent(), "9000000101", "Student@123");
    const r = await c.patch("/api/v1/auth/me").send({
      name: "Renamed",
      email: "Me@Example.com",
      address: "12 Court Road",
      skill_level: "advanced",
      emergency_contact: "9999999999",
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ name: "Renamed", email: "me@example.com", address: "12 Court Road", roles: ["student"] });
    expect(r.body.student_profile).toMatchObject({ skill_level: "advanced", emergency_contact: "9999999999" });
    expect(r.body.skill_level).toBeUndefined();
    expect((await StudentProfile.findById(s._id)).skill_level).toBe("advanced");
    expect((await User.findById(s._id)).address).toBe("12 Court Road");
    const entry = await AuditLog.findOne({ action: "update_profile" });
    expect(entry).toMatchObject({ entity_type: "user", entity_id: String(s._id), summary: "Updated own profile" });

    // Unsent fields are left alone; null clears.
    const cleared = await c.patch("/api/v1/auth/me").send({ email: null });
    expect(cleared.body).toMatchObject({ name: "Renamed", email: null, address: "12 Court Road" });

    await User.updateOne({ _id: world.coach._id }, { email: "taken@example.com" });
    const clash = await c.patch("/api/v1/auth/me").send({ email: "TAKEN@example.com" });
    expect(clash.status).toBe(409);
    expect(clash.body.detail).toBe("That email is already in use");
    expect((await c.patch("/api/v1/auth/me").send({ name: "X" })).status).toBe(422);

    // Profile-only fields are ignored for users without a student profile.
    const coach = await login(agent(), "9000000011", "Coach@12345");
    const cr = await coach.patch("/api/v1/auth/me").send({ skill_level: "advanced", gender: "female" });
    expect(cr.status).toBe(200);
    expect(cr.body.gender).toBe("female");
    expect(cr.body.student_profile).toBeUndefined();
    expect((await agent().patch("/api/v1/auth/me").send({ name: "Anon" })).status).toBe(401);
  });
});

describe("public website", () => {
  test("site info with live public announcements", async () => {
    const world = await createWorld();
    const a = (title, fields = {}) =>
      Announcement.create({ academy_id: world.academy._id, title, message: "m", status: "published", ...fields });
    await a("older", { publish_from: daysFromNow(-3) });
    await a("newer", { publish_from: daysFromNow(-1) });
    await a("pinned", { publish_from: daysFromNow(-5), is_pinned: true });
    await a("students only", { audience: "students" });
    await a("draft", { status: "draft" });
    await a("expired", { publish_to: daysFromNow(-1) });
    await a("future", { publish_from: daysFromNow(2) });
    const r = await request(app).get("/api/v1/public/site");
    expect(r.status).toBe(200);
    expect(r.body.academy).toEqual({
      name: "LuvAll Sports",
      description: "Pickleball coaching academy",
      location: null,
      contact_no: null,
      email: null,
      logo_url: null,
    });
    expect(r.body.content.seo_title).toBe("LuvAll Sports — Pickleball Academy");
    expect(r.body.payment).toHaveProperty("instructions");
    expect(r.body.announcements.map((x) => x.title)).toEqual(["pinned", "newer", "older"]);
  });

  test("batches: filters, seat availability, hidden internal fields and detail", async () => {
    const world = await createWorld();
    const program = await Program.create({ academy_id: world.academy._id, title: "Beginners", slug: "beginners", status: "published" });
    await Batch.updateOne({ _id: world.batch._id }, { program_id: program._id, skill_level: "beginner" });
    await Batch.updateOne({ _id: world.batch2._id }, { skill_level: "intermediate" });
    const hidden = await Batch.create({ academy_id: world.academy._id, code: "PRV", name: "Private", is_public: false, status: "active" });
    await Batch.create({ academy_id: world.academy._id, code: "OLD", name: "Old", status: "completed" });
    await Batch.create({ academy_id: world.academy._id, code: "AAA", name: "AAA undated", status: "upcoming" });
    const s = await world.student();
    await BatchStudent.create({ batch_id: world.batch._id, student_id: s._id, status: "pending" });

    const all = await request(app).get("/api/v1/public/batches");
    expect(all.status).toBe(200);
    expect(all.body.map((b) => b.code)).toEqual(["BEG", "INT", "AAA"]);
    const beg = all.body[0];
    for (const key of ["academy_id", "created_at", "updated_at", "is_public", "fee_plan_id"]) expect(beg).not.toHaveProperty(key);
    expect(beg).toMatchObject({
      program_title: "Beginners",
      program_slug: "beginners",
      display_price: 4000,
      seats_taken: 1,
      seats_left: 5,
      display_status: "active",
      fee_plan: { id: String(world.plan8._id), name: "8 sessions", base_fee: 4000, number_of_sessions: 8 },
    });
    expect(beg.schedules.map((x) => [x.weekday_name, x.venue_name])).toEqual([["Tuesday", "Venue V1"], ["Thursday", "Venue V1"]]);
    expect(beg.coaches).toEqual([{ coach_id: String(world.coach._id), name: "Coach One", role: "lead", photo_url: null }]);

    const byVenue = await request(app).get(`/api/v1/public/batches?venue_id=${world.venue2._id}`);
    expect(byVenue.body.map((b) => b.code)).toEqual(["INT"]);
    const byProgram = await request(app).get(`/api/v1/public/batches?program_id=${program._id}&skill_level=`);
    expect(byProgram.body.map((b) => b.code)).toEqual(["BEG"]);
    const byLevel = await request(app).get("/api/v1/public/batches?skill_level=intermediate");
    expect(byLevel.body.map((b) => b.code)).toEqual(["INT"]);
    expect((await request(app).get(`/api/v1/public/batches?program_id=${program._id}&venue_id=${world.venue2._id}`)).body).toEqual([]);
    for (const q of ["venue_id=abc", "venue_id=", "program_id=12"]) {
      const r = await request(app).get(`/api/v1/public/batches?${q}`);
      expect(r.status, q).toBe(422);
      expect(r.body.detail[0].loc[0]).toBe("query");
    }

    const one = await request(app).get(`/api/v1/public/batches/${world.batch._id}`);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ id: String(world.batch._id), seats_left: 5 });
    expect(one.body).not.toHaveProperty("academy_id");
    for (const id of [hidden._id, "nope", "0123456789abcdef01234567"]) {
      const r = await request(app).get(`/api/v1/public/batches/${id}`);
      expect(r.status).toBe(404);
      expect(r.body.detail).toBe("Batch not found");
    }
  });

  test("programs list and detail with their batches", async () => {
    const world = await createWorld();
    const p = (title, slug, fields = {}) => Program.create({ academy_id: world.academy._id, title, slug, status: "published", ...fields });
    const comp = await p("Competitive", "competitive", { display_order: 2 });
    await p("Kids", "kids", { display_order: 1 });
    await p("Adults", "adults", { display_order: 1 });
    await p("Draft", "draft", { status: "draft" });
    await Batch.updateOne({ _id: world.batch2._id }, { program_id: comp._id });
    const list = await request(app).get("/api/v1/public/programs");
    expect(list.body.map((x) => x.slug)).toEqual(["adults", "kids", "competitive"]);
    const detail = await request(app).get("/api/v1/public/programs/competitive");
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ id: String(comp._id), title: "Competitive", status: "published" });
    expect(detail.body.batches.map((b) => b.code)).toEqual(["INT"]);
    const draft = await request(app).get("/api/v1/public/programs/draft");
    expect(draft.status).toBe(404);
    expect(draft.body.detail).toBe("Program not found");
  });

  test("fee plans, coaches and venues", async () => {
    const world = await createWorld();
    const acad = world.academy._id;
    const cheap = await FeePlan.create({ academy_id: acad, name: "4 sessions", number_of_sessions: 4, base_fee: 2000, plan_type: "package" });
    await FeePlan.create({ academy_id: acad, name: "Private", number_of_sessions: 1, base_fee: 100, is_public: false });
    await FeePlan.create({ academy_id: acad, name: "Retired", number_of_sessions: 1, base_fee: 50, status: "inactive" });
    const plans = await request(app).get("/api/v1/public/fee-plans");
    expect(plans.body).toEqual([
      { id: String(cheap._id), name: "4 sessions", description: null, plan_type: "package", number_of_sessions: 4, base_fee: 2000, validity_days: null },
      { id: String(world.plan8._id), name: "8 sessions", description: null, plan_type: "monthly", number_of_sessions: 8, base_fee: 4000, validity_days: 31 },
    ]);

    await CoachProfile.updateOne({ _id: world.coach._id }, { display_order: 2, title: "Head coach", profile_bio: "Bio", experience_years: 7 });
    const extra = await User.create({ name: "Aaron", mobile: "9000000013", roles: [{ academy_id: acad, role: "coach" }] });
    await CoachProfile.create({ _id: extra._id, academy_id: acad, display_order: 2 });
    const gone = await User.create({ name: "Gone", mobile: "9000000014", status: "inactive" });
    await CoachProfile.create({ _id: gone._id, academy_id: acad });
    const shy = await User.create({ name: "Shy", mobile: "9000000015" });
    await CoachProfile.create({ _id: shy._id, academy_id: acad, is_public: false });
    const coaches = await request(app).get("/api/v1/public/coaches");
    expect(coaches.body.map((c) => c.name)).toEqual(["Coach Two", "Aaron", "Coach One"]);
    expect(coaches.body[2]).toEqual({
      id: String(world.coach._id),
      name: "Coach One",
      photo_url: null,
      title: "Head coach",
      certifications: null,
      bio: "Bio",
      specialties: null,
      experience_years: 7,
    });

    await Venue.updateOne({ _id: world.venue2._id }, { is_public: false });
    await Venue.create({ academy_id: acad, code: "V0", name: "A Closed Venue", status: "inactive" });
    const venues = await request(app).get("/api/v1/public/venues");
    expect(venues.body).toEqual([
      {
        id: String(world.venue._id),
        name: "Venue V1",
        address: null,
        city: null,
        map_url: null,
        courts_available: 4,
        description: null,
        photo_url: null,
        amenities: null,
      },
    ]);
  });

  test("posts: publish windows, category filter, pagination and full post", async () => {
    const world = await createWorld();
    const img1 = await media(world, { storage_url: "/media/1.webp", thumbnail_url: "/media/1t.webp", caption: "One" });
    const img2 = await media(world, { storage_url: "/media/2.webp", alt_text: "Two" });
    await post(world, {
      title: "Live one",
      slug: "live-one",
      category: "achievement",
      publish_from: daysFromNow(-1),
      body: "Full story",
      summary: "Short",
      image_ids: [img2._id, img1._id],
    });
    await post(world, { title: "Live two", slug: "live-two", category: "tournament", publish_from: daysFromNow(-2) });
    await post(world, { title: "Undated", slug: "undated" });
    await post(world, { title: "Draft", slug: "draft", status: "draft" });
    await post(world, { title: "Expired", slug: "expired", publish_from: daysFromNow(-10), publish_to: daysFromNow(-1) });
    await post(world, { title: "Future", slug: "future", publish_from: daysFromNow(1) });

    const list = await request(app).get("/api/v1/public/posts");
    expect(list.status).toBe(200);
    expect(list.body.items.map((p) => p.slug)).toEqual(["live-one", "live-two", "undated"]);
    expect(list.body).toMatchObject({ has_more: false, page: 1 });
    expect(Object.keys(list.body.items[0]).sort()).toEqual(
      ["category", "cover_image_url", "id", "is_featured", "publish_from", "slug", "summary", "title", "video_url"].sort(),
    );
    expect((await request(app).get("/api/v1/public/posts?category=tournament")).body.items.map((p) => p.slug)).toEqual(["live-two"]);
    const page1 = await request(app).get("/api/v1/public/posts?page_size=2");
    expect(page1.body.items.map((p) => p.slug)).toEqual(["live-one", "live-two"]);
    expect(page1.body.has_more).toBe(true);
    const page2 = await request(app).get("/api/v1/public/posts?page=2&page_size=2");
    expect(page2.body).toMatchObject({ has_more: false, page: 2 });
    expect(page2.body.items.map((p) => p.slug)).toEqual(["undated"]);
    const page0 = await request(app).get("/api/v1/public/posts?page=0&page_size=0");
    expect(page0.body).toMatchObject({ has_more: true, page: 0 });
    expect(page0.body.items.map((p) => p.slug)).toEqual(["live-one"]);
    expect((await request(app).get("/api/v1/public/posts?page_size=500")).body.items).toHaveLength(3);
    for (const q of ["page=", "page=abc", "page=1.5", "page_size=x"]) {
      const r = await request(app).get(`/api/v1/public/posts?${q}`);
      expect(r.status, q).toBe(422);
      expect(r.body.detail[0].loc).toEqual(["query", q.split("=")[0]]);
    }

    const full = await request(app).get("/api/v1/public/posts/live-one");
    expect(full.status).toBe(200);
    expect(full.body).toMatchObject({ slug: "live-one", body: "Full story", summary: "Short", category: "achievement" });
    expect(full.body.images).toEqual([
      { url: "/media/2.webp", thumbnail_url: null, caption: null, alt_text: "Two", media_type: "image" },
      { url: "/media/1.webp", thumbnail_url: "/media/1t.webp", caption: "One", alt_text: null, media_type: "image" },
    ]);
    for (const slug of ["draft", "expired", "future"]) {
      const r = await request(app).get(`/api/v1/public/posts/${slug}`);
      expect(r.status).toBe(404);
      expect(r.body.detail).toBe("Post not found");
    }
  });

  test("gallery albums: cover fallback, previews, item order and drafts", async () => {
    const world = await createWorld();
    const video = await media(world, { media_type: "video", storage_url: "https://youtu.be/x" });
    const hiddenImg = await media(world, { storage_url: "/media/h.webp", status: "deleted" });
    const imgs = [];
    for (let i = 1; i <= 5; i += 1) imgs.push(await media(world, { storage_url: `/media/${i}.webp`, thumbnail_url: i === 2 ? "/media/2t.webp" : null }));
    const cover = await media(world, { storage_url: "/media/cover.webp", thumbnail_url: "/media/cover-t.webp" });
    const ids = [video, hiddenImg, imgs[1], imgs[0], imgs[2], imgs[3], imgs[4]].map((m) => m._id);
    const album = (fields) => GalleryAlbum.create({ academy_id: world.academy._id, status: "published", ...fields });
    await album({ title: "Second", slug: "second", display_order: 1, cover_media_id: cover._id, media_ids: [imgs[0]._id] });
    await album({ title: "First", slug: "first", display_order: 0, media_ids: ids });
    await album({ title: "Draft", slug: "draft", status: "draft" });

    const list = await request(app).get("/api/v1/public/gallery");
    expect(list.status).toBe(200);
    expect(list.body.map((a) => a.slug)).toEqual(["first", "second"]);
    const [first, second] = list.body;
    expect(first).toMatchObject({ title: "First", description: null, count: 7, cover_url: "/media/2t.webp" });
    expect(first.items.map((m) => m.id)).toEqual([video, imgs[1], imgs[0], imgs[2]].map((m) => String(m._id)));
    expect(Object.keys(first.items[0]).sort()).toEqual(
      ["alt_text", "caption", "height", "id", "media_type", "storage_url", "thumbnail_url", "width"].sort(),
    );
    expect(second).toMatchObject({ count: 1, cover_url: "/media/cover-t.webp" });

    const detail = await request(app).get("/api/v1/public/gallery/first");
    expect(detail.body.items.map((m) => m.storage_url)).toEqual([
      "https://youtu.be/x",
      "/media/2.webp",
      "/media/1.webp",
      "/media/3.webp",
      "/media/4.webp",
      "/media/5.webp",
    ]);
    const draft = await request(app).get("/api/v1/public/gallery/draft");
    expect(draft.status).toBe(404);
    expect(draft.body.detail).toBe("Album not found");
  });

  test("events: upcoming by default, past on request, detail with venue", async () => {
    const world = await createWorld();
    const ev = (title, slug, fields) => Event.create({ academy_id: world.academy._id, title, slug, status: "published", ...fields });
    await ev("Upcoming", "upcoming", { event_date: "2026-10-20", venue_id: world.venue._id });
    await ev("Ongoing", "ongoing", { event_date: "2026-10-10", end_date: "2026-10-16" });
    await ev("Past", "past", { event_date: "2026-09-01", end_date: "2026-09-02" });
    await ev("Draft", "draft", { event_date: "2026-11-01", status: "draft" });
    expect((await request(app).get("/api/v1/public/events")).body.map((e) => e.slug)).toEqual(["ongoing", "upcoming"]);
    expect((await request(app).get("/api/v1/public/events?include_past=true")).body.map((e) => e.slug)).toEqual(["past", "ongoing", "upcoming"]);
    expect((await request(app).get("/api/v1/public/events?include_past=Yes")).body).toHaveLength(3);
    expect((await request(app).get("/api/v1/public/events?include_past=0")).body).toHaveLength(2);
    for (const q of ["maybe", "", "2"]) {
      expect((await request(app).get(`/api/v1/public/events?include_past=${q}`)).status, q).toBe(422);
    }
    const detail = await request(app).get("/api/v1/public/events/upcoming");
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ title: "Upcoming", event_date: "2026-10-20", venue_id: String(world.venue._id) });
    expect(detail.body.venue).toEqual({ name: "Venue V1", address: null, map_url: null });
    expect((await request(app).get("/api/v1/public/events/past")).body.venue).toBeNull();
    const draft = await request(app).get("/api/v1/public/events/draft");
    expect(draft.status).toBe(404);
    expect(draft.body.detail).toBe("Event not found");
  });

  test("testimonials and faqs: published only, in display order", async () => {
    const world = await createWorld();
    const acad = world.academy._id;
    await Testimonial.create({ academy_id: acad, author_name: "B", quote: "q", status: "published", display_order: 1 });
    await Testimonial.create({ academy_id: acad, author_name: "A", quote: "q", status: "published", display_order: 0 });
    await Testimonial.create({ academy_id: acad, author_name: "C", quote: "q", status: "published", display_order: 1 });
    await Testimonial.create({ academy_id: acad, author_name: "Draft", quote: "q" });
    await Faq.create({ academy_id: acad, question: "Second?", answer: "a", display_order: 2 });
    await Faq.create({ academy_id: acad, question: "First?", answer: "a", display_order: 1 });
    await Faq.create({ academy_id: acad, question: "Hidden?", answer: "a", status: "draft" });
    expect((await request(app).get("/api/v1/public/testimonials")).body.map((t) => t.author_name)).toEqual(["A", "C", "B"]);
    const faqs = await request(app).get("/api/v1/public/faqs");
    expect(faqs.body.map((f) => f.question)).toEqual(["First?", "Second?"]);
    expect(faqs.body[0]).toMatchObject({ answer: "a", status: "published" });
  });

  test("homepage aggregate", async () => {
    const world = await createWorld();
    const acad = world.academy._id;
    await Program.create({ academy_id: acad, title: "Kids", slug: "kids", status: "published" });
    await post(world, { title: "Old featured", slug: "old-featured", is_featured: true, publish_from: daysFromNow(-9) });
    for (let i = 1; i <= 6; i += 1) await post(world, { title: `News ${i}`, slug: `news-${i}`, publish_from: daysFromNow(-i) });
    for (let i = 0; i < 10; i += 1) await Testimonial.create({ academy_id: acad, author_name: `T${i}`, quote: "q", status: "published" });
    for (let i = 0; i < 9; i += 1) await Faq.create({ academy_id: acad, question: `Q${i}?`, answer: "a", display_order: i });
    await Event.create({ academy_id: acad, title: "Soon", slug: "soon", event_date: "2026-10-18", status: "published" });
    await Event.create({ academy_id: acad, title: "Ongoing", slug: "ongoing", event_date: "2026-10-10", end_date: "2026-10-20", status: "published" });
    const reel = await media(world, { media_type: "video", storage_url: "https://www.instagram.com/reel/abc/" });
    const loose = await media(world, { media_type: "video", storage_url: "https://youtu.be/loose" });
    const photos = [];
    for (let i = 0; i < 7; i += 1) photos.push(await media(world, { storage_url: `/media/p${i}.webp` }));
    for (let i = 0; i < 5; i += 1) {
      await GalleryAlbum.create({
        academy_id: acad,
        title: `Album ${i}`,
        slug: `album-${i}`,
        status: "published",
        display_order: i,
        media_ids: i === 0 ? [reel._id, ...photos.map((p) => p._id)] : [],
      });
    }
    await GalleryAlbum.create({ academy_id: acad, title: "Draft", slug: "draft-album", media_ids: [loose._id] });
    await Announcement.create({ academy_id: acad, title: "Hello", message: "m", status: "published" });

    const r = await request(app).get("/api/v1/public/home");
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(
      ["academy", "albums", "announcements", "batches", "coaches", "content", "events", "faqs", "payment", "posts", "programs", "testimonials", "venues", "videos"].sort(),
    );
    expect(r.body.academy.name).toBe("LuvAll Sports");
    expect(r.body.announcements.map((a) => a.title)).toEqual(["Hello"]);
    expect(r.body.programs.map((p) => p.slug)).toEqual(["kids"]);
    expect(r.body.posts.map((p) => p.slug)).toEqual(["old-featured", "news-1", "news-2", "news-3", "news-4", "news-5"]);
    expect(r.body.testimonials).toHaveLength(9);
    expect(r.body.faqs.map((f) => f.question)).toEqual(["Q0?", "Q1?", "Q2?", "Q3?", "Q4?", "Q5?", "Q6?", "Q7?"]);
    expect(r.body.events.map((e) => e.slug)).toEqual(["soon"]);
    expect(r.body.albums.map((a) => a.slug)).toEqual(["album-0", "album-1", "album-2", "album-3"]);
    expect(r.body.albums[0].items).toHaveLength(6);
    expect(r.body.albums[0].count).toBe(8);
    expect(r.body.albums[0].cover_url).toBe("/media/p0.webp");
    expect(r.body.albums[1]).toMatchObject({ count: 0, cover_url: null, items: [] });
    expect(r.body.videos.map((v) => v.id)).toEqual([String(reel._id)]);
    expect(r.body.batches.map((b) => b.code)).toEqual(["BEG", "INT"]);
    expect(r.body.coaches.map((c) => c.name)).toEqual(["Coach One", "Coach Two"]);
    expect(r.body.venues.map((v) => v.name)).toEqual(["Venue V1", "Venue V2"]);
  });

  test("enquiries: validation, contact required and rate limit", async () => {
    await createWorld();
    const send = (body, ip = "10.0.0.1") => request(app).post("/api/v1/public/enquiries").set("X-Forwarded-For", ip).send(body);
    const ok = await send({ name: "Asha", email: "Asha.K@Example.COM", message: "Interested in kids batch" });
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ ok: true });
    const saved = await Enquiry.findOne();
    expect(saved).toMatchObject({ name: "Asha", email: "Asha.K@example.com", mobile: null, status: "new" });
    const noContact = await send({ name: "Asha", message: "Call me back please" });
    expect(noContact.status).toBe(400);
    expect(noContact.body.detail).toBe("Share a mobile number or email so we can reply");
    expect((await send({ name: "A", email: "bad", message: "hey" })).status).toBe(422);

    for (let i = 0; i < 5; i += 1) expect((await send({ name: "Ravi", mobile: "9876543210", message: "Hello there" }, "10.0.0.2")).status).toBe(201);
    const limited = await send({ name: "Ravi", mobile: "9876543210", message: "Hello there" }, "10.0.0.2");
    expect(limited.status).toBe(429);
    expect(limited.body.detail).toBe("Too many messages. Please try again later.");
    expect(await Enquiry.countDocuments()).toBe(6);
  });

  test("sitemap lists public content", async () => {
    const world = await createWorld();
    const acad = world.academy._id;
    await Program.create({ academy_id: acad, title: "Kids", slug: "kids", status: "published" });
    await Program.create({ academy_id: acad, title: "Draft", slug: "draft-program" });
    await post(world, { title: "Live", slug: "live" });
    await post(world, { title: "Gone", slug: "gone", publish_to: daysFromNow(-1) });
    await GalleryAlbum.create({ academy_id: acad, title: "Pics", slug: "pics", status: "published" });
    await Event.create({ academy_id: acad, title: "Past", slug: "past", event_date: "2026-01-01", status: "published" });
    await Batch.create({ academy_id: acad, code: "PRV", name: "Private", is_public: false, status: "active" });
    const r = await request(app).get("/api/v1/public/sitemap");
    expect(r.body).toEqual({
      programs: ["kids"],
      posts: ["live"],
      albums: ["pics"],
      events: ["past"],
      batches: [String(world.batch._id), String(world.batch2._id)],
    });
  });
});

describe("robots, sitemap and the SEO app shell", () => {
  test("robots.txt and sitemap.xml work with or without an academy", async () => {
    const robots = await request(app).get("/robots.txt");
    expect(robots.status).toBe(200);
    expect(robots.headers["content-type"]).toMatch(/text\/plain/);
    expect(robots.text).toBe(
      "User-Agent: *\nAllow: /\nDisallow: /admin\nDisallow: /coach\nDisallow: /student\nDisallow: /account\nDisallow: /api/\n\n" +
        `Sitemap: ${base}/sitemap.xml\n`,
    );
    const bare = await request(app).get("/sitemap.xml");
    expect(bare.status).toBe(200);
    expect(bare.headers["content-type"]).toMatch(/application\/xml/);
    expect(bare.text).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">\n/);
    expect(bare.text).toContain(`<url>\n<loc>${base}</loc>\n<changefreq>weekly</changefreq>\n<priority>1</priority>\n</url>\n`);
    expect(bare.text).toContain(`<loc>${base}/contact</loc>\n<changefreq>weekly</changefreq>\n<priority>0.7</priority>`);
    expect(bare.text.match(/<url>/g)).toHaveLength(11);

    const world = await createWorld();
    await Program.create({ academy_id: world.academy._id, title: "Kids", slug: "kids", status: "published" });
    await post(world, { title: "Live", slug: "live" });
    const full = await request(app).get("/sitemap.xml");
    expect(full.text).toContain(`<url>\n<loc>${base}/programs/kids</loc>\n</url>`);
    expect(full.text).toContain(`<loc>${base}/news/live</loc>`);
    expect(full.text).toContain(`<loc>${base}/batches/${world.batch._id}</loc>`);
    expect(full.text.match(/<url>/g)).toHaveLength(11 + 4);
  });

  test("index.html gets route-aware meta tags; /api, /media and assets are not intercepted", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "luvall-client-"));
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "assets", "app-abc123.js"), "console.log('app');");
    fs.writeFileSync(
      path.join(dir, "index.html"),
      '<!doctype html>\n<html lang="en-IN">\n  <head>\n    <meta charset="UTF-8" />\n    <!--seo-->\n    <title>Default</title>\n    <!--/seo-->\n' +
        '    <script type="module" src="/assets/app-abc123.js"></script>\n  </head>\n  <body><div id="root"></div></body>\n</html>\n',
    );
    const previous = config.clientDist;
    config.clientDist = dir;
    let web;
    try {
      web = createApp();
    } finally {
      config.clientDist = previous;
    }

    const world = await createWorld();
    await Academy.updateOne(
      { _id: world.academy._id },
      { site_content: { seo_title: "LuvAll — Play better", seo_description: "Batches for all", hero_image_url: "/media/hero.webp" } },
    );
    await post(world, {
      title: 'Gold & "Glory" <win>',
      slug: "gold",
      summary: "State $& champions",
      cover_image_url: "/media/cover.webp",
      publish_from: daysFromNow(-1),
    });

    const news = await request(web).get("/news/gold");
    expect(news.status).toBe(200);
    expect(news.headers["content-type"]).toMatch(/text\/html/);
    const title = "Gold &amp; &quot;Glory&quot; &lt;win&gt; · LuvAll Sports";
    expect(news.text).toContain(`<title>${title}</title>`);
    expect(news.text).toContain('<meta name="description" content="State $&amp; champions" />');
    expect(news.text).toContain(`<meta property="og:title" content="${title}" />`);
    expect(news.text).toContain('<meta property="og:description" content="State $&amp; champions" />');
    expect(news.text).toContain(`<meta property="og:image" content="${base}/media/cover.webp" />`);
    expect(news.text).toContain('<meta property="og:type" content="article" />');
    expect(news.text).toContain(`<link rel="canonical" href="${base}/news/gold" />`);
    expect(news.text).not.toContain("<title>Default</title>");
    expect(news.text).not.toContain("noindex");
    expect(news.text).toContain('<script type="module" src="/assets/app-abc123.js"></script>');
    expect(news.text.match(/<title>/g)).toHaveLength(1);

    const home = await request(web).get("/");
    expect(home.text).toContain("<title>LuvAll — Play better</title>");
    expect(home.text).toContain('<meta name="description" content="Batches for all" />');
    expect(home.text).toContain(`<meta property="og:image" content="${base}/media/hero.webp" />`);
    expect(home.text).toContain('<meta property="og:type" content="website" />');
    expect(home.text).toContain(`<link rel="canonical" href="${base}/" />`);

    const about = await request(web).get("/about/");
    expect(about.text).toContain("<title>About · LuvAll Sports</title>");
    expect(about.text).toContain('<meta name="description" content="About the LuvAll Sports pickleball academy." />');
    expect(about.text).toContain(`<link rel="canonical" href="${base}/about" />`);

    const batch = await request(web).get(`/batches/${world.batch._id}`);
    expect(batch.text).toContain("<title>Batch BEG · LuvAll Sports</title>");
    expect(batch.text).toContain('content="Batch BEG — — pickleball batch. 6 seats left."');

    const signIn = await request(web).get("/login");
    expect(signIn.text).toContain("<title>Sign in · LuvAll Sports</title>");
    expect(signIn.text).toContain('<meta name="robots" content="noindex" />');

    const portal = await request(web).get("/admin/students");
    expect(portal.status).toBe(200);
    expect(portal.text).toContain('<meta name="robots" content="noindex" />');
    expect(portal.text).not.toContain('rel="canonical"');
    expect(portal.text).toContain("<title>Admin · LuvAll Sports</title>");
    expect(portal.text).toContain('<meta name="description" content="Pickleball coaching batches for every level." />');
    expect(portal.text).not.toContain("og:image");
    expect((await request(web).get("/student")).text).toContain("<title>Student · LuvAll Sports</title>");
    expect((await request(web).get("/coach/sessions/abc")).text).toContain("<title>Coach · LuvAll Sports</title>");
    const account = await request(web).get("/account");
    expect(account.text).toContain("<title>LuvAll Sports — Pickleball Academy</title>");
    expect(account.text).toContain('<meta name="robots" content="noindex" />');
    // Not a portal: only the exact prefix or a sub-path counts.
    expect((await request(web).get("/coaches")).text).not.toContain("noindex");
    const coaches = await request(web).get("/coaches");
    expect(coaches.text).toContain("<title>Coaches · LuvAll Sports</title>");
    expect(coaches.text).not.toContain("noindex");

    const missing = await request(web).get("/news/does-not-exist");
    expect(missing.status).toBe(404);
    expect(missing.text).toContain('<meta name="robots" content="noindex" />');
    expect(missing.text).toContain("<title>LuvAll — Play better</title>");
    const garbled = await request(web).get("/news/%E0%A4%A");
    expect(garbled.status).toBe(200);
    expect(garbled.text).toContain("<title>LuvAll — Play better</title>");
    const unknown = await request(web).get("/no-such-page");
    expect(unknown.status).toBe(404);
    expect(unknown.headers["content-type"]).toMatch(/text\/html/);
    expect(unknown.text).toContain('<meta name="robots" content="noindex" />');
    expect(unknown.text).toContain('<div id="root"></div>');
    expect((await request(web).get("/news/gold/extra")).status).toBe(404);
    expect((await request(web).get(`/batches/${world.batch._id}x`)).status).toBe(404);

    const shell = await request(web).get("/index.html");
    expect(shell.status).toBe(200);
    expect(shell.text).toContain("<title>LuvAll — Play better</title>");
    expect(shell.text).toContain(`<link rel="canonical" href="${base}/" />`);

    const head = await request(web).head("/about");
    expect(head.status).toBe(200);
    expect(head.headers["content-type"]).toMatch(/text\/html/);
    expect(head.headers["cache-control"]).toBe("no-cache");
    expect((await request(web).post("/about")).status).toBe(404);

    // Other detail pages: titles and descriptions from the content item.
    const acad = world.academy._id;
    await Program.create({ academy_id: acad, title: "Kids", slug: "kids", summary: "For juniors", image_url: "https://cdn.example/kids.jpg", status: "published" });
    await Event.create({ academy_id: acad, title: "Open", slug: "open", event_date: "2026-11-01", description: "x".repeat(200), status: "published" });
    const cover = await media(world, { storage_url: "/media/a.webp", thumbnail_url: "/media/a-t.webp" });
    await GalleryAlbum.create({ academy_id: acad, title: "Finals", slug: "finals", description: "Final day", media_ids: [cover._id], status: "published" });
    const program = await request(web).get("/programs/kids");
    expect(program.text).toContain("<title>Kids · LuvAll Sports</title>");
    expect(program.text).toContain('<meta name="description" content="For juniors" />');
    expect(program.text).toContain('<meta property="og:image" content="https://cdn.example/kids.jpg" />');
    const event = await request(web).get("/events/open");
    expect(event.text).toContain(`<meta name="description" content="${"x".repeat(160)}" />`);
    const album = await request(web).get("/gallery/finals");
    expect(album.text).toContain("<title>Finals · LuvAll Sports</title>");
    expect(album.text).toContain(`<meta property="og:image" content="${base}/media/a-t.webp" />`);
    expect((await request(web).get("/programs/nope")).status).toBe(404);
    await Batch.updateOne({ _id: world.batch2._id }, { is_public: false });
    expect((await request(web).get(`/batches/${world.batch2._id}`)).status).toBe(404);

    // A rebuilt client (new index.html) is picked up without a restart.
    const rebuilt = fs.readFileSync(path.join(dir, "index.html"), "utf8").replace("app-abc123.js", "app-def456.js");
    fs.writeFileSync(path.join(dir, "index.html"), rebuilt);
    const later = new Date(Date.now() + 60000);
    fs.utimesSync(path.join(dir, "index.html"), later, later);
    const reloaded = await request(web).get("/faq");
    expect(reloaded.text).toContain("/assets/app-def456.js");
    expect(reloaded.text).toContain("<title>FAQs · LuvAll Sports</title>");

    const asset = await request(web).get("/assets/app-abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers["cache-control"]).toMatch(/max-age=31536000/);
    expect(asset.headers["cache-control"]).toMatch(/immutable/);
    expect((await request(web).get("/assets/missing.js")).status).toBe(404);

    const api = await request(web).get("/api/v1/nope");
    expect(api.status).toBe(404);
    expect(api.body).toEqual({ detail: "Not Found" });
    const mediaFile = await request(web).get("/media/nothing.webp");
    expect(mediaFile.status).toBe(404);
    expect(mediaFile.headers["content-type"]).not.toMatch(/text\/html/);
    expect((await request(web).get("/robots.txt")).text).toContain("Disallow: /admin");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
