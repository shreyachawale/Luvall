/** Business-rule and calculation tests (BRD section 7 business rules, brief sections 7, 10, 11). */
import { expect, test } from "vitest";

import { withTransaction } from "../src/db.js";
import {
  BatchStudent,
  LedgerTransaction,
  MakeupCredit,
  Payment,
  sameId,
  Session,
  SessionAttendance,
  sid,
  StudentFeePlan,
} from "../src/models/index.js";
import * as att from "../src/services/attendance.js";
import * as batchSvc from "../src/services/batches.js";
import * as finance from "../src/services/finance.js";
import * as ledger from "../src/services/ledger.js";
import * as makeups from "../src/services/makeups.js";
import * as rates from "../src/services/rates.js";
import { BusinessRules } from "../src/services/rules.js";
import { freeze } from "../src/utils/clock.js";
import { addDays } from "../src/utils/dates.js";
import { BusinessRuleError } from "../src/utils/errors.js";
import { finalFee, perSessionValue } from "../src/utils/money.js";
import { TODAY } from "./setup.js";
import { createWorld } from "./world.js";

const RULES = BusinessRules.parse({});

/** Services run inside a transaction, exactly as the `write` route handlers call them. */
const tx = (fn) => withTransaction(fn);

async function first(batch, onOrAfter) {
  return Session.findOne({ batch_id: batch._id, session_date: { $gte: onOrAfter } }).sort({ session_date: 1, start_time: 1 });
}

async function enrollActive(world, student, batch) {
  const [e, plan] = await tx(async () => {
    const [enrollment, p] = await batchSvc.enroll({
      batch,
      student,
      source: "admin",
      actorId: world.admin._id,
      startDate: batch.start_date,
    });
    await batchSvc.approveEnrollment(enrollment, world.admin._id);
    return [enrollment, p];
  });
  return [await BatchStudent.findById(e._id), plan ? await StudentFeePlan.findById(plan._id) : null];
}

async function record(world, session, statuses, { coaches = null, ...kw } = {}) {
  const coachHours = coaches ?? session.coaches.map((c) => ({ coach_id: c.coach_id, hours_coached: c.scheduled_hours }));
  await tx(() =>
    att.recordSession(session, {
      entries: Object.entries(statuses).map(([studentId, status]) => ({ student_id: studentId, status })),
      coaches: coachHours,
      rules: RULES,
      actorId: world.admin._id,
      isAdmin: true,
      ...kw,
    }),
  );
}

const balance = (student) => ledger.balance(student._id);

const generate = (batch, start, end) => tx(() => batchSvc.generateSessions(batch, start, end));

// --- Money ---------------------------------------------------------------------------------------------------

test("discounts and per session value", () => {
  expect(finalFee(4000, "fixed", 500)).toBe(3500);
  expect(finalFee(4000, "percent", 10)).toBe(3600);
  expect(finalFee(4000, "fixed", 9000)).toBe(0); // never negative
  expect(finalFee(4000, "percent", 150)).toBe(0);
  expect(perSessionValue(4000, 8)).toBe(500); // BR-07
  expect(perSessionValue(1000, 3)).toBe(333.33);
});

// --- Rates ---------------------------------------------------------------------------------------------------

test("effective-dated rates do not rewrite history", async () => {
  const world = await createWorld();
  await tx(() => rates.setCoachRate(world.coach._id, 1000, "2026-11-01"));
  expect(await rates.coachRateOn(world.coach._id, "2026-10-31")).toBe(800);
  expect(await rates.coachRateOn(world.coach._id, "2026-11-01")).toBe(1000);

  await generate(world.batch, "2026-10-01", "2026-10-31");
  const s = await first(world.batch, "2026-10-01");
  await record(world, s, {});
  const payableBefore = s.coaches[0].payable_amount;
  // A later rate change (even backdated through the API) must not alter the recorded snapshot.
  await tx(() => rates.setCoachRate(world.coach._id, 2000, "2026-10-01"));
  await tx(() => att.computeCoachPayables(s));
  expect(s.coaches[0].payable_amount).toBe(payableBefore);
  expect(payableBefore).toBe(800);
  expect((await Session.findById(s._id)).coaches[0].payable_amount).toBe(800);
});

test("venue slot classification and court payable", async () => {
  const world = await createWorld();
  await generate(world.batch, "2026-10-01", "2026-10-31");
  const s = await first(world.batch, "2026-10-01"); // weekday evening 17:00, 1h, 2 courts at V1
  await record(world, s, {});
  const stored = await Session.findById(s._id);
  expect([stored.day_type, stored.time_slot]).toEqual(["weekday", "evening"]);
  expect(stored.venue_rate_applied).toBe(800);
  expect(stored.court_payable).toBe(1600); // 1h x 2 courts x 800 (BR-09)
  expect(rates.classifySlot("2026-10-17", "07:00", RULES)).toEqual(["weekend", "morning"]);
  expect(rates.classifySlot("2026-10-17", "12:00", RULES)).toEqual(["weekend", "evening"]);
});

