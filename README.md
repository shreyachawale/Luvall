# LuvAll Sports — Pickleball Academy Platform (MERN)

Marketing website + student, coach and admin portals that replace the academy's Google Forms and spreadsheets
with one system. Built from the *LuvAll Sports BRD v1.0* and the *Post-Meeting Development Brief*. This is the **first
release only**; future-scope items are not built (see [docs/SCOPE.md](docs/SCOPE.md)).

| Area | What it does |
| --- | --- |
| **Public website** | Home, About, Programs, Batches (live seat counts, Full badge), Coaches, Venues, News & achievements (photos + embedded reels), Gallery, Events, FAQ, Contact form, WhatsApp button. SEO titles/descriptions/Open Graph tags in the initial HTML, `sitemap.xml`, `robots.txt`, clean URLs. All content comes from the CMS. |
| **Student portal** | Enroll in a batch with UPI/QR payment + UTR, next-session reminder, upcoming sessions, attendance history, make-up booking, package usage (included/used/remaining), payments, full ledger statement. |
| **Coach portal** | Today's sessions, mark present/absent (mobile-first), add make-up/drop-in/walk-in attendees, actual times/courts/hours, assigned batches with student lists, monthly hours & earnings. |
| **Admin** | Overview with alerts, students, coaches (effective-dated rates), batches (schedules, capacity, enrollment, session generation, roll-over to next month), sessions (attendance corrections, cancellations with refund / carry-forward / no adjustment), make-ups, venues (4 effective-dated rate slots), fee plans, finance (UPI verification, payments, package closing, coach & venue payouts, expenses), reports with charts and CSV/Excel export, website CMS, settings, users & roles, activity log. |

## Stack

- **M**ongoDB 8 (single-node replica set — multi-document transactions keep every write atomic), Mongoose 8.
- **E**xpress 5 on **N**ode 22 (ESM JavaScript): REST API under `/api/v1`, JWT in an httpOnly cookie, zod validation.
  Code in `server/`.
- **R**eact 19 + React Router 7 + TypeScript + Tailwind CSS 4 + SWR, built with Vite. Code in `client/`.
  The look (condensed uppercase headlines, court imagery, rounded photo tiles) is described in
  [docs/DESIGN.md](docs/DESIGN.md).
- **Deploy:** one Node process (Express serves the API, the built React app and uploaded media) next to MongoDB.

## Run locally

Requirements: Node 22, MongoDB 7 or 8 running as a replica set (transactions need one).

```bash
# 1. MongoDB as a one-node replica set (macOS: brew install mongodb-community)
mkdir -p ~/data/luvall-db
mongod --replSet rs0 --dbpath ~/data/luvall-db --fork --logpath ~/data/luvall-db/mongod.log
mongosh --quiet --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'localhost:27017'}]})"  # first time only

# 2. API (http://localhost:4000)
cd server
npm install
npm run cli -- init           # creates the academy
npm run cli -- demo           # optional sample data (see logins below)
npm run dev

# 3. Web app (new terminal) — http://localhost:5173 (proxies /api and /media to :4000)
cd client
npm install
npm run dev
```

The server reads its settings from environment variables; the defaults suit local development
(`MONGODB_URI=mongodb://127.0.0.1:27017/luvall?replicaSet=rs0`, port 4000, timezone `Asia/Kolkata`).
See `server/src/config.js` for the full list (`JWT_SECRET`, `COOKIE_SECURE`, `ALLOWED_ORIGINS`, `SITE_URL`,
`MEDIA_ROOT`, `CLIENT_DIST`, `TZ_ACADEMY`, `MAX_UPLOAD_MB`, …).

To try the production build locally: `cd client && npm run build`, then start the server — it serves
`client/dist` with the SEO tags injected at http://localhost:4000.

Demo logins (sample data only — never load `demo` in production):

| Role | Mobile | Password |
| --- | --- | --- |
| Admin | 9000000001 | Admin@12345 |
| Coach | 9000000011 | Coach@12345 |
| Student | 9000000100 | Student@123 |

The demo month is built around today's date: past sessions have attendance, absences created make-up credits, one
session is cancelled with carry-forward, there is a make-up and a walk-in drop-in, and two payments wait for
verification.

