/**
 * Monthly financial dashboard and reports (brief sections 9–11, BRD section 12).
 *
 * Cash collected, amounts billed, credits and expenses payable are always reported separately so revenue is
 * never confused with receipts and no expense is subtracted twice.
 *
 * Optional report filters are passed as { coachId, venueId, batchId }.
 */
import {
  Batch,
  BatchStudent,
  CoachPayment,
  Expense,
  LedgerTransaction,
  oid,
  Payment,
  sameId,
  SEAT_HOLDING_STATUSES,
  Session,
  SessionAttendance,
  StudentFeePlan,
  StudentProfile,
  User,
  Venue,
  VenuePayment,
} from "../models/index.js";
import { today } from "../utils/clock.js";
import { addDays, monthEnd, monthLabel, monthsBetween, monthStart } from "../utils/dates.js";
import { hoursBetween, q, sum } from "../utils/money.js";
import * as ledger from "./ledger.js";

export { monthEnd, monthsBetween, monthStart };

const RECORDED = ["completed", "cancelled"];

/** Python's round(x, 1): the exact binary value rounded to one decimal, ties to even. */
function round1(x) {
  if (Number.isInteger(x * 4) && !Number.isInteger(x * 2)) {
    const tenths = Math.floor(x * 10);
    return (tenths % 2 === 0 ? tenths : tenths + 1) / 10;
  }
  return Number(x.toFixed(1));
}

/** Sum of `field` over the matching documents of a model. */
async function total(Model, match, field) {
  const [row] = await Model.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: `$${field}` } } }]);
  return q(row?.total ?? 0);
}

/** { [key]: q(sum of amount) } grouped by one field. */
async function grouped(Model, match, key, field = "amount") {
  const rows = await Model.aggregate([{ $match: match }, { $group: { _id: `$${key}`, total: { $sum: `$${field}` } } }]);
  const out = {};
  for (const r of rows) out[String(r._id)] = q(r.total);
  return out;
}

async function ledgerTotals(academyId, start, end, batchId = null) {
  const match = { academy_id: oid(academyId), txn_date: { $gte: start, $lte: end } };
  if (batchId) match.batch_id = oid(batchId);
  return grouped(LedgerTransaction, match, "txn_type");
}

function sessionMatch(academyId, start, end, venueId = null, batchId = null) {
  const match = { academy_id: oid(academyId), session_date: { $gte: start, $lte: end } };
  if (venueId) match.venue_id = oid(venueId);
  if (batchId) match.batch_id = oid(batchId);
  return match;
}

const billedOf = (t) => q(0 - ((t.charge ?? 0) + (t.drop_in_charge ?? 0)));

export async function coachPayableTotal(academyId, start, end, { coachId = null, venueId = null, batchId = null } = {}) {
  const pipeline = [{ $match: { ...sessionMatch(academyId, start, end, venueId, batchId), status: { $in: RECORDED } } }, { $unwind: "$coaches" }];
  if (coachId) pipeline.push({ $match: { "coaches.coach_id": oid(coachId) } });
  pipeline.push({ $group: { _id: null, total: { $sum: "$coaches.payable_amount" } } });
  const [row] = await Session.aggregate(pipeline);
  return q(row?.total ?? 0);
}

export async function venuePayableTotal(academyId, start, end, { venueId = null, batchId = null, coachId = null } = {}) {
  const match = { ...sessionMatch(academyId, start, end, venueId, batchId), status: { $in: RECORDED } };
  if (coachId) match["coaches.coach_id"] = oid(coachId);
  return total(Session, match, "court_payable");
}

