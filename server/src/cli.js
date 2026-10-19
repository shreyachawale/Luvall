/**
 * Operational commands.
 *
 *   npm run cli -- init --admin-mobile 98xxxxxxxx --admin-password '...' [--admin-name ...] [--admin-email ...]
 *   npm run cli -- demo             # load sample data (development / UAT only)
 *   npm run cli -- create-admin ...
 *   npm run cli -- import-students students.csv
 *   npm run cli -- send-reminders
 */

import fs from "node:fs";
import readline from "node:readline";

import { config } from "./config.js";
import { connect, disconnect, ensureIndexes, withTransaction } from "./db.js";
import { courtPhoto, seededRandom } from "./demo-art.js";
import {
  Academy,
  Announcement,
  Batch,
  CoachProfile,
  Expense,
  Faq,
  FeePlan,
  GalleryAlbum,
  MakeupCredit,
  MediaAsset,
  Payment,
  Post,
  Program,
  sameId,
  Session,
  StudentProfile,
  Testimonial,
  User,
  Venue,
} from "./models/index.js";
import * as attSvc from "./services/attendance.js";
import * as batchSvc from "./services/batches.js";
import * as ledger from "./services/ledger.js";
import * as media from "./services/media.js";
import { sendReminders } from "./services/notifications.js";
import * as rates from "./services/rates.js";
import { BusinessRules, businessRules, SiteContent } from "./services/rules.js";
import { hashPassword } from "./services/security.js";
import { now, today } from "./utils/clock.js";
import { addDays, monthEnd, monthStart } from "./utils/dates.js";
import { normalizeMobile } from "./utils/validate.js";

class CliError extends Error {}

const fail = (message) => {
  throw new CliError(message);
};

async function ensureAcademy() {
  const code = config.defaultAcademyCode;
  const existing = await Academy.findOne({ code });
  if (existing) return existing;
  return Academy.create({
    code,
    name: "LuvAll Sports",
    sport_scope: "pickleball",
    description: "Pickleball coaching academy",
    settings: BusinessRules.parse({}),
    site_content: SiteContent.parse({}),
  });
}

async function defaultAcademy() {
  const academy = await Academy.findOne({ code: config.defaultAcademyCode });
  if (!academy) fail("No academy yet. Run `npm run cli -- init` first.");
  return academy;
}

/** Create (or reset the password of) a user and give them a role in the academy. */
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
  if (!user.roles.some((r) => sameId(r.academy_id, academy._id) && r.role === role)) {
    user.roles.push({ academy_id: academy._id, role });
  }
  await user.save();
  return user;
}

/** Read a line from the terminal without echoing it. */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function cmdInit(opts) {
  let password = null;
  if (opts["admin-mobile"]) {
    password = opts["admin-password"] ?? (await promptHidden("Admin password: "));
    if (password.length < 8) fail("Password must be at least 8 characters");
  }
  const academy = await withTransaction(async () => {
    const a = await ensureAcademy();
    if (opts["admin-mobile"]) {
      await createUser(a, {
        name: opts["admin-name"] || "Academy Admin",
        mobile: normalizeMobile(opts["admin-mobile"]),
        role: "admin",
        password,
        email: opts["admin-email"]?.trim().toLowerCase() || null,
      });
    }
    return a;
  });
  console.log(`Academy '${academy.name}' ready.`);
}

async function cmdSendReminders() {
  const academy = await defaultAcademy();
  console.log(`Queued ${await sendReminders(academy)} reminder(s).`);
}

