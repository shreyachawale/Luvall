/**
 * Admin-editable business rules and homepage content.
 * Every rate, policy and default that the brief says must be "editable without code changes" lives here.
 */
import { z } from "zod";

/** Number from a number or numeric string, as Pydantic accepts; "" and null are invalid rather than 0. */
const num = () =>
  z.preprocess((v) => (v === "" || v === null ? Number.NaN : v), z.coerce.number({ invalid_type_error: "Input should be a valid decimal" }));
const int = () =>
  z.preprocess(
    (v) => (v === "" || v === null ? Number.NaN : v),
    z.coerce.number({ invalid_type_error: "Input should be a valid integer" }).int("Input should be a valid integer"),
  );

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Use HH:MM")
  .transform((v) => v.slice(0, 5));

export const MakeupPolicy = z.object({
  // When a regular student is marked absent, create a make-up entitlement automatically.
  eligible_on_absence: z.boolean().default(true),
  // If true, the entitlement starts as pending_approval and admin must approve it.
  requires_approval: z.boolean().default(false),
  // Days after the missed session within which the make-up must be used. null = never expires.
  expiry_days: int().pipe(z.number().min(1)).nullable().default(30),
  // Students may book their own make-up into another batch's session.
  student_can_book: z.boolean().default(true),
  // Hours before session start after which students can no longer book/cancel a make-up.
  booking_cutoff_hours: int().pipe(z.number().min(0)).default(2),
});

export const PaymentSettings = z.object({
  upi_id: z.string().default(""),
  payee_name: z.string().default(""),
  qr_image_url: z.string().default(""),
  whatsapp_number: z.string().default(""),
  instructions: z
    .string()
    .default(
      "Pay using the UPI ID or QR code, then submit the UPI transaction reference (UTR) below. " +
        "Your enrollment is confirmed once the academy verifies the payment.",
    ),
});

export const BusinessRules = z.object({
  default_min_players: int().pipe(z.number().min(1)).default(4),
  default_max_players: int().pipe(z.number().min(1)).default(6),
  // Sessions starting before this time use the morning venue rate, otherwise evening.
  morning_evening_boundary: time.default("12:00"),
  // 0 = Monday ... 6 = Sunday
  weekend_days: z.array(z.number().int().min(0).max(6)).default([5, 6]),
  default_cancellation_adjustment: z.enum(["refund", "carry_forward", "no_adjustment"]).default("carry_forward"),
  // What to do with unused package sessions when a plan is closed.
  unused_sessions_on_close: z.enum(["carry_forward", "forfeit"]).default("carry_forward"),
  drop_in_fee: num().pipe(z.number().min(0)).default(500),
  // Coaches can record / correct attendance for this many days after the session.
  attendance_edit_window_days: int().pipe(z.number().min(0)).default(3),
  reminder_hours_before: int().pipe(z.number().min(1)).default(24),
  makeup: MakeupPolicy.default({}),
  payment: PaymentSettings.default({}),
});

export const SiteContent = z.object({
  hero_eyebrow: z.string().default("Pickleball coaching academy"),
  hero_title: z.string().default("Learn, play and compete with LuvAll Sports"),
  hero_subtitle: z
    .string()
    .default("Structured pickleball batches for every level, run by certified coaches at courts across the city."),
  hero_image_url: z.string().default(""),
  about_title: z.string().default("About LuvAll Sports"),
  about_body: z
    .string()
    .default(
      "LuvAll Sports is a pickleball academy built around small batches, certified coaching and a friendly " +
        "community. Whether you are picking up a paddle for the first time or preparing for tournaments, " +
        "we have a batch for you.",
    ),
  about_image_url: z.string().default(""),
  stats: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .default([
      { label: "Players coached", value: "500+" },
      { label: "Certified coaches", value: "6" },
      { label: "Venues", value: "3" },
      { label: "Tournament podiums", value: "40+" },
    ]),
  contact_phone: z.string().default(""),
  contact_email: z.string().default(""),
  contact_address: z.string().default(""),
  contact_hours: z.string().default("Mon–Sun, 6 AM – 9 PM"),
  map_embed_url: z.string().default(""),
  instagram_url: z.string().default(""),
  youtube_url: z.string().default(""),
  facebook_url: z.string().default(""),
  seo_title: z.string().default("LuvAll Sports — Pickleball Academy"),
  seo_description: z
    .string()
    .default(
      "Pickleball coaching batches for beginners to advanced players. Certified coaches, small batches, " +
        "multiple venues. Join a batch today.",
    ),
});

/** Business rules for an academy with defaults filled in. */
export function businessRules(academy) {
  return BusinessRules.parse(academy?.settings ?? {});
}

export function siteContent(academy) {
  return SiteContent.parse(academy?.site_content ?? {});
}