test("two coaches recorded separately", async () => {
  const world = await createWorld();
  await generate(world.batch2, "2026-10-01", "2026-10-31");
  const s = await first(world.batch2, "2026-10-01"); // 1.5h, two coaches
  await record(world, s, {}, {
    coaches: [
      { coach_id: world.coach._id, hours_coached: 1.5 },
      { coach_id: world.coach2._id, hours_coached: 1 },
    ],
  });
  const stored = await Session.findById(s._id);
  const pay = Object.fromEntries(stored.coaches.map((c) => [sid(c.coach_id), c.payable_amount]));
  expect(pay[sid(world.coach)]).toBe(1200); // 1.5 x 800
  expect(pay[sid(world.coach2)]).toBe(600); // 1 x 600 (BR-08, FR-018)
  expect(stored.court_payable).toBe(750); // 1.5h x 1 court x 500 weekday morning
});

// --- Capacity ------------------------------------------------------------------------------------------------

test("capacity full and override", async () => {
  const world = await createWorld();
  world.batch.max_players = 2;
  await world.batch.save();
  const a = await world.student();
  const b = await world.student();
  const c = await world.student();
  await tx(() => batchSvc.enroll({ batch: world.batch, student: a, source: "self", actorId: a._id }));
  await tx(() => batchSvc.enroll({ batch: world.batch, student: b, source: "self", actorId: b._id }));
  const taken = (await batchSvc.seatCounts([world.batch._id]))[sid(world.batch)];
  expect(batchSvc.displayStatus(world.batch, taken)).toBe("full");
  const full = tx(() => batchSvc.enroll({ batch: world.batch, student: c, source: "self", actorId: c._id }));
  await expect(full).rejects.toThrow(BusinessRuleError);
  await expect(full).rejects.toThrow(/full/);
  const [e] = await tx(() =>
    batchSvc.enroll({ batch: world.batch, student: c, source: "admin", actorId: world.admin._id, overrideCapacity: true }),
  );
  expect(e.capacity_override).toBe(true);
  // Cancelling an enrollment frees the seat immediately.
  const firstEnrollment = await BatchStudent.findOne({ student_id: a._id });
  await tx(() => batchSvc.endEnrollment(firstEnrollment, "cancelled", null, world.admin._id));
  expect((await batchSvc.seatCounts([world.batch._id]))[sid(world.batch)]).toBe(2);
});

// --- Ledger / payments ---------------------------------------------------------------------------------------

test("payment verification activates plan and balances", async () => {
  const world = await createWorld();
  const s = await world.student();
  const [e, plan] = await tx(() =>
    batchSvc.enroll({ batch: world.batch, student: s, source: "self", actorId: s._id, discountType: "percent", discountValue: 10 }),
  );
  expect(plan.final_fee).toBe(3600);
  expect(plan.per_session_value).toBe(450);
  const pay = await Payment.create({
    academy_id: world.academy._id,
    student_id: s._id,
    student_fee_plan_id: plan._id,
    amount: 3600,
    payment_date: "2026-10-01",
    method: "upi",
    reference_no: "UTR1",
  });
  expect(await balance(s)).toBe(0); // nothing posted before verification
  await tx(() => ledger.verifyPayment(pay, world.admin._id));
  expect((await BatchStudent.findById(e._id)).status).toBe("active");
  expect((await StudentFeePlan.findById(plan._id)).status).toBe("active");
  expect(await balance(s)).toBe(0); // -3600 charge + 3600 payment
  // Verifying twice never double counts.
  await tx(() => ledger.verifyPayment(pay, world.admin._id));
  expect(await LedgerTransaction.countDocuments()).toBe(2);
  // Rejecting after verification reverses only the cash.
  await tx(() => ledger.rejectPayment(pay, "Bounced", world.admin._id));
  expect(await balance(s)).toBe(-3600);
});

// --- Attendance, make-ups and package usage -------------------------------------------------------------------

