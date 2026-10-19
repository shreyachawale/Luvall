const inrFormatter = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inrPrecise = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });

export function inr(value: number | string | null | undefined, precise = false): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "—";
  const fmt = precise || !Number.isInteger(Math.round(n * 100) / 100) ? inrPrecise : inrFormatter;
  return fmt.format(n);
}

export function num(value: number | string | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

function parseDate(value: string): Date {
  // Date-only strings are calendar dates, not instants: keep them in local time.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}

export function fmtDate(value: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!value) return "—";
  return parseDate(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", ...opts });
}

export function fmtDay(value: string | null | undefined): string {
  if (!value) return "—";
  return parseDate(value).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtTime(value: string | null | undefined): string {
  if (!value) return "—";
  const [h, m] = value.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function timeRange(start: string, end: string): string {
  return `${fmtTime(start)} – ${fmtTime(end)}`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function monthISO(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthISO(d);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function scheduleSummary(schedules: { weekday: number; start_time: string; end_time: string }[]): string {
  if (!schedules?.length) return "Schedule to be announced";
  const groups = new Map<string, number[]>();
  for (const s of schedules) {
    const key = timeRange(s.start_time, s.end_time);
    groups.set(key, [...(groups.get(key) ?? []), s.weekday]);
  }
  return [...groups.entries()]
    .map(([time, days]) => `${days.sort().map((d) => WEEKDAYS[d]).join(" / ")} · ${time}`)
    .join(", ");
}

/** Convert a YouTube / Instagram / Vimeo / Facebook link into an embeddable URL. */
export function embedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}`;
    if (host.endsWith("youtube.com")) {
      const id = u.searchParams.get("v") ?? u.pathname.split("/").filter(Boolean).pop();
      if (u.pathname.startsWith("/shorts/") || u.pathname.startsWith("/embed/") || id)
        return `https://www.youtube-nocookie.com/embed/${id}`;
    }
    if (host.endsWith("instagram.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((p) => ["reel", "p", "tv"].includes(p));
      if (idx >= 0 && parts[idx + 1]) return `https://www.instagram.com/${parts[idx]}/${parts[idx + 1]}/embed`;
    }
    if (host.endsWith("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      return `https://player.vimeo.com/video/${id}`;
    }
    if (host.endsWith("facebook.com") || host === "fb.watch")
      return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}`;
  } catch {
    return null;
  }
  return null;
}

export function isVertical(url: string): boolean {
  return /instagram\.com|\/shorts\//.test(url);
}

export function waLink(number: string, text: string): string {
  return `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

export function upiLink(upiId: string, payee: string, amount?: number | string, note?: string): string {
  const params = new URLSearchParams({ pa: upiId, pn: payee || "LuvAll Sports", cu: "INR" });
  if (amount) params.set("am", String(amount));
  if (note) params.set("tn", note);
  return `upi://pay?${params.toString()}`;
}
