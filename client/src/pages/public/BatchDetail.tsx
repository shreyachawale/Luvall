import { ArrowLeft, ArrowRight, CalendarDays, Clock, MapPin, Users } from "lucide-react";
import { Link, useParams } from "react-router";

import { Img, SeatsBadge, type PublicBatch } from "@/components/public/cards";
import { Seo } from "@/components/seo";
import { ErrorNote, LinkButton, Loading } from "@/components/ui";
import { maybeSignedIn, useApi } from "@/lib/api";
import { WEEKDAYS, fmtDate, inr, timeRange, titleCase } from "@/lib/format";
import NotFound from "@/pages/public/NotFound";

export default function BatchPage() {
  const { id } = useParams();
  const { data: b, error } = useApi<PublicBatch>(`/public/batches/${id}`);
  const { data: programs } = useApi<{ id: string; image_url: string | null }[]>("/public/programs");
  const checkSession = maybeSignedIn();
  const { data: me, error: meError } = useApi(checkSession ? "/auth/me" : null, { shouldRetryOnError: false });
  // Wait for the session check so the Join link points to the right place on first paint.
  const meLoading = checkSession && me === undefined && !meError;
  if (error?.status === 404) return <NotFound />;
  if (!b || meLoading) {
    return <div className="container-page">{error ? <div className="py-14"><ErrorNote error={error} /></div> : <Loading />}</div>;
  }
  const signedIn = !!me;
  const full = b.display_status === "full";
  const closed = !["upcoming", "active", "full"].includes(b.display_status);
  const enrollHref = `/student/enroll/${b.id}`;
  const image = programs?.find((p) => p.id === b.program_id)?.image_url ?? null;
  return (
    <div>
      <Seo title={b.name} description={`${b.name} — ${titleCase(b.skill_level)} pickleball batch. ${b.seats_left} seats left.`} />
      <section className="container-page pt-4">
        <div className="relative isolate flex min-h-[22rem] flex-col justify-between overflow-hidden rounded-[2rem] bg-court-950 p-6 text-white sm:min-h-[26rem] sm:p-10">
          <Img src={image} alt="" level={b.skill_level} className="absolute inset-0 -z-10 h-full w-full" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-court-950/95 via-court-950/50 to-court-950/10" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link to="/batches" className="glass inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium hover:bg-white/25">
              <ArrowLeft size={15} /> All batches
            </Link>
            <div className="flex flex-wrap gap-1.5">
              {b.skill_level && <span className="rounded-full bg-ball px-2.5 py-1 text-xs font-semibold text-court-950">{titleCase(b.skill_level)}</span>}
              {b.period_label && <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink">{b.period_label}</span>}
              <SeatsBadge batch={b} />
            </div>
          </div>
          <div className="mt-16">
            {b.program_title && <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ball">{b.program_title}</p>}
            <h1 className="mega mt-2 max-w-[18ch] text-[clamp(2.6rem,6.4vw,5.6rem)]">{b.name}</h1>
          </div>
        </div>
      </section>

      <div className="container-page grid grid-cols-1 gap-10 py-14 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div>
          {b.description && <p className="max-w-2xl text-lg leading-relaxed text-ink/80">{b.description}</p>}

          <h2 className="mb-4 mt-10 font-display text-3xl uppercase first:mt-0">Weekly schedule</h2>
          <ul className="space-y-2">
            {b.schedules.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-3xl bg-white px-5 py-4 shadow-[var(--shadow-card)] sm:rounded-full sm:px-6">
                <span className="flex min-w-24 items-center gap-2 font-semibold">
                  <CalendarDays size={16} className="text-court-600" /> {WEEKDAYS[s.weekday]}
                </span>
                <span className="flex items-center gap-2 text-sm"><Clock size={16} className="text-court-600" /> {timeRange(s.start_time, s.end_time)}</span>
                <span className="flex items-center gap-2 text-sm text-muted sm:ml-auto"><MapPin size={16} className="text-court-600" /> {s.venue_name}</span>
              </li>
            ))}
          </ul>

          {b.coaches.length > 0 && (
            <>
              <h2 className="mb-4 mt-12 font-display text-3xl uppercase">Coaches</h2>
              <div className="flex flex-wrap gap-3">
                {b.coaches.map((c) => (
                  <div key={c.coach_id} className="flex items-center gap-3 rounded-full bg-white p-2 pr-6 shadow-[var(--shadow-card)]">
                    {c.photo_url ? (
                      <img src={c.photo_url} alt={c.name} className="h-12 w-12 rounded-full object-cover" />
                    ) : (
                      <span className="grid h-12 w-12 place-items-center rounded-full bg-court font-semibold text-ball">{c.name[0]}</span>
                    )}
                    <div>
                      <p className="font-semibold">{c.name}</p>
                      <p className="text-xs capitalize text-muted">{c.role} coach</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-3xl bg-white p-6 shadow-[var(--shadow-lift)] sm:p-7">
            {b.display_price !== null ? (
              <>
                <p className="num font-display text-6xl leading-none text-court-950">{inr(b.display_price)}</p>
                <p className="mt-2 text-sm text-muted">
                  {b.fee_plan ? `${b.fee_plan.name} · ${b.fee_plan.number_of_sessions} sessions` : "Batch fee"}
                </p>
              </>
            ) : (
              <p className="font-semibold">Contact us for pricing</p>
            )}
            <dl className="mt-6 divide-y divide-line rounded-2xl bg-paper px-4 text-sm">
              <div className="flex justify-between py-2.5"><dt className="text-muted">Starts</dt><dd className="font-medium">{fmtDate(b.start_date)}</dd></div>
              {b.end_date && <div className="flex justify-between py-2.5"><dt className="text-muted">Ends</dt><dd className="font-medium">{fmtDate(b.end_date)}</dd></div>}
              <div className="flex justify-between py-2.5"><dt className="text-muted">Batch size</dt><dd className="flex items-center gap-1 font-medium"><Users size={14} /> up to {b.max_players}</dd></div>
              <div className="flex justify-between py-2.5"><dt className="text-muted">Seats left</dt><dd className="font-semibold">{b.seats_left}</dd></div>
            </dl>
            <div className="mt-6">
              {closed ? (
                <p className="rounded-2xl bg-stone-100 p-3 text-sm">This batch is not taking enrollments.</p>
              ) : full ? (
                <>
                  <p className="mb-3 rounded-2xl bg-red-50 p-3 text-sm text-red-800">This batch is full. Check other batches or contact us.</p>
                  <LinkButton to="/batches" variant="secondary" className="w-full">Other batches</LinkButton>
                </>
              ) : (
                <LinkButton
                  to={signedIn ? enrollHref : `/register?next=${encodeURIComponent(enrollHref)}`}
                  variant="ball"
                  size="lg"
                  className="w-full"
                >
                  Join this batch <ArrowRight size={18} />
                </LinkButton>
              )}
              {!signedIn && !full && !closed && (
                <p className="mt-3 text-center text-sm text-muted">
                  Already have an account? <Link className="font-semibold text-court-700 underline" to={`/login?next=${encodeURIComponent(enrollHref)}`}>Sign in</Link>
                </p>
              )}
            </div>
            <p className="mt-5 text-xs text-muted">Pay by UPI after choosing the batch. Your seat is confirmed once the academy verifies payment.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