/** Minimal RFC 4180 CSV reader: quoted fields, doubled quotes, CRLF, a UTF-8 BOM. Returns rows of strings. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** CSV columns: name,mobile,email,skill_level,opening_balance (opening balance: + credit / - dues). */
async function cmdImportStudents(opts, [path]) {
  if (!path) fail("Usage: import-students <file.csv>");
  const [header, ...records] = parseCsv(fs.readFileSync(path, "utf8"));
  if (!header) fail("The CSV file is empty");
  const columns = header.map((h) => h.trim());
  const academy = await defaultAcademy();
  const [created, skipped] = await withTransaction(async () => {
    let made = 0;
    let skip = 0;
    for (const [index, values] of records.entries()) {
      const line = index + 2;
      const rec = Object.fromEntries(columns.map((c, i) => [c, values[i] ?? ""]));
      let mobile;
      try {
        mobile = normalizeMobile(rec.mobile);
      } catch {
        console.log(`line ${line}: invalid mobile, skipped`);
        skip += 1;
        continue;
      }
      if (await User.exists({ mobile })) {
        console.log(`line ${line}: ${mobile} already exists, skipped`);
        skip += 1;
        continue;
      }
      const opening = (rec.opening_balance ?? "").trim();
      if (opening && !Number.isFinite(Number(opening))) {
        console.log(`line ${line}: invalid opening balance, skipped`);
        skip += 1;
        continue;
      }
      const user = await createUser(academy, {
        name: (rec.name ?? "").trim(),
        mobile,
        role: "student",
        email: (rec.email ?? "").trim().toLowerCase() || null,
      });
      await StudentProfile.create({
        _id: user._id,
        academy_id: academy._id,
        skill_level: rec.skill_level || null,
        source: "admin",
      });
      if (opening) {
        await ledger.post({
          academyId: academy._id,
          studentId: user._id,
          txnType: "opening_balance",
          amount: Number(opening),
          description: "Opening balance (migrated)",
        });
      }
      made += 1;
    }
    return [made, skip];
  });
  console.log(`Imported ${created} students, skipped ${skipped}.`);
}

// --- Demo data ------------------------------------------------------------------------------------------------

// Every demo image: [seed, scene, caption]. They are rendered and stored before the database transaction
// starts, because files written inside it would be duplicated if the transaction is retried.
const DEMO_IMAGES = [
  [1, "corner", "Players at an evening batch"],
  [2, "aerial", "Academy players after a session"],
  [10, "aerial", "Courtside Arena courts"],
  [11, "aerial", "Baseline Club courts"],
  [12, "aerial", "Greenfield Sports Park courts"],
  [20, "flatlay", "Coach Arjun Mehta"],
  [21, "flatlay", "Coach Priya Nair"],
  [22, "flatlay", "Coach Rahul Verma"],
  [30, "corner", "Beginner Foundations"],
  [31, "net", "Intermediate Skills"],
  [32, "aerial", "Advanced Competitive"],
  [33, "flatlay", "Kids Pickleball"],
  ...Array.from({ length: 8 }, (_, i) => [
    40 + i,
    ["net", "flatlay", "corner", "aerial"][i % 4],
    ["Footwork drills", "Weekend match play", "Kids batch fun", "Serve clinic"][i % 4],
  ]),
  [60, "corner", "Podium at the state championship"],
  [61, "aerial", "Tournament courts"],
  [62, "net", "Baseline Club courts"],
];

const STUDENT_NAMES = [
  "Aarav Sharma", "Ananya Iyer", "Vihaan Gupta", "Diya Reddy", "Kabir Singh", "Isha Kapoor", "Reyansh Joshi",
  "Meera Pillai", "Arjun Rao", "Saanvi Menon", "Dhruv Malhotra", "Tara Desai", "Neil Fernandes", "Kiara Bose",
  "Rohan Kulkarni", "Aditi Chawla", "Yash Patil", "Nisha Agarwal",
];

const DAY_MS = 86400000;

async function cmdDemo() {
  const existing = await Academy.findOne({ code: config.defaultAcademyCode });
  if (existing && (await Batch.exists({ academy_id: existing._id }))) fail("Demo data already loaded (batches exist).");

  const stored = new Map();
  for (const [seed, scene] of DEMO_IMAGES) stored.set(seed, await media.storeImage(await courtPhoto(seed, scene), "demo"));

  await withTransaction(() => loadDemo(stored));
  console.log("Demo data loaded.");
  console.log("  Admin:   9000000001 / Admin@12345");
  console.log("  Coach:   9000000011 / Coach@12345");
  console.log("  Student: 9000000100 / Student@123");
}