/** The monthly dashboard: income, receivables, expenses, net and liabilities for [start, end]. */
export async function summary(academyId, start, end, { coachId = null, venueId = null, batchId = null } = {}) {
  const totals = await ledgerTotals(academyId, start, end, batchId);
  const get = (t) => totals[t] ?? 0;
  const billed = billedOf(totals);
  const cash = get("payment");
  const refunds = q(0 - get("refund"));
  const credits = q(get("cancellation_credit") + get("carry_forward"));
  const adjustments = q(get("adjustment") + get("opening_balance"));

  const coachPayable = await coachPayableTotal(academyId, start, end, { coachId, venueId, batchId });
  const venuePayable = await venuePayableTotal(academyId, start, end, { venueId, batchId, coachId });
  const months = { $gte: monthStart(start), $lte: monthStart(end) };
  const cp = { academy_id: oid(academyId), period_month: months };
  if (coachId) cp.coach_id = oid(coachId);
  const coachPaid = await total(CoachPayment, cp, "amount");
  const vp = { academy_id: oid(academyId), period_month: months };
  if (venueId) vp.venue_id = oid(venueId);
  const venuePaid = await total(VenuePayment, vp, "amount");

  const ex = { academy_id: academyId, expense_date: { $gte: start, $lte: end } };
  if (venueId) ex.venue_id = venueId;
  if (batchId) ex.batch_id = batchId;
  const expenses = await Expense.find(ex).select("amount is_paid");
  const otherExpenses = sum(expenses.map((e) => e.amount));
  const otherPaid = sum(expenses.filter((e) => e.is_paid).map((e) => e.amount));

  const balances = Object.values(await ledger.balances(academyId));
  const outstanding = q(0 - sum(balances.filter((b) => b < 0)));
  const creditHeld = sum(balances.filter((b) => b > 0));
  const [pending] = await Payment.aggregate([
    { $match: { academy_id: oid(academyId), status: "pending" } },
    { $group: { _id: null, n: { $sum: 1 }, total: { $sum: "$amount" } } },
  ]);

  const sessionRows = await Session.aggregate([
    { $match: sessionMatch(academyId, start, end, venueId, batchId) },
    { $group: { _id: "$status", n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const expensesTotal = q(coachPayable + venuePayable + otherExpenses);
  return {
    period: { start, end },
    income: {
      billed,
      cash_collected: cash,
      refunds_paid: refunds,
      credits_issued: credits,
      adjustments,
    },
    receivables: {
      outstanding_balances: outstanding,
      students_with_dues: balances.filter((b) => b < 0).length,
      student_credit_held: creditHeld,
      pending_verification_count: pending?.n ?? 0,
      pending_verification_amount: q(pending?.total ?? 0),
    },
    expenses: {
      coach_payable: coachPayable,
      coach_paid: coachPaid,
      venue_payable: venuePayable,
      venue_paid: venuePaid,
      other_expenses: otherExpenses,
      other_expenses_paid: otherPaid,
      total_payable: expensesTotal,
    },
    net: {
      // Operating view: what was billed for the period minus what the period cost.
      operating_surplus: q(billed - expensesTotal),
      // Cash view: money in minus money out during the period.
      net_cash_flow: q(cash - refunds - coachPaid - venuePaid - otherPaid),
    },
    liabilities: {
      coach_unpaid: q(coachPayable - coachPaid),
      venue_unpaid: q(venuePayable - venuePaid),
      other_unpaid: q(otherExpenses - otherPaid),
      student_credit_held: creditHeld,
    },
    sessions: Object.fromEntries(sessionRows.map((r) => [r._id, r.n])),
  };
}

/** Billed / cash / payables per month for the `months` months ending with the month of `end`. */
export async function monthlySeries(academyId, end, { months = 6, coachId = null, venueId = null, batchId = null } = {}) {
  let first = monthStart(end);
  for (let i = 0; i < months - 1; i += 1) first = monthStart(addDays(first, -1));
  const rows = [];
  for (const m of monthsBetween(first, end)) {
    const s = m;
    const e = monthEnd(m);
    const totals = await ledgerTotals(academyId, s, e, batchId);
    const coach = await coachPayableTotal(academyId, s, e, { coachId, venueId, batchId });
    const venue = await venuePayableTotal(academyId, s, e, { venueId, batchId, coachId });
    const ex = { academy_id: oid(academyId), expense_date: { $gte: s, $lte: e } };
    if (venueId) ex.venue_id = oid(venueId);
    if (batchId) ex.batch_id = oid(batchId);
    const other = await total(Expense, ex, "amount");
    const billed = billedOf(totals);
    rows.push({
      month: m.slice(0, 7),
      label: monthLabel(m),
      billed,
      cash_collected: totals.payment ?? 0,
      coach_payable: coach,
      venue_payable: venue,
      other_expenses: other,
      expenses: q(coach + venue + other),
      operating_surplus: q(billed - coach - venue - other),
    });
  }
  return rows;
}

/** Per-batch occupancy, sessions, attendance, money and payables for [start, end]. */
export async function batchReport(academyId, start, end, { batchId = null, coachId = null, venueId = null } = {}) {
  const filter = { academy_id: academyId };
  if (batchId) filter._id = batchId;
  let batches = await Batch.find(filter).sort({ name: 1 });
  if (coachId) batches = batches.filter((b) => b.coaches.some((c) => sameId(c.coach_id, coachId)));
  if (venueId) batches = batches.filter((b) => b.schedules.some((s) => sameId(s.venue_id, venueId)));
  const ids = batches.map((b) => oid(b._id));
  const t = today();

  const enrolled = {};
  for (const r of await BatchStudent.aggregate([
    {
      $match: {
        batch_id: { $in: ids },
        status: { $in: SEAT_HOLDING_STATUSES },
        $or: [{ left_on: null }, { left_on: { $gt: t } }],
      },
    },
    { $group: { _id: "$batch_id", n: { $sum: 1 } } },
  ])) {
    enrolled[String(r._id)] = r.n;
  }

  const sess = {};
  for (const r of await Session.aggregate([
    { $match: { batch_id: { $in: ids }, session_date: { $gte: start, $lte: end } } },
    { $group: { _id: { batch: "$batch_id", status: "$status" }, n: { $sum: 1 } } },
  ])) {
    (sess[String(r._id.batch)] ??= {})[r._id.status] = r.n;
  }

  const att = {};
  for (const r of await SessionAttendance.aggregate([
    { $match: { attended_batch_id: { $in: ids }, session_date: { $gte: start, $lte: end } } },
    { $group: { _id: { batch: "$attended_batch_id", status: "$attendance_status" }, n: { $sum: 1 } } },
  ])) {
    (att[String(r._id.batch)] ??= {})[r._id.status] = r.n;
  }

  const money = {};
  for (const r of await LedgerTransaction.aggregate([
    { $match: { batch_id: { $in: ids }, txn_date: { $gte: start, $lte: end } } },
    { $group: { _id: { batch: "$batch_id", type: "$txn_type" }, total: { $sum: "$amount" } } },
  ])) {
    (money[String(r._id.batch)] ??= {})[r._id.type] = q(r.total);
  }

  const rows = [];
  for (const b of batches) {
    const id = String(b._id);
    const taken = enrolled[id] ?? 0;
    const s = sess[id] ?? {};
    const a = att[id] ?? {};
    const m = money[id] ?? {};
    const present = a.present ?? 0;
    const absent = a.absent ?? 0;
    rows.push({
      batch_id: id,
      batch: b.name,
      code: b.code,
      period: b.period_label,
      status: b.status,
      capacity: b.max_players,
      enrolled: taken,
      occupancy_pct: b.max_players ? round1((100 * taken) / b.max_players) : 0,
      sessions_completed: s.completed ?? 0,
      sessions_cancelled: s.cancelled ?? 0,
      sessions_scheduled: s.scheduled ?? 0,
      present,
      absent,
      attendance_pct: present + absent ? round1((100 * present) / (present + absent)) : null,
      billed: billedOf(m),
      collected: m.payment ?? 0,
      coach_payable: await coachPayableTotal(academyId, start, end, { batchId: b._id }),
      venue_payable: await venuePayableTotal(academyId, start, end, { batchId: b._id }),
    });
  }
  return rows;
}

/** Look up names for ids once: Map(id -> name). */
async function namesById(Model, ids) {
  const out = new Map();
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) return out;
  for (const doc of await Model.find({ _id: { $in: unique } }).select("name")) out.set(String(doc._id), doc.name);
  return out;
}

async function recordedSessions(academyId, start, end, { venueId = null, batchId = null, coachId = null }) {
  const match = { ...sessionMatch(academyId, start, end, venueId, batchId), status: { $in: RECORDED } };
  if (coachId) match["coaches.coach_id"] = oid(coachId);
  const sessions = await Session.find(match).sort({ session_date: 1, start_time: 1 });
  const batchNames = await namesById(Batch, sessions.map((s) => s.batch_id));
  const venueNames = await namesById(Venue, sessions.map((s) => s.venue_id));
  return { sessions, batchNames, venueNames };
}

/** One row per coach per recorded (completed/cancelled) session. */
export async function coachSessions(academyId, start, end, { coachId = null, venueId = null, batchId = null } = {}) {
  const { sessions, batchNames, venueNames } = await recordedSessions(academyId, start, end, { venueId, batchId });
  const coachNames = await namesById(User, sessions.flatMap((s) => s.coaches.map((c) => c.coach_id)));
  const rows = [];
  for (const s of sessions) {
    const batch = batchNames.get(String(s.batch_id));
    const venue = venueNames.get(String(s.venue_id));
    if (batch === undefined || venue === undefined) continue;
    for (const sc of s.coaches) {
      if (coachId && !sameId(sc.coach_id, coachId)) continue;
      const coach = coachNames.get(String(sc.coach_id));
      if (coach === undefined) continue;
      rows.push({
        session_id: String(s._id),
        date: s.session_date,
        coach_id: String(sc.coach_id),
        coach,
        batch,
        venue,
        status: s.status,
        scheduled_hours: sc.scheduled_hours,
        hours_coached: sc.hours_coached || 0,
        rate_applied: sc.rate_applied || 0,
        adjustment: sc.adjustment_amount || 0,
        adjustment_note: sc.adjustment_note ?? null,
        payable: sc.payable_amount || 0,
      });
    }
  }
  return rows;
}

function paidStatus(payable, paid) {
  if (payable <= 0 && paid <= 0) return "nothing_due";
  if (paid >= payable) return "paid";
  return paid > 0 ? "partial" : "pending";
}

/** [rows per coach, session detail]: sessions, hours, payable, paid and balance for the period. */
export async function coachReport(academyId, start, end, { coachId = null, venueId = null, batchId = null } = {}) {
  const detail = await coachSessions(academyId, start, end, { coachId, venueId, batchId });
  const agg = new Map();
  for (const r of detail) {
    if (!agg.has(r.coach_id)) agg.set(r.coach_id, { coach_id: r.coach_id, coach: r.coach, sessions: 0, hours: 0, payable: 0 });
    const a = agg.get(r.coach_id);
    if (r.status === "completed") a.sessions += 1;
    a.hours = q(a.hours + r.hours_coached);
    a.payable = q(a.payable + r.payable);
  }
  const paid = await grouped(
    CoachPayment,
    { academy_id: oid(academyId), period_month: { $gte: monthStart(start), $lte: monthStart(end) } },
    "coach_id",
  );
  const rows = [];
  for (const a of agg.values()) {
    const p = q(paid[a.coach_id] ?? 0);
    rows.push({
      ...a,
      hours: q(a.hours),
      payable: q(a.payable),
      paid: p,
      balance: q(a.payable - p),
      status: paidStatus(q(a.payable), p),
    });
  }
  rows.sort((x, y) => (x.coach < y.coach ? -1 : x.coach > y.coach ? 1 : 0));
  return [rows, detail];
}

/** One row per recorded (completed/cancelled) session with its court snapshot. */
export async function venueSessions(academyId, start, end, { venueId = null, batchId = null, coachId = null } = {}) {
  const { sessions, batchNames, venueNames } = await recordedSessions(academyId, start, end, { venueId, batchId, coachId });
  const rows = [];
  for (const s of sessions) {
    const batch = batchNames.get(String(s.batch_id));
    const venue = venueNames.get(String(s.venue_id));
    if (batch === undefined || venue === undefined) continue;
    const charged = s.venue_charge_applies;
    const hours = charged ? hoursBetween(s.duration_minutes) : 0;
    rows.push({
      session_id: String(s._id),
      date: s.session_date,
      venue_id: String(s.venue_id),
      venue,
      batch,
      status: s.status,
      start_time: s.start_time,
      day_type: s.day_type,
      time_slot: s.time_slot,
      duration_hours: hours,
      courts: charged ? s.courts_booked : 0,
      court_hours: q(hours * s.courts_booked),
      rate_applied: s.venue_rate_applied || 0,
      payable: s.court_payable || 0,
    });
  }
  return rows;
}

/** [rows per venue, session detail]: sessions, court hours, payable, paid and balance for the period. */
export async function venueReport(academyId, start, end, { venueId = null, batchId = null, coachId = null } = {}) {
  const detail = await venueSessions(academyId, start, end, { venueId, batchId, coachId });
  const agg = new Map();
  for (const r of detail) {
    if (!agg.has(r.venue_id)) {
      agg.set(r.venue_id, { venue_id: r.venue_id, venue: r.venue, sessions: 0, hours_booked: 0, court_hours: 0, payable: 0 });
    }
    const a = agg.get(r.venue_id);
    if (r.status === "completed") a.sessions += 1;
    a.hours_booked = q(a.hours_booked + r.duration_hours);
    a.court_hours = q(a.court_hours + r.court_hours);
    a.payable = q(a.payable + r.payable);
  }
  const paid = await grouped(
    VenuePayment,
    { academy_id: oid(academyId), period_month: { $gte: monthStart(start), $lte: monthStart(end) } },
    "venue_id",
  );
  const rows = [];
  for (const a of agg.values()) {
    const p = q(paid[a.venue_id] ?? 0);
    rows.push({
      ...a,
      hours_booked: q(a.hours_booked),
      court_hours: q(a.court_hours),
      payable: q(a.payable),
      paid: p,
      balance: q(a.payable - p),
      status: paidStatus(q(a.payable), p),
    });
  }
  rows.sort((x, y) => (x.venue < y.venue ? -1 : x.venue > y.venue ? 1 : 0));
  return [rows, detail];
}

/** Per-student billing, payments, credits, balance, attendance and remaining sessions for [start, end]. */
export async function studentReport(academyId, start, end, { batchId = null } = {}) {
  const profiles = await StudentProfile.find({ academy_id: academyId });
  const users = new Map();
  if (profiles.length) {
    for (const u of await User.find({ _id: { $in: profiles.map((p) => p._id) } }).select("name mobile")) users.set(String(u._id), u);
  }
  let students = profiles.filter((p) => users.has(String(p._id))).map((p) => [p, users.get(String(p._id))]);
  if (batchId) {
    const inBatch = new Set((await BatchStudent.find({ batch_id: batchId }).select("student_id")).map((e) => String(e.student_id)));
    students = students.filter(([p]) => inBatch.has(String(p._id)));
  }
  const ids = students.map(([p]) => oid(p._id));

  const movements = {};
  const mv = { student_id: { $in: ids }, txn_date: { $gte: start, $lte: end } };
  if (batchId) mv.batch_id = oid(batchId);
  for (const r of await LedgerTransaction.aggregate([
    { $match: mv },
    { $group: { _id: { student: "$student_id", type: "$txn_type" }, total: { $sum: "$amount" } } },
  ])) {
    (movements[String(r._id.student)] ??= {})[r._id.type] = q(r.total);
  }

  const closing = await grouped(LedgerTransaction, { student_id: { $in: ids }, txn_date: { $lte: end } }, "student_id");

  const attendance = {};
  const am = { student_id: { $in: ids }, session_date: { $gte: start, $lte: end } };
  if (batchId) am.attended_batch_id = oid(batchId);
  for (const r of await SessionAttendance.aggregate([
    { $match: am },
    { $group: { _id: { student: "$student_id", status: "$attendance_status", makeup: "$is_makeup" }, n: { $sum: 1 } } },
  ])) {
    const key = r._id.makeup && r._id.status === "present" ? "makeup" : r._id.status;
    const a = (attendance[String(r._id.student)] ??= {});
    a[key] = (a[key] ?? 0) + r.n;
  }

  const plans = await StudentFeePlan.find({ student_id: { $in: ids }, status: "active" }).sort({ _id: 1 });
  const usage = await ledger.planUsage(plans);
  const remaining = {};
  for (const p of plans) {
    const key = String(p.student_id);
    remaining[key] = (remaining[key] ?? 0) + usage[String(p._id)].remaining;
  }

  students.sort(([, a], [, b]) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return students.map(([profile, user]) => {
    const id = String(profile._id);
    const m = movements[id] ?? {};
    const a = attendance[id] ?? {};
    return {
      student_id: id,
      student: user.name,
      mobile: user.mobile,
      status: profile.status,
      billed: billedOf(m),
      paid: m.payment ?? 0,
      credits: q((m.cancellation_credit ?? 0) + (m.carry_forward ?? 0)),
      refunds: q(0 - (m.refund ?? 0)),
      balance: q(closing[id] ?? 0),
      present: a.present ?? 0,
      makeups: a.makeup ?? 0,
      absent: a.absent ?? 0,
      cancelled: a.session_cancelled ?? 0,
      sessions_remaining: remaining[id] ?? 0,
    };
  });
}
