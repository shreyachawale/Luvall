/**
 * Money is stored as Number rupees and rounded to paise after every arithmetic step, so sums never
 * accumulate floating-point drift. Always pass computed amounts through q() before storing/comparing.
 */

export const ZERO = 0;

export function q(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON * Math.sign(n)) * 100) / 100;
}

/** Apply a fixed-amount or percentage discount (BR-06). Never goes below zero. */
export function finalFee(baseFee, discountType, discountValue) {
  const base = q(baseFee);
  const value = q(discountValue);
  if (discountType === "fixed") return Math.max(q(base - value), 0);
  if (discountType === "percent") {
    const pct = Math.min(Math.max(value, 0), 100);
    return q((base * (100 - pct)) / 100);
  }
  return base;
}

/** Internal per-session value = package fee / number of package sessions (BR-07). */
export function perSessionValue(fee, sessions) {
  if (!sessions || sessions <= 0) return 0;
  return q(Number(fee) / sessions);
}

export function hoursBetween(minutes) {
  return q(Number(minutes) / 60);
}

export function sum(values) {
  return q(values.reduce((acc, v) => acc + q(v), 0));
}