async function loadDemo(stored) {
  const rnd = seededRandom(7);
  const academy = await ensureAcademy();
  if (await Batch.exists({ academy_id: academy._id })) fail("Demo data already loaded (batches exist).");
  const t = today();

  const addImage = async (seed) => {
    const img = stored.get(seed);
    const caption = DEMO_IMAGES.find(([s]) => s === seed)[2];
    return MediaAsset.create({
      academy_id: academy._id,
      media_type: "image",
      storage_url: img.url,
      thumbnail_url: img.thumbnail_url,
      caption,
      alt_text: caption,
      width: img.width,
      height: img.height,
      size_bytes: img.size_bytes,
    });
  };

  academy.location = "Bengaluru, Karnataka";
  academy.contact_no = "9000000001";
  academy.email = "hello@luvallsports.example";
  academy.owner_name = "LuvAll Sports";
  academy.settings = BusinessRules.parse({
    payment: { upi_id: "luvallsports@upi", payee_name: "LuvAll Sports", whatsapp_number: "919000000001" },
  });
  const hero = await addImage(1);
  const about = await addImage(2);
  academy.site_content = SiteContent.parse({
    hero_image_url: hero.storage_url,
    about_image_url: about.storage_url,
    contact_phone: "+91 90000 00001",
    contact_email: "hello@luvallsports.example",
    contact_address: "Courtside Arena, 12 Lake View Road, Bengaluru",
    instagram_url: "https://www.instagram.com/",
    youtube_url: "https://www.youtube.com/",
  });
  await academy.save();

  const admin = await createUser(academy, {
    name: "Academy Admin",
    mobile: "9000000001",
    role: "admin",
    password: "Admin@12345",
    email: "admin@luvallsports.example",
  });

  const venues = [];
  for (const [i, [code, name, area, courts, r]] of [
    ["CSA", "Courtside Arena", "Koramangala", 4, [600, 800, 900, 1000]],
    ["BLC", "Baseline Club", "Indiranagar", 3, [500, 700, 800, 900]],
    ["GSP", "Greenfield Sports Park", "Whitefield", 2, [450, 650, 700, 800]],
  ].entries()) {
    const photo = await addImage(10 + i);
    const v = await Venue.create({
      academy_id: academy._id,
      code,
      name,
      address: `${12 + i * 7} Main Road, ${area}`,
      city: "Bengaluru",
      courts_available: courts,
      photo_url: photo.storage_url,
      description: `${courts} dedicated pickleball courts with floodlights.`,
      amenities: "Floodlights, parking, drinking water, changing rooms",
      map_url: `https://maps.google.com/?q=${name.replaceAll(" ", "+")}`,
    });
    const cells = [["weekday", "morning"], ["weekday", "evening"], ["weekend", "morning"], ["weekend", "evening"]];
    for (const [k, [dayType, slot]] of cells.entries()) await rates.setVenueRate(v, dayType, slot, r[k], "2026-01-01");
    venues.push(v);
  }

  const coaches = [];
  for (const [i, [name, title, rate, certs]] of [
    ["Arjun Mehta", "Head Coach", 800, "PPR Certified Coach, IPA Level 2"],
    ["Priya Nair", "Senior Coach", 700, "PPR Certified Coach"],
    ["Rahul Verma", "Coach", 600, "IPA Level 1, First Aid"],
  ].entries()) {
    const u = await createUser(academy, { name, mobile: `90000000${11 + i}`, role: "coach", password: "Coach@12345" });
    const photo = await addImage(20 + i);
    u.photo_url = photo.storage_url;
    await u.save();
    const first = name.split(" ")[0];
    await CoachProfile.create({
      _id: u._id,
      academy_id: academy._id,
      title,
      certifications: certs,
      profile_bio:
        `${first} has coached hundreds of players from first serve to ` +
        "tournament play, with a focus on footwork, dinking and game strategy.",
      specialties: "Dinking, third-shot drops, doubles strategy",
      experience_years: 8 - i * 2,
      display_order: i,
    });
    await rates.setCoachRate(u._id, rate, "2026-01-01");
    coaches.push(u);
  }

  const programs = {};
  for (const [i, [slug, title, level, summary]] of [
    ["beginner-foundations", "Beginner Foundations", "beginner",
      "Grip, serve, return and the kitchen rules — everything you need to play your first games."],
    ["intermediate-skills", "Intermediate Skills", "intermediate",
      "Third-shot drops, resets and doubles positioning for confident rally play."],
    ["advanced-competitive", "Advanced Competitive", "advanced",
      "Match play, drills at pace and tournament preparation for competitive players."],
    ["kids-pickleball", "Kids Pickleball", "kids",
      "Fun, game-based sessions for ages 8–14 that build coordination and love for the sport."],
  ].entries()) {
    const img = await addImage(30 + i);
    programs[level] = await Program.create({
      academy_id: academy._id,
      slug,
      title,
      skill_level: level,
      summary,
      description: `${summary} Small batches of 4–6 players mean plenty of ball time and individual feedback every session.`,
      image_url: img.storage_url,
      display_order: i,
      status: "published",
      age_group: level === "kids" ? "8–14 years" : "15+ years",
    });
  }

  const plan8 = await FeePlan.create({
    academy_id: academy._id,
    name: "Monthly — 8 sessions",
    plan_type: "monthly",
    number_of_sessions: 8,
    base_fee: 4000,
    validity_days: 31,
    description: "Two sessions a week for a month",
  });
  const plan12 = await FeePlan.create({
    academy_id: academy._id,
    name: "Monthly — 12 sessions",
    plan_type: "monthly",
    number_of_sessions: 12,
    base_fee: 5400,
    validity_days: 31,
    description: "Three sessions a week for a month",
  });
  const plan4 = await FeePlan.create({
    academy_id: academy._id,
    name: "Kids — 4 sessions",
    plan_type: "monthly",
    number_of_sessions: 4,
    base_fee: 2000,
    validity_days: 31,
  });

  const mStart = monthStart(t);
  const mEnd = monthEnd(t);
  const nextStart = addDays(mEnd, 1);
  const nextEnd = monthEnd(nextStart);

  const mkBatch = (code, name, level, plan, maxPlayers, schedules, coachList, period = [mStart, mEnd], status = "active") =>
    Batch.create({
      academy_id: academy._id,
      code,
      name,
      program_id: programs[level]._id,
      skill_level: level,
      period_label: period[0].slice(0, 7),
      start_date: period[0],
      end_date: period[1],
      duration_minutes: 60,
      min_players: 4,
      max_players: maxPlayers,
      fee_plan_id: plan._id,
      status,
      description: `${programs[level].title} batch.`,
      schedules: schedules.map(([weekday, start, end, venue, courts]) => ({
        weekday,
        start_time: start,
        end_time: end,
        venue_id: venue._id,
        courts,
      })),
      coaches: coachList.map(([c, role]) => ({ coach_id: c._id, role })),
    });

  const tueThu = (start, end, venue) => [[1, start, end, venue, 2], [3, start, end, venue, 2]];
  const beg = await mkBatch("BEG-TT", "Beginners — Tue/Thu Evening", "beginner", plan8, 6,
    tueThu("17:00", "18:00", venues[0]), [[coaches[0], "lead"]]);
  const inter = await mkBatch("INT-MWF", "Intermediate — Mon/Wed/Fri Morning", "intermediate", plan12, 6,
    [0, 2, 4].map((d) => [d, "07:00", "08:30", venues[1], 2]), [[coaches[1], "lead"], [coaches[2], "assistant"]]);
  const adv = await mkBatch("ADV-WE", "Advanced — Weekend Morning", "advanced", plan8, 6,
    [[5, "07:00", "09:00", venues[0], 2], [6, "07:00", "09:00", venues[0], 2]], [[coaches[0], "lead"]]);
  const kids = await mkBatch("KIDS-SAT", "Kids — Saturday Evening", "kids", plan4, 8,
    [[5, "16:00", "17:00", venues[2], 1]], [[coaches[2], "lead"]]);
  const nxt = await mkBatch("BEG-TT", "Beginners — Tue/Thu Evening", "beginner", plan8, 6,
    tueThu("17:00", "18:00", venues[0]), [[coaches[0], "lead"]], [nextStart, nextEnd], "upcoming");
  const nxtEve = await mkBatch("INT-TT-E", "Intermediate — Tue/Thu Evening", "intermediate", plan8, 6,
    tueThu("18:30", "19:30", venues[1]), [[coaches[1], "lead"]], [nextStart, nextEnd], "upcoming");

  const students = [];
  for (const [i, name] of STUDENT_NAMES.entries()) {
    const u = await createUser(academy, {
      name,
      mobile: `90000001${String(i).padStart(2, "0")}`,
      role: "student",
      password: i === 0 ? "Student@123" : null,
      email: i < 6 ? `${name.split(" ")[0].toLowerCase()}@example.com` : null,
    });
    students.push(
      await StudentProfile.create({
        _id: u._id,
        academy_id: academy._id,
        source: "admin",
        skill_level: ["beginner", "intermediate", "advanced"][i % 3],
      }),
    );
  }

  const enroll = async (batch, profile, { pay = "verified", discount = null } = {}) => {
    const [enrollment, plan] = await batchSvc.enroll({
      batch,
      student: profile,
      source: "admin",
      actorId: admin._id,
      startDate: batch.start_date,
      discountType: discount ? "percent" : "none",
      discountValue: discount || 0,
    });
    if (pay === "verified") {
      const payment = await Payment.create({
        academy_id: academy._id,
        student_id: profile._id,
        student_fee_plan_id: plan._id,
        amount: plan.final_fee,
        payment_date: addDays(batch.start_date, -rnd.randint(1, 4)),
        method: rnd.choice(["upi", "upi", "cash"]),
        reference_no: `UTR${rnd.randint(10 ** 9, 10 ** 10)}`,
      });
      await ledger.verifyPayment(payment, admin._id);
    } else if (pay === "pending") {
      await Payment.create({
        academy_id: academy._id,
        student_id: profile._id,
        student_fee_plan_id: plan._id,
        amount: plan.final_fee,
        payment_date: addDays(t, -1),
        method: "upi",
        reference_no: `UTR${rnd.randint(10 ** 9, 10 ** 10)}`,
        status: "pending",
        submitted_by_id: profile._id,
      });
    } else if (pay === "unpaid") {
      await batchSvc.approveEnrollment(enrollment, admin._id);
    }
    return enrollment;
  };

  for (let i = 0; i < 6; i += 1) await enroll(beg, students[i], { discount: i === 2 ? 10 : null });
  for (let i = 6; i < 11; i += 1) await enroll(inter, students[i], { pay: i === 10 ? "unpaid" : "verified" });
  for (let i = 11; i < 15; i += 1) await enroll(adv, students[i]);
  for (let i = 15; i < 18; i += 1) await enroll(kids, students[i]);
  await enroll(nxt, students[0], { pay: "pending" });
  await enroll(nxt, students[1], { pay: "pending" });

  for (const b of [beg, inter, adv, kids]) await batchSvc.generateSessions(b, mStart, mEnd);
  for (const b of [nxt, nxtEve]) await batchSvc.generateSessions(b, nextStart, nextEnd);

  // Record the month so far: some absences (-> make-ups), one cancellation, one make-up, one drop-in.
  const rules = businessRules(academy);
  const past = await Session.find({ academy_id: academy._id, session_date: { $lt: t } }).sort({ session_date: 1, start_time: 1 });
  let cancelledDone = false;
  for (const s of past) {
    if (!cancelledDone && sameId(s.batch_id, inter._id) && Number(s.session_date.slice(8)) > 3) {
      await attSvc.cancelSession(s, {
        reason: "Court resurfacing at venue",
        adjustment: "carry_forward",
        venueChargeApplies: false,
        rules,
        actorId: admin._id,
      });
      cancelledDone = true;
      continue;
    }
    const roster = await batchSvc.regularEnrollmentsOn(s.batch_id, s.session_date);
    const entries = roster.map((e) => ({ student_id: e.student_id, status: rnd.random() < 0.12 ? "absent" : "present" }));
    await attSvc.recordSession(s, {
      entries,
      coaches: s.coaches.map((c) => ({ coach_id: c.coach_id, hours_coached: c.scheduled_hours })),
      rules,
      actorId: s.coaches.length ? s.coaches[0].coach_id : admin._id,
      isAdmin: true,
    });
  }

  // A beginner uses a make-up in another batch; a walk-in pays the drop-in fee.
  const credit = await MakeupCredit.findOne({ academy_id: academy._id, status: "available" }).sort({ _id: 1 });
  if (credit) {
    const missed = await Session.findById(credit.missed_session_id);
    const later = past.filter(
      (s) => s.status === "completed" && !sameId(s.batch_id, credit.original_batch_id) && s.session_date > missed.session_date,
    );
    if (later.length) {
      await attSvc.recordSession(later[0], {
        entries: [{ student_id: credit.student_id, status: "present", attendee_type: "makeup", makeup_credit_id: credit._id }],
        coaches: [],
        rules,
        actorId: admin._id,
        isAdmin: true,
      });
    }
  }
  const walkIn = await createUser(academy, { name: "Guest Player", mobile: "9000000199", role: "student" });
  await StudentProfile.create({ _id: walkIn._id, academy_id: academy._id, source: "walk_in" });
  const advDone = past.filter((s) => sameId(s.batch_id, adv._id) && s.status === "completed");
  if (advDone.length) {
    await attSvc.recordSession(advDone[advDone.length - 1], {
      entries: [{ student_id: walkIn._id, status: "present", attendee_type: "drop_in" }],
      coaches: [],
      rules,
      actorId: admin._id,
      isAdmin: true,
    });
  }

  await Expense.create({
    academy_id: academy._id,
    category: "equipment",
    description: "Outdoor balls (6 dozen) and 4 paddles",
    vendor: "Sports Depot",
    amount: 6500,
    expense_date: addDays(mStart, 2),
  });
  await Expense.create({
    academy_id: academy._id,
    category: "marketing",
    description: "Instagram promotion — new batches",
    amount: 3000,
    expense_date: addDays(mStart, 5),
  });

  // Website content
  const galleryIds = [];
  for (let i = 0; i < 8; i += 1) galleryIds.push((await addImage(40 + i))._id);
  const video = await MediaAsset.create({
    academy_id: academy._id,
    media_type: "video",
    storage_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    caption: "Sample video — replace with an academy reel",
  });
  await GalleryAlbum.create({
    academy_id: academy._id,
    title: "Academy in action",
    slug: "academy-in-action",
    description: "Moments from our batches, clinics and tournaments.",
    status: "published",
    media_ids: [...galleryIds, video._id],
    cover_media_id: galleryIds[0],
  });

  const daysAgo = (days) => new Date(now().getTime() - days * DAY_MS);
  const win = await addImage(60);
  await Post.create({
    academy_id: academy._id,
    title: "Ananya wins gold at the State Pickleball Championship",
    slug: "ananya-wins-state-gold",
    category: "achievement",
    is_featured: true,
    status: "published",
    summary: "Our intermediate batch player took the women's singles gold after an unbeaten run.",
    body:
      "Months of third-shot drills paid off as Ananya won five straight matches to take gold.\n\n" +
      "Congratulations from all coaches and teammates!",
    cover_image_url: win.storage_url,
    publish_from: daysAgo(3),
  });
  await Post.create({
    academy_id: academy._id,
    title: "LuvAll Open — doubles tournament this December",
    slug: "luvall-open-december",
    category: "tournament",
    status: "published",
    summary: "Registrations open for our in-house doubles tournament for all academy players.",
    body: "Beginner, intermediate and open categories. Ask your coach for details.",
    cover_image_url: (await addImage(61)).storage_url,
    publish_from: daysAgo(1),
  });
  await Post.create({
    academy_id: academy._id,
    title: "New evening batches at Baseline Club",
    slug: "new-evening-batches",
    category: "academy_update",
    status: "published",
    summary: "Intermediate Tue/Thu evening batch starts next month — limited seats.",
    cover_image_url: (await addImage(62)).storage_url,
    publish_from: daysAgo(6),
  });

  await Testimonial.create({
    academy_id: academy._id,
    author_name: "Meera P.",
    author_title: "Beginner batch",
    quote: "I had never held a paddle before. Six weeks in, I'm playing doubles every weekend!",
    rating: 5,
    status: "published",
  });
  await Testimonial.create({
    academy_id: academy._id,
    author_name: "Rohan K.",
    author_title: "Advanced batch",
    quote: "The drills are structured and the coaches actually watch your game. My third-shot drop finally works.",
    rating: 5,
    status: "published",
    display_order: 1,
  });
  await Testimonial.create({
    academy_id: academy._id,
    author_name: "Parent of Kiara",
    author_title: "Kids batch",
    quote: "Kiara looks forward to Saturday all week. Safe, fun and well organised.",
    rating: 5,
    status: "published",
    display_order: 2,
  });
  for (const [i, [question, answer]] of [
    ["Do I need my own paddle?", "No — loaner paddles and balls are available for beginner batches."],
    ["How many players are in a batch?", "Batches have 4 to 6 players so everyone gets plenty of court time."],
    ["What if I miss a session?",
      "Absences can be made up in another batch within the make-up window. Book it from your student dashboard."],
    ["How do I pay?",
      "Pay by UPI using the academy UPI ID or QR code and enter the transaction reference. " +
        "Your seat is confirmed once the payment is verified."],
    ["What happens if a session is cancelled?",
      "If the academy cancels a session, it is carried forward or refunded as per the academy policy."],
    ["Is there a trial class?", "Contact us on WhatsApp and we will arrange a drop-in session."],
  ].entries()) {
    await Faq.create({ academy_id: academy._id, question, answer, display_order: i, status: "published" });
  }
  await Announcement.create({
    academy_id: academy._id,
    title: "November batches are open",
    message: "Enroll now for November — seats are limited to 6 per batch.",
    audience: "public",
    link_url: "/batches",
    is_pinned: true,
    status: "published",
  });
  await Announcement.create({
    academy_id: academy._id,
    title: "Rain policy",
    message: "If a session is cancelled for rain, it is carried forward to your account.",
    audience: "members",
    status: "published",
  });
}

