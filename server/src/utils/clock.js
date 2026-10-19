/** Academy-local clock. Tests can pin "today" (and the current instant) with freeze(). */

import { config } from "../config.js";

let frozenToday = null;
let frozenNow = null;

function partsInZone(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}

/** Current instant. */
export function now() {
  return frozenNow ? new Date(frozenNow) : new Date();
}

/** Academy-local calendar date "YYYY-MM-DD". */
export function today() {
  return frozenToday ?? partsInZone().date;
}

/** Academy-local wall-clock time "HH:MM". */
export function nowTime() {
  return partsInZone(now()).time;
}

/** Offset of the academy timezone from UTC in minutes at the given instant. */
function zoneOffsetMinutes(at = new Date()) {
  const p = partsInZone(at);
  const asUTC = Date.parse(`${p.date}T${p.time}:00Z`);
  return Math.round((asUTC - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** The instant at which an academy-local date + time occurs. */
export function localInstant(date, time) {
  const naive = Date.parse(`${date}T${String(time).slice(0, 5)}:00Z`);
  return new Date(naive - zoneOffsetMinutes(new Date(naive)) * 60000);
}

/**
 * Pin the clock for tests: today() returns `date` and now() returns `time` (academy-local) on that date.
 * freeze(null) restores the real clock.
 */
export function freeze(date, time = "12:00") {
  frozenToday = date ?? null;
  frozenNow = date ? localInstant(date, time).getTime() : null;
}
