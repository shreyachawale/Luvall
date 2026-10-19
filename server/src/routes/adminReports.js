/** Admin: overview dashboard, reports with CSV/Excel export, and the audit log. */
import ExcelJS from "exceljs";
import express from "express";

import { adminOnly } from "../middleware/auth.js";
import {
  AuditLog,
  BatchStudent,
  CoachProfile,
  Enquiry,
  MakeupCredit,
  oid,
  Payment,
  Session,
  StudentFeePlan,
  StudentProfile,
  toJSON,
  User,
  Venue,
} from "../models/index.js";
import * as attSvc from "../services/attendance.js";
import * as finance from "../services/finance.js";
import * as makeups from "../services/makeups.js";
import { today } from "../utils/clock.js";
import { addDays, monthEnd, monthLongLabel, monthStart } from "../utils/dates.js";
import { badRequest, NotFoundError } from "../utils/errors.js";
import { read, write } from "../utils/http.js";
import { opt, parseQuery, z, zBool, zDate, zId, zInt } from "../utils/validate.js";
import { ilike, pageOut, pageParams, period } from "./common.js";
import { pattern } from "./crud.js";
import { sessionOut } from "./serializers.js";

const router = express.Router();

/**
 * period() with Python's month parsing: "2026-7" is read as July and an impossible month ("2026-13")
 * is a 400 "month must be YYYY-MM" instead of being rolled over.
 */
export function reportPeriod(start, end, month) {
  if (month) {
    const parts = String(month).split("-");
    if (parts.length !== 2 || !parts.every((p) => /^\s*\+?\d+\s*$/.test(p))) throw badRequest("month must be YYYY-MM");
    const [year, mon] = parts.map(Number);
    if (year < 1 || year > 9999 || mon < 1 || mon > 12) throw badRequest("month must be YYYY-MM");
    return period(null, null, `${String(year).padStart(4, "0")}-${String(mon).padStart(2, "0")}`);
  }
  return period(start ?? null, end ?? null, null);
}

// ---- Overview ------------------------------------------------------------------------------------------------

/** Ids of the academy's student profiles (BatchStudent has no academy_id; Python joined StudentProfile). */
async function academyStudentIds(academyId) {
  return StudentProfile.find({ academy_id: academyId }).distinct("_id");
}

router.get(
  "/admin/overview",
  adminOnly,
  write(async (req) => {
    const aid = req.academy._id;
    const t = today();
    await makeups.expireDue(aid);
    const s = monthStart(t);
    const e = monthEnd(t);
    const summary = await finance.summary(aid, s, e);
    const upcoming = await Session.find({ academy_id: aid, session_date: { $gte: t, $lte: addDays(t, 2) } })
      .sort({ session_date: 1, start_time: 1, _id: 1 })
      .limit(20);
    const unrecorded = await Session.countDocuments({ academy_id: aid, status: "scheduled", session_date: { $lt: t } });
    const studentIds = await academyStudentIds(aid);
    const pendingEnrollments = await BatchStudent.countDocuments({ student_id: { $in: studentIds }, status: "pending" });
    const pendingMakeups = await MakeupCredit.countDocuments({ academy_id: aid, status: "pending_approval" });
    const plansToClose = await StudentFeePlan.countDocuments({ academy_id: aid, status: "active", end_date: { $lt: t } });
    const newEnquiries = await Enquiry.countDocuments({ academy_id: aid, status: "new" });
    const since = addDays(t, -90);
    const unbilled = await attSvc.unbilledAttendanceCount(aid, since);
    const [zeroRate] = await Session.aggregate([
      { $match: { academy_id: oid(aid), status: "completed", session_date: { $gte: since } } },
      { $unwind: "$coaches" },
      { $match: { "coaches.rate_applied": 0 } },
      { $count: "n" },
    ]);
    const zeroVenue = await Session.countDocuments({
      academy_id: aid,
      status: "completed",
      venue_rate_applied: 0,
      venue_charge_applies: true,
      session_date: { $gte: since },
    });
    const coachesWithoutRate = await CoachProfile.countDocuments({ academy_id: aid, status: "active", "rates.0": { $exists: false } });
    const venuesWithoutRate = await Venue.countDocuments({ academy_id: aid, status: "active", "rates.0": { $exists: false } });

    const alerts = [];
    const alert = (count, level, text, link) => {
      if (count) alerts.push({ count, level, text, link });
    };
    alert(summary.receivables.pending_verification_count, "warning", "payments awaiting verification", "/admin/finance");
    alert(pendingEnrollments, "warning", "enrollments awaiting confirmation", "/admin/batches");
    alert(unrecorded, "danger", "past sessions without attendance", "/admin/sessions?status=scheduled&past=1");
    alert(pendingMakeups, "warning", "make-up requests awaiting approval", "/admin/makeups?status=pending_approval");
    alert(plansToClose, "info", "plans past their end date to close", "/admin/finance");
    alert(unbilled, "warning", "attendances not linked to any fee plan (last 90 days)", "/admin/reports");
    alert(zeroRate?.n ?? 0, "danger", "coach entries recorded with a zero rate (last 90 days)", "/admin/coaches");
    alert(zeroVenue, "danger", "sessions recorded with a zero venue rate (last 90 days)", "/admin/venues");
    alert(coachesWithoutRate, "danger", "active coaches without an hourly rate", "/admin/coaches");
    alert(venuesWithoutRate, "danger", "active venues without a rate card", "/admin/venues");
    alert(summary.receivables.students_with_dues, "info", "students with outstanding dues", "/admin/students?dues=1");
    alert(newEnquiries, "info", "new website enquiries", "/admin/website/enquiries");

    const upcomingSessions = [];
    for (const x of upcoming) upcomingSessions.push(await sessionOut(x, true));
    return {
      month: monthLongLabel(s),
      summary,
      series: await finance.monthlySeries(aid, t, { months: 6 }),
      upcoming_sessions: upcomingSessions,
      alerts,
      counts: {
        active_students: await StudentProfile.countDocuments({ academy_id: aid, status: "active" }),
        active_enrollments: await BatchStudent.countDocuments({ student_id: { $in: studentIds }, status: "active" }),
      },
    };
  }),
);

