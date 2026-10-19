/** Effective-dated coach and venue rates (brief sections 8, 10, 11). */
import { CoachProfile, Venue } from "../models/index.js";
import { addDays, normTime, weekday } from "../utils/dates.js";
import { NotFoundError } from "../utils/errors.js";
import { q } from "../utils/money.js";

/**
 * Day type and time slot used to pick the venue rate: [dayType, timeSlot].
 *
 * A session that crosses the morning/evening boundary uses the slot of its start time.
 */
export function classifySlot(sessionDate, startTime, rules) {
  const dayType = rules.weekend_days.includes(weekday(sessionDate)) ? "weekend" : "weekday";
  const timeSlot = normTime(startTime) < normTime(rules.morning_evening_boundary) ? "morning" : "evening";
  return [dayType, timeSlot];
}

/** The row in force on `on` (latest effective_from wins), or null. */
function rowOn(rows, on) {
  let best = null;
  for (const r of rows) {
    if (r.effective_from > on) continue;
    if (r.effective_to && r.effective_to < on) continue;
    if (!best || r.effective_from > best.effective_from) best = r;
  }
  return best;
}

export async function coachRateOn(coachId, on) {
  const profile = await CoachProfile.findById(coachId).select("rates");
  if (!profile) return null;
  const row = rowOn(profile.rates, on);
  return row ? row.hourly_rate : null;
}

function venueRows(venue, dayType, timeSlot) {
  return venue.rates.filter((r) => r.day_type === dayType && r.time_slot === timeSlot);
}

export async function venueRateOn(venueId, dayType, timeSlot, on) {
  const venue = await Venue.findById(venueId).select("rates");
  if (!venue) return null;
  const row = rowOn(venueRows(venue, dayType, timeSlot), on);
  return row ? row.hourly_rate : null;
}

/**
 * Fit `newRow` into a timeline of rows so periods never overlap.
 *
 * The row in force just before `effectiveFrom` is closed the day before; the new row runs until the
 * next scheduled change (if any).
 */
function insertEffective(rows, newRow, effectiveFrom) {
  const earlier = rows.filter((r) => r.effective_from < effectiveFrom);
  const later = rows.filter((r) => r.effective_from > effectiveFrom).sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  if (earlier.length) {
    const previous = earlier.reduce((a, b) => (b.effective_from > a.effective_from ? b : a));
    if (previous.effective_to === null || previous.effective_to === undefined || previous.effective_to >= effectiveFrom) {
      previous.effective_to = addDays(effectiveFrom, -1);
    }
  }
  newRow.effective_to = later.length ? addDays(later[0].effective_from, -1) : null;
}

/** Add (or correct, when one starts the same day) a coach's hourly rate. Accepts the CoachProfile or its id. */
export async function setCoachRate(coach, hourlyRate, effectiveFrom) {
  const profile = coach instanceof CoachProfile ? coach : await CoachProfile.findById(coach);
  if (!profile) throw new NotFoundError("CoachProfile not found");
  const sameDay = profile.rates.find((r) => r.effective_from === effectiveFrom);
  if (sameDay) {
    sameDay.hourly_rate = q(hourlyRate);
    await profile.save();
    return sameDay;
  }
  const row = { hourly_rate: q(hourlyRate), effective_from: effectiveFrom, effective_to: null };
  insertEffective(profile.rates, row, effectiveFrom);
  profile.rates.push(row);
  await profile.save();
  return profile.rates[profile.rates.length - 1];
}

/** Add (or correct) one venue rate cell (day type x time slot). Accepts the Venue or its id. */
export async function setVenueRate(venue, dayType, timeSlot, hourlyRate, effectiveFrom) {
  const doc = venue instanceof Venue ? venue : await Venue.findById(venue);
  if (!doc) throw new NotFoundError("Venue not found");
  const rows = venueRows(doc, dayType, timeSlot);
  const sameDay = rows.find((r) => r.effective_from === effectiveFrom);
  if (sameDay) {
    sameDay.hourly_rate = q(hourlyRate);
    await doc.save();
    return sameDay;
  }
  const row = { day_type: dayType, time_slot: timeSlot, hourly_rate: q(hourlyRate), effective_from: effectiveFrom, effective_to: null };
  insertEffective(rows, row, effectiveFrom);
  doc.rates.push(row);
  await doc.save();
  return doc.rates[doc.rates.length - 1];
}

/** { weekday_morning, weekday_evening, weekend_morning, weekend_evening } in force on `on`. Accepts a Venue or id. */
export async function currentVenueRates(venue, on) {
  const doc = venue instanceof Venue ? venue : await Venue.findById(venue).select("rates");
  const out = {};
  for (const d of ["weekday", "weekend"]) {
    for (const s of ["morning", "evening"]) {
      const row = doc ? rowOn(venueRows(doc, d, s), on) : null;
      out[`${d}_${s}`] = row ? row.hourly_rate : null;
    }
  }
  return out;
}
