# Scope, assumptions and open decisions

## Delivered in this release

Mapped to the BRD's initial-release acceptance criteria (section 16):

| # | Criterion | Where |
| --- | --- | --- |
| 1 | Admin can log in and manage core master data | Admin → Students, Coaches, Venues, Fee plans, Batches, Users |
| 2 | Batch with recurring schedule, venue and coach assignment | Admin → Batches → New batch / Schedule & coaches |
| 3 | Create/record individual sessions | Batch → Generate sessions; Sessions → One-off session |
| 4 | Admin/Coach record attendance for active students | Coach → session; Admin → Sessions → session |
| 5 | Make-up recorded in a different batch, original batch retained | Make-up attendee in any session; `original_batch_id` + `attended_batch_id` |
| 6 | Cancelled sessions distinguishable from absences | Session cancel → `session_cancelled` rows, never an absence, no make-up |
| 7 | Package/fee, discount, payment reflected in the ledger | Student → Packages / Payments / Ledger |
| 8 | Coach payable from actual hours × rate | Snapshotted per session; Finance → Coach payouts; Reports |
| 9 | Venue payable from duration × courts × rate | Snapshotted per session; Finance → Venue payouts; Reports |
| 10 | Student dashboard: schedule, attendance, financial/credit info | Student portal |
| 11 | Coach dashboard: assigned sessions, students | Coach portal |
| 12 | Website content updated through the CMS | Admin → Website & marketing (homepage, posts, programs, events, testimonials, FAQs, announcements) |
| 13 | Upload/publish images, manage gallery | Website → Media library, Gallery albums |
| 14 | HTTPS, backups, basic monitoring | `docker-compose.yml` (Caddy auto-HTTPS, nightly `mongodump` + media backups), `/api/health`, JSON logs |
| 15 | Master data migration | `npm run cli -- import-students file.csv` + opening balances; ledger "opening balance" adjustments |

Also included from the brief: dynamic campaigns with cover image, multiple images, reel/video URL, category,
publication and expiry dates, draft/published; live seat availability and Full status; capacity override;
make-up eligibility, approval, expiry and booking; extra attendees (make-up, drop-in, other) with admin-chosen billing;
traceable transaction history; monthly financial dashboard with filters, charts and CSV/Excel export; operational
alerts; activity (audit) log; effective-dated rates; mobile-first portals; `academy_id` on all tenant-owned collections.

## Not built (future scope, as agreed)

Per BRD section 3 (Phase 5) / section 17 and the brief's section 15:

- Automated payment gateway (payments are UPI/QR + admin verification).
- WhatsApp/SMS/email delivery and automated messaging. The app shows reminders and announcements in the portals,
  creates `wa.me` links for manual WhatsApp confirmation, and has a `Notifier` interface
  (`server/src/services/notifications.js`) where a provider can be plugged in later.
- Tournament management, brackets, fixtures, rankings.
- Additional sports, multi-academy SaaS / super admin (the data model already carries `academy_id`).
- Native mobile app, AI features, QR attendance, player performance notes, advanced analytics/accounting.

## Assumptions made for the open client questions

Everything below is configurable in **Admin → Settings** unless noted, so the academy can change it after confirming.

| Checklist item | Default implemented |
| --- | --- |
| 1. Direct booking vs approval; waitlist | Students self-enroll; the seat is held as *pending* until the admin verifies the UPI payment or confirms the enrollment. **No waitlist** — full batches show *Full* and block standard enrollment; admins can override capacity. |
| 2. Monthly batches vs recurring | Each batch has a period (e.g. `2026-11`). **Roll over to next period** copies the batch, schedule, coaches and pricing and re-enrolls current students as pending. |
| 3. Student pricing | A *fee plan* (template) is linked to a batch; each student gets their own *package* (price, fixed/percentage discount, sessions included). Mid-month joiners get the full template; the admin edits the package to pro-rate. |
| 4. Absences and make-ups | Absence uses a package session and creates a make-up valid for 30 days; no approval needed; students can book into another batch's session with a free spot up to 2 hours before. A no-show on a booked make-up returns the credit. |
| 5. Extra attendees | Drop-ins pay the drop-in fee (₹500 default) charged to their ledger; coaches can add walk-in players by name + mobile. Admin can switch any extra to package credit, make-up or complimentary. |
| 6. Coach and venue rates | Fixed per coach / per venue slot with effective dates; the rate in force on the session date is snapshotted. Admin can override a session's coach rate or add an adjustment. A session crossing the morning/evening boundary uses the slot of its start time (boundary 12:00). |
| 7. Finance view | Both: operating surplus (billed − payable) and net cash flow (cash in − cash out). Manual expenses are entered under Finance → Expenses; coach and court costs are calculated, never entered. |
| 8. Payments & notifications | UPI/QR with manual verification; WhatsApp confirmation link; in-portal reminders only. |
| Cancellations | Admin chooses per session: carry forward (default), refund (credits the per-session value) or no adjustment. Venue charge for a cancelled session is optional. |
| Unused sessions at package end | Admin closes the package: carry forward as account credit (default) or forfeit. |
| Coach attendance corrections | Coaches can submit/correct for 3 days after the session; admins anytime (audited). |

## Known limitations / next steps

- Password reset is done by the admin (no self-service "forgot password", which needs SMS/email delivery).
- Uploaded media is stored on the server volume; move to S3/R2/Azure Blob by replacing `LocalStorage` in
  `server/src/services/media.js`.
- The login rate limiter is in-process; use a shared store (e.g. Redis) if the backend runs on several machines.
- Before go-live: map the existing Google Form / spreadsheet columns to the import CSV, reconcile one sample month
  of attendance, coach pay and court pay against the spreadsheets (BRD T20–T22).
