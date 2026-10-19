/**
 * Calendar dates are stored as "YYYY-MM-DD" strings and times as "HH:MM" strings (academy-local).
 * Lexical order equals chronological order, so they can be compared and range-queried directly.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** A real calendar date "YYYY-MM-DD" (2026-02-30 is rejected; Date.parse would roll it over to March). */
export function isDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d); // unlike Date.UTC, keeps years 1-99 as they are
  return y >= 1 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isTime(value) {
  return typeof value === "string" && TIME_RE.test(value);
}

/** Normalise "HH:MM[:SS]" to "HH:MM". */
export function normTime(value) {
  if (value === null || value === undefined) return value;
  return String(value).slice(0, 5);
}

function toUTC(date) {
  return new Date(`${date}T00:00:00Z`);
}

function fromUTC(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(date, days) {
  const d = toUTC(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUTC(d);
}

/** 0 = Monday ... 6 = Sunday (same convention as the batch schedule). */
export function weekday(date) {
  return (toUTC(date).getUTCDay() + 6) % 7;
}

export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

export function minutesBetween(start, end) {
  const [sh, sm] = normTime(start).split(":").map(Number);
  const [eh, em] = normTime(end).split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

export function monthStart(date) {
  return `${date.slice(0, 7)}-01`;
}

export function monthEnd(date) {
  const [y, m] = date.slice(0, 7).split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0));
  return fromUTC(last);
}

/** First day of every month touched by [start, end]. */
export function monthsBetween(start, end) {
  const out = [];
  let cur = monthStart(start);
  while (cur <= end) {
    out.push(cur);
    cur = addDays(monthEnd(cur), 1);
  }
  return out;
}

export function maxDate(...dates) {
  return dates.filter(Boolean).sort().at(-1) ?? null;
}

export function minDate(...dates) {
  return dates.filter(Boolean).sort()[0] ?? null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "15 Oct 2026" */
export function fmtDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

/** "Thu 15 Oct" */
export function fmtDay(date) {
  const [, m, d] = date.split("-").map(Number);
  return `${DAYS[weekday(date)]} ${String(d).padStart(2, "0")} ${MONTHS[m - 1]}`;
}

/** "Oct 2026" */
export function monthLabel(date) {
  const [y, m] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "October 2026" */
export function monthLongLabel(date) {
  const [y, m] = date.split("-").map(Number);
  return `${LONG_MONTHS[m - 1]} ${y}`;
}

/** "05:00 PM" */
export function fmtTime(time) {
  const [h, m] = normTime(time).split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${String(h % 12 || 12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${suffix}`;
}