test("absence creates makeup and makeup does not double count", async () => {
  const world = await createWorld();
  const s = await world.student();
  const [, plan] = await enrollActive(world, s, world.batch);
  await generate(world.batch, "2026-10-01", "2026-10-31");
  await generate(world.batch2, "2026-10-01", "2026-10-31");

  const missed = await first(world.batch, "2026-10-01");
  await record(world, missed, { [sid(s)]: "absent" });
  let credit = await MakeupCredit.findOne({ student_id: s._id });
  expect(credit.status).toBe("available"); // BR-01: absence never creates a refund
  expect(await LedgerTransaction.countDocuments({ txn_type: "cancellation_credit" })).toBe(0);
  expect(credit.expires_on).toBe(addDays(missed.session_date, 30));

  const other = await first(world.batch2, TODAY);
  await tx(() => makeups.book(credit, other, RULES, { byStudent: true }));
  credit = await MakeupCredit.findById(credit._id);
  expect(credit.status).toBe("booked");
  const roster = await att.roster(other);
  expect(roster.some((r) => r.student_id === sid(s) && r.attendee_type === "makeup")).toBe(true);

  await record(world, other, { [sid(s)]: "present" });
  const row = await SessionAttendance.findOne({ session_id: other._id });
  expect(row.is_makeup).toBe(true);
  expect(sameId(row.original_batch_id, world.batch._id)).toBe(true);
  expect(sameId(row.attended_batch_id, world.batch2._id)).toBe(true);
  credit = await MakeupCredit.findById(credit._id);
  expect(credit.status).toBe("used");
  expect(sameId(credit.used_attendance_id, row._id)).toBe(true);
  const usage = (await ledger.planUsage([plan]))[sid(plan)];
  expect([usage.used, usage.makeups_attended, usage.remaining]).toEqual([1, 1, 7]); // BR-03, no double counting

  // Correcting the original absence to present is blocked while the make-up stands.
  await expect(record(world, missed, { [sid(s)]: "present" })).rejects.toThrow(BusinessRuleError);
});

test("correcting absence cancels unused makeup", async () => {
  const world = await createWorld();
  const s = await world.student();
  await enrollActive(world, s, world.batch);
  await generate(world.batch, "2026-10-01", "2026-10-31");
  const missed = await first(world.batch, "2026-10-01");
  await record(world, missed, { [sid(s)]: "absent" });
  await record(world, missed, { [sid(s)]: "present" });
  let credit = await MakeupCredit.findOne({ student_id: s._id });
  expect(credit.status).toBe("cancelled");
  await record(world, missed, { [sid(s)]: "absent" });
  credit = await MakeupCredit.findById(credit._id);
  expect(credit.status).toBe("available");
  expect(await MakeupCredit.countDocuments()).toBe(1);
});

test("makeup requires approval policy", async () => {
  const world = await createWorld();
  const rules = BusinessRules.parse({ makeup: { requires_approval: true } });
  const s = await world.student();
  await enrollActive(world, s, world.batch);
  await generate(world.batch, "2026-10-01", "2026-10-31");
  const missed = await first(world.batch, "2026-10-01");
  await tx(() =>
    att.recordSession(missed, {
      entries: [{ student_id: sid(s), status: "absent" }],
      coaches: [],
      rules,
      actorId: world.admin._id,
      isAdmin: true,
    }),
  );
  let credit = await MakeupCredit.findOne();
  expect(credit.status).toBe("pending_approval");
  const target = await first(world.batch, TODAY);
  await expect(tx(() => makeups.book(credit, target, rules, { byStudent: true }))).rejects.toThrow(BusinessRuleError);
  await tx(() => makeups.decide(credit, true, null, world.admin._id));
  credit = await MakeupCredit.findById(credit._id);
  expect(credit.status).toBe("available");
});

test("makeup expiry", async () => {
  const world = await createWorld();
  const s = await world.student();
  await enrollActive(world, s, world.batch);
  await generate(world.batch, "2026-09-01", "2026-10-31");
  const missed = await first(world.batch, "2026-10-01");
  await record(world, missed, { [sid(s)]: "absent" });

  freeze(addDays(missed.session_date, 31));
  await tx(() => makeups.expireDue(world.academy._id));
  expect((await MakeupCredit.findOne()).status).toBe("expired");
});

test("cancelled session is not absence and applies adjustment", async () => {
  const world = await createWorld();
  const a = await world.student();
  const b = await world.student();
  const [, planA] = await enrollActive(world, a, world.batch);
  await enrollActive(world, b, world.batch);
  await generate(world.batch, "2026-10-01", "2026-10-31");
  const s1 = await first(world.batch, "2026-10-01");
  const s2 = await first(world.batch, addDays(s1.session_date, 1));

  await tx(() =>
    att.cancelSession(s1, { reason: "Rain", adjustment: "refund", venueChargeApplies: false, rules: RULES, actorId: world.admin._id }),
  );
  const rows = await SessionAttendance.find({ session_id: s1._id });
  expect(new Set(rows.map((r) => r.attendance_status))).toEqual(new Set(["session_cancelled"])); // BR-04
  expect(await MakeupCredit.countDocuments()).toBe(0);
  const stored1 = await Session.findById(s1._id);
  expect(stored1.court_payable).toBe(0);
  expect(stored1.coaches.every((c) => c.payable_amount === 0)).toBe(true);
  expect(await balance(a)).toBe(-3500); // -4000 charge + 500 refund credit
  let usage = (await ledger.planUsage([planA]))[sid(planA)];
  expect([usage.used, usage.refunded, usage.remaining]).toEqual([0, 1, 7]);

  await tx(() =>
    att.cancelSession(s2, {
      reason: "Coach unwell",
      adjustment: "carry_forward",
      venueChargeApplies: true,
      rules: RULES,
      actorId: world.admin._id,
    }),
  );
  usage = (await ledger.planUsage([planA]))[sid(planA)];
  expect([usage.carried_forward, usage.remaining]).toEqual([1, 7]);
  expect((await Session.findById(s2._id)).court_payable).toBe(1600); // venue still charged for the booking

  // Reinstating reverses the refund credit without deleting history.
  await tx(() => att.reinstateSession(s1, world.admin._id));
  expect(await balance(a)).toBe(-4000);
  expect(await LedgerTransaction.countDocuments({ txn_type: "cancellation_credit" })).toBe(4); // 2 credits + 2 reversals
});