// ---- Reports -------------------------------------------------------------------------------------------------

const FilterQuery = {
  month: opt(z.string()),
  start: opt(zDate),
  end: opt(zDate),
  coach_id: opt(zId),
  venue_id: opt(zId),
  batch_id: opt(zId),
};

const FinanceQuery = z.object({ ...FilterQuery, months: zInt.default(6) });

// Registered before /admin/reports/:kind so "finance" is not read as a report kind.
router.get(
  "/admin/reports/finance",
  adminOnly,
  read(async (req) => {
    const qy = parseQuery(FinanceQuery, req);
    const [s, e] = reportPeriod(qy.start, qy.end, qy.month);
    const filters = { coachId: qy.coach_id ?? null, venueId: qy.venue_id ?? null, batchId: qy.batch_id ?? null };
    return {
      summary: await finance.summary(req.academy._id, s, e, filters),
      series: await finance.monthlySeries(req.academy._id, e, { months: Math.min(Math.max(qy.months, 1), 24), ...filters }),
    };
  }),
);

/** Returns [summary rows, detail rows] for a report kind. */
async function buildReport(kind, academyId, s, e, { coachId, venueId, batchId }) {
  if (kind === "batches") return [await finance.batchReport(academyId, s, e, { batchId, coachId, venueId }), []];
  if (kind === "coaches") return finance.coachReport(academyId, s, e, { coachId, venueId, batchId });
  if (kind === "venues") return finance.venueReport(academyId, s, e, { venueId, batchId, coachId });
  if (kind === "students") return [await finance.studentReport(academyId, s, e, { batchId }), []];
  if (kind === "monthly") {
    const [sy, sm] = s.split("-").map(Number);
    const [ey, em] = e.split("-").map(Number);
    const months = Math.max(1, (ey - sy) * 12 + em - sm + 1);
    return [await finance.monthlySeries(academyId, e, { months, coachId, venueId, batchId }), []];
  }
  throw new NotFoundError("Unknown report");
}

const ReportQuery = z.object(FilterQuery);

router.get(
  "/admin/reports/:kind",
  adminOnly,
  read(async (req) => {
    const qy = parseQuery(ReportQuery, req);
    const [s, e] = reportPeriod(qy.start, qy.end, qy.month);
    const [rows, detail] = await buildReport(req.params.kind, req.academy._id, s, e, {
      coachId: qy.coach_id ?? null,
      venueId: qy.venue_id ?? null,
      batchId: qy.batch_id ?? null,
    });
    return { period: { start: s, end: e }, rows, detail };
  }),
);