## Tests

```bash
cd server && npm test                      # vitest + supertest against a throw-away MongoDB replica set
cd client && npm run typecheck && npm run build
```

The server tests start their own in-memory replica set (`mongodb-memory-server`; it downloads a MongoDB binary on
first run, or set `MONGOMS_SYSTEM_BINARY=/path/to/mongod` to use an installed one). They run with a frozen clock
(today = 2026-10-15) and cover the calculations in the brief — discounts and per-session value, effective-dated coach
and venue rates (history never rewritten), court payable, two coaches per session, capacity and Full, UPI
verification, make-up creation/booking/usage without double counting, cancellations vs absences, drop-in fees,
carry-forward on package close, the finance summary (cash vs billed vs payable) — plus every API area: role-based
access, CSRF origin checks, login rate limiting, CMS publish windows, image validation, exports and the SEO shell.

## Production

1. Run MongoDB as a replica set (as above) and build the client: `cd client && npm ci && npm run build`.
2. Start the server with `NODE_ENV=production`, a random `JWT_SECRET`, `COOKIE_SECURE=true`,
   `SITE_URL=https://<domain>` and `ALLOWED_ORIGINS=https://<domain>`: `cd server && npm ci && npm start`.
   Put an HTTPS reverse proxy (nginx, Caddy, …) in front of port 4000.
3. Create the academy and first admin: `npm run cli -- init --admin-name "Owner" --admin-mobile 98xxxxxxxx`
   (prompts for the password).
4. Sign in at `https://<domain>/login` → **Settings** (UPI ID, QR image, WhatsApp number, policies) → **Venues** (rates)
   → **Coaches** (rates) → **Fee plans** → **Batches** → **Generate sessions** → **Website & marketing**.

**Backups:** `mongodump --archive --gzip` the database and tar `server/media` regularly.

**Monitoring:** `GET /api/health` (pings the database); logs are structured JSON lines on stdout.

## Operations CLI

```bash
npm run cli -- init [--admin-mobile ... --admin-name ... --admin-email ... --admin-password ...]
npm run cli -- import-students students.csv   # columns: name,mobile,email,skill_level,opening_balance
npm run cli -- send-reminders                 # session reminders through the notifier (logs only for now)
npm run cli -- demo                           # sample data for development / UAT
```

## How the money works

- **Ledger** (per student, append-only): fee charged (−), payments (+), cancellation refund credits (+),
  carry-forward credits (+), refunds paid (−), drop-in fees (−), manual adjustments (±). Balance < 0 = dues.
  Corrections post a new entry for the difference — nothing is edited or double counted.
- **Package usage** is derived from attendance rows, never stored counters (BR-15): regular present/absent and
  "no adjustment" cancellations use a session; make-up attendance does not; refund/carry-forward cancellations don't.
- **Coach payable** = actual hours × rate in force on the session date + admin adjustments, snapshotted per session.
- **Court payable** = duration (h) × courts × venue rate for the weekday/weekend × morning/evening slot, snapshotted.
- **Reports** keep *billed*, *cash collected*, *credits issued* and *expenses payable/paid* separate, and show both
  an operating view (billed − payable) and a cash view (cash in − cash out).
- Amounts are stored as rupees rounded to paise; calendar dates as `YYYY-MM-DD` strings in the academy's timezone.

## Project layout

```
server/src/models       Mongoose models (academy_id on all tenant data; schedules, rates and session coaches embedded)
server/src/services     business rules: ledger, attendance, make-ups, batches, rates, finance, media, notifications
server/src/routes       auth, public, student, coach (+ shared session endpoints), admin*
server/src/seo.js       serves the React build with per-page meta tags, sitemap.xml and robots.txt
server/src/cli.js       init, demo, import-students, send-reminders
server/test             vitest suite
client/src/pages        public site, student/, coach/, admin/
client/src/components   ui kit, portal shell, attendance editor, admin CRUD/forms, charts
docs/SCOPE.md           scope, assumptions and open client decisions
docs/DESIGN.md          visual design system (tokens, type, components, patterns)
```