test("drop-in fee and admin billing override", async () => {
  const world = await createWorld();
  const guest = await world.student();
  await generate(world.batch, "2026-10-01", "2026-10-31");
  const s = await first(world.batch, "2026-10-01");
  const asCoach = { coaches: [], rules: RULES, actorId: world.coach._id, isAdmin: false };
  await tx(() => att.recordSession(s, { ...asCoach, entries: [{ student_id: sid(guest), status: "present", attendee_type: "drop_in" }] }));
  expect(await balance(guest)).toBe(-500);
  // Coach re-saving does not double charge.
  await tx(() => att.recordSession(s, { ...asCoach, entries: [{ student_id: sid(guest), status: "present", attendee_type: "drop_in" }] }));
  expect(await balance(guest)).toBe(-500);
  await tx(() =>
    att.recordSession(s, {
      entries: [{ student_id: sid(guest), status: "present", billing_mode: "complimentary" }],
      coaches: [],
      rules: RULES,
      actorId: world.admin._id,
      isAdmin: true,
    }),
  );
  expect(await balance(guest)).toBe(0);
});

test("close plan carries forward unused sessions", async () => {
  const world = await createWorld();
  const s = await world.student();
  const [, plan] = await enrollActive(world, s, world.batch);
  await generate(world.batch, "2026-10-01", "2026-10-31");
  const sessions = await Session.find({ batch_id: world.batch._id }).sort({ session_date: 1 }).limit(5);
  for (const sess of sessions) await record(world, sess, { [sid(s)]: "present" });
  await tx(() => ledger.closePlan(plan, "carry_forward", world.admin._id));
  // 8 included - 5 used = 3 x 500 carried forward
  const [cf] = await LedgerTransaction.aggregate([
    { $match: { txn_type: "carry_forward" } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  expect(cf.total).toBe(1500);
  expect(await balance(s)).toBe(-2500);
});

test("unbilled attendance when no plan", async () => {
  const world = await createWorld();
  const s = await world.student();
  const [e, plan] = await tx(() =>
    batchSvc.enroll({ batch: world.batch, student: s, source: "admin", actorId: world.admin._id, startDate: world.batch.start_date }),
  );
  await tx(() => ledger.cancelPlan(plan, world.admin._id));
  e.status = "active";
  await e.save();
  await generate(world.batch, "2026-10-01", "2026-10-31");
  await record(world, await first(world.batch, "2026-10-01"), { [sid(s)]: "present" });
  expect(await att.unbilledAttendanceCount(world.academy._id)).toBe(1);
});

test("finance summary separates cash billing and expenses", async () => {
  const world = await createWorld();
  const s = await world.student();
  const [, plan] = await enrollActive(world, s, world.batch);
  const pay = await Payment.create({
    academy_id: world.academy._id,
    student_id: s._id,
    student_fee_plan_id: plan._id,
    amount: 1500,
    payment_date: "2026-10-02",
    method: "cash",
  });
  await tx(() => ledger.verifyPayment(pay, world.admin._id));
  await generate(world.batch, "2026-10-01", "2026-10-31");
  await record(world, await first(world.batch, "2026-10-01"), { [sid(s)]: "present" });
  const summary = await finance.summary(world.academy._id, "2026-10-01", "2026-10-31");
  expect(summary.income.billed).toBe(4000);
  expect(summary.income.cash_collected).toBe(1500);
  expect(summary.receivables.outstanding_balances).toBe(2500);
  expect(summary.expenses.coach_payable).toBe(800);
  expect(summary.expenses.venue_payable).toBe(1600);
  expect(summary.net.operating_surplus).toBe(1600); // 4000 - 800 - 1600
  expect(summary.net.net_cash_flow).toBe(1500); // nothing paid out yet
});