// --- Entry point ------------------------------------------------------------------------------------------------

const USAGE = `Usage: npm run cli -- <command> [options]

Commands:
  init | create-admin   Create the academy and (optionally) an admin user
                          --admin-mobile <mobile> [--admin-password <pw>] [--admin-name <name>] [--admin-email <email>]
  demo                  Load sample data for development/UAT
  import-students <csv> Import students (and opening balances) from CSV
                          columns: name,mobile,email,skill_level,opening_balance
  send-reminders        Send session reminders through the configured notifier`;

const COMMANDS = {
  init: cmdInit,
  "create-admin": cmdInit,
  demo: cmdDemo,
  "import-students": cmdImportStudents,
  "send-reminders": cmdSendReminders,
};

/** Split argv into { opts: {"admin-mobile": "..."}, positional: [...] }. */
function parseArgs(argv) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split(/=(.*)/s, 2);
      if (inline !== undefined) opts[key] = inline;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) opts[key] = argv[(i += 1)];
      else opts[key] = "";
    } else {
      positional.push(arg);
    }
  }
  return { opts, positional };
}

async function main(argv) {
  const [command, ...rest] = argv;
  const handler = COMMANDS[command];
  if (!handler) {
    console.log(USAGE);
    return command && command !== "help" && command !== "--help" ? 2 : 0;
  }
  const { opts, positional } = parseArgs(rest);
  await connect();
  try {
    await ensureIndexes();
    await handler(opts, positional);
    return 0;
  } catch (err) {
    if (err instanceof CliError || err?.name === "BusinessRuleError") {
      console.error(err.message);
      return 1;
    }
    throw err;
  } finally {
    await disconnect();
  }
}

process.exitCode = await main(process.argv.slice(2));