/** A cell value as Python's csv/openpyxl writers saw it after _cell(). */
function cellValue(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** One CSV field with Python's csv.writer (excel dialect, QUOTE_MINIMAL) quoting. */
function csvField(value) {
  if (value === null || value === undefined) return "";
  let text;
  if (typeof value === "boolean") text = value ? "True" : "False";
  else text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Python's str.title() for the ASCII column names ("hours_coached" -> "Hours Coached"). */
function titleCase(text) {
  return text.replace(/[A-Za-z]+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

const ExportQuery = z.object({
  ...FilterQuery,
  format: pattern(/^(csv|xlsx)$/).default("csv"),
  detail: zBool.default(false),
});

router.get(
  "/admin/reports/:kind/export",
  adminOnly,
  read(async (req, res) => {
    const qy = parseQuery(ExportQuery, req);
    const { kind } = req.params;
    const [s, e] = reportPeriod(qy.start, qy.end, qy.month);
    const [summary, details] = await buildReport(kind, req.academy._id, s, e, {
      coachId: qy.coach_id ?? null,
      venueId: qy.venue_id ?? null,
      batchId: qy.batch_id ?? null,
    });
    const rows = qy.detail ? details : summary;
    const columns = rows.length ? Object.keys(rows[0]) : ["no_data"];
    const filename = `luvall-${kind}${qy.detail ? "-detail" : ""}-${s}-to-${e}.${qy.format}`;
    let data;
    let mediaType;
    if (qy.format === "csv") {
      const lines = [columns.map(csvField).join(",")];
      for (const r of rows) lines.push(columns.map((c) => csvField(cellValue(r[c]))).join(","));
      // utf-8-sig: the byte-order mark makes Excel open the file as UTF-8.
      data = Buffer.from(`﻿${lines.map((l) => `${l}\r\n`).join("")}`, "utf8");
      mediaType = "text/csv; charset=utf-8";
    } else {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(kind.slice(0, 31));
      const table = [columns.map((c) => titleCase(c.replaceAll("_", " "))), ...rows.map((r) => columns.map((c) => cellValue(r[c])))];
      for (const values of table) ws.addRow(values);
      columns.forEach((_c, i) => {
        const longest = Math.max(...table.map((values) => String(values[i] || "").length));
        ws.getColumn(i + 1).width = Math.min(longest + 2, 40);
      });
      data = Buffer.from(await wb.xlsx.writeBuffer());
      mediaType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
    res.setHeader("Content-Type", mediaType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(data);
  }),
);

// ---- Audit log -----------------------------------------------------------------------------------------------

const AuditQuery = z.object({ entity_type: opt(z.string()), user_id: opt(zId), q: opt(z.string()) });

router.get(
  "/admin/audit",
  adminOnly,
  read(async (req) => {
    const qy = parseQuery(AuditQuery, req);
    const filter = { academy_id: req.academy._id };
    if (qy.entity_type) filter.entity_type = qy.entity_type;
    if (qy.user_id) filter.user_id = qy.user_id;
    if (qy.q) filter.summary = ilike(qy.q);
    const { page, pageSize, skip } = pageParams(req.query);
    const [total, entries, types] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter).sort({ _id: -1 }).skip(skip).limit(pageSize),
      AuditLog.distinct("entity_type", { academy_id: req.academy._id }),
    ]);
    const userIds = [...new Set(entries.filter((a) => a.user_id).map((a) => String(a.user_id)))];
    const names = new Map((await User.find({ _id: { $in: userIds } }).select("name")).map((u) => [String(u._id), u.name]));
    const items = entries.map((a) => ({ ...toJSON(a), user_name: a.user_id ? (names.get(String(a.user_id)) ?? null) : null }));
    return { ...pageOut(items, total, page, pageSize), entity_types: types.sort() };
  }),
);

router.get(
  "/admin/payments/pending-count",
  adminOnly,
  read(async (req) => ({ count: await Payment.countDocuments({ academy_id: req.academy._id, status: "pending" }) })),
);

export default router;
