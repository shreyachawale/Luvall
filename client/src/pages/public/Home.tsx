import { ArrowRight, ArrowUpRight, Check, MapPin, Star } from "lucide-react";
import { Link } from "react-router";

import {
  BatchCard,
  CoachCard,
  Img,
  PlanCard,
  PostCard,
  Rail,
  SectionHeading,
  SeeMore,
  VideoEmbed,
  type PublicBatch,
  type PublicCoach,
  type PublicFeePlan,
  type PublicPost,
} from "@/components/public/cards";
import { Seo } from "@/components/seo";
import { ErrorNote, LinkButton, Loading, cx } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDay, scheduleSummary, titleCase } from "@/lib/format";

import type { Site } from "./PublicLayout";

type Home = Site & {
  programs: { id: string; title: string; slug: string; summary: string; image_url: string | null; skill_level: string; age_group: string }[];
  batches: PublicBatch[];
  coaches: PublicCoach[];
  venues: { id: string; name: string; address: string; city: string; photo_url: string | null; courts_available: number; map_url: string | null }[];
  posts: PublicPost[];
  albums: { id: string; title: string; slug: string; items?: { id: string; media_type: string; storage_url: string; thumbnail_url: string | null; caption: string | null }[] }[];
  videos: { id: string; storage_url: string; caption: string | null }[];
  testimonials: { id: string; author_name: string; author_title: string | null; quote: string; rating: number | null }[];
  faqs: { id: string; question: string; answer: string }[];
  events: { id: string; title: string; slug: string; event_date: string; location_text: string | null }[];
};

const STEPS = [
  { title: "Pick a batch", body: "Choose a level, venue and time that fits your week. Seats update live as players enroll." },
  { title: "Pay by UPI", body: "Pay with the academy UPI ID or QR code and enter the transaction reference (UTR)." },
  { title: "Get on court", body: "Your seat is confirmed once the payment is verified. Missed a session? Book a make-up in another batch." },
];

/** Column spans for the programs bento: two wide tiles, then the rest share the row. */
function programSpan(index: number, total: number) {
  if (index < 2 && total > 1) return "lg:col-span-3";
  const rest = total - 2;
  if (rest === 1 || total === 1) return "lg:col-span-6";
  if (rest === 2 || rest === 4) return "lg:col-span-3";
  return "lg:col-span-2";
}

export default function HomePage() {
  const { data: home, error } = useApi<Home>("/public/home");
  const { data: plans } = useApi<PublicFeePlan[]>("/public/fee-plans");
  if (!home) {
    return <div className="container-page">{error ? <div className="py-14"><ErrorNote error={error} /></div> : <Loading />}</div>;
  }
  const c = home.content;
  const nextOpen = home.batches.find((b) => b.seats_left > 0);
  const programImage = Object.fromEntries(home.programs.map((p) => [p.id, p.image_url]));
  const images = home.albums.flatMap((a) => (a.items ?? []).filter((i) => i.media_type === "image").map((i) => ({ ...i, album: a.slug })));
  const stats: { label: string; value: string }[] = c.stats ?? [];
  const shownPlans = (plans ?? []).slice(0, 3);
  const bestPlan = shownPlans.length > 1
    ? shownPlans.reduce((best, p) => (p.base_fee / p.number_of_sessions < best.base_fee / best.number_of_sessions ? p : best)).id
    : null;
  return (
    <>
      <Seo fullTitle={c.seo_title || undefined} description={c.seo_description} image={c.hero_image_url} />

      {/* Hero: the headline set huge over the court. */}
      <section className="container-page pt-4">
        <div className="relative isolate overflow-hidden rounded-[2rem] bg-court-950 text-white">
          <Img src={c.hero_image_url} alt="" className="absolute inset-0 -z-10 h-full w-full" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-court-950/95 via-court-950/45 to-court-950/10" />
          <div className="flex min-h-[min(48rem,92vh)] flex-col justify-between gap-10 p-5 sm:p-8 lg:p-10">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <p className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium">
                <span className="h-2 w-2 rounded-full bg-ball" /> {c.hero_eyebrow}
              </p>
              {nextOpen && (
                <Link
                  to={`/batches/${nextOpen.id}`}
                  className="group hidden w-72 rounded-3xl bg-white p-4 text-ink shadow-xl transition-transform hover:-translate-y-0.5 sm:block"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-court-600">Seats open</p>
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-ball text-court-950 transition-transform group-hover:rotate-45">
                      <ArrowUpRight size={16} />
                    </span>
                  </div>
                  <p className="mt-2 font-bold leading-snug">{nextOpen.name}</p>
                  <p className="text-sm text-muted">{scheduleSummary(nextOpen.schedules)}</p>
                  <p className="mt-2 text-xs font-semibold text-court-700">
                    {nextOpen.seats_left} seat{nextOpen.seats_left === 1 ? "" : "s"} left
                  </p>
                </Link>
              )}
            </div>
            <div>
              <h1 className="mega max-w-[13ch] text-white">{c.hero_title}</h1>
              <div className="mt-8 grid grid-cols-1 items-end gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
                <div className="glass rounded-3xl p-5">
                  <p className="text-base leading-relaxed text-white/90">{c.hero_subtitle}</p>
                  <div className="mt-5 flex flex-wrap gap-2.5">
                    <LinkButton to="/batches" variant="ball" size="lg">
                      Join a batch <ArrowRight size={18} />
                    </LinkButton>
                    <LinkButton to="/login" variant="glass" size="lg">
                      Sign in
                    </LinkButton>
                  </div>
                </div>
                {stats.length > 0 && (
                  <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:justify-self-end">
                    {stats.map((s) => (
                      <div key={s.label} className="glass-dark rounded-2xl px-4 py-3">
                        <dd className="font-display text-3xl leading-none text-ball">{s.value}</dd>
                        <dt className="mt-1.5 text-xs font-medium text-white/75">{s.label}</dt>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* About */}
      <section className="container-page py-24">
        <SectionHeading eyebrow="The academy" title={c.about_title} />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <Img src={c.about_image_url} alt={c.about_title} className="aspect-[16/10] w-full rounded-3xl" />
          <div className="flex flex-col gap-5">
            <div className="prose-body space-y-4 text-lg leading-relaxed text-ink/80">
              {String(c.about_body)
                .split(/\n\n+/)
                .map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
            </div>
            {stats[0] && (
              <div className="court-lines mt-auto rounded-3xl bg-court-950 p-6 text-white">
                <p className="font-display text-7xl leading-none text-ball sm:text-8xl">{stats[0].value}</p>
                <p className="mt-2 text-lg font-semibold">{stats[0].label}</p>
                {stats.length > 1 && (
                  <ul className="mt-4 space-y-1.5 text-sm text-white/75">
                    {stats.slice(1).map((s) => (
                      <li key={s.label} className="flex items-center gap-2">
                        <Check size={15} className="text-ball" /> {s.value} {s.label.toLowerCase()}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <SeeMore to="/about">More about the academy</SeeMore>
          </div>
        </div>
      </section>

      {/* Programs */}
      {home.programs.length > 0 && (
        <section className="container-page pb-24">
          <SectionHeading eyebrow="Programs" title="Coaching for every stage of your game" action={<SeeMore to="/programs">All programs</SeeMore>} />
          <Rail cols="lg:grid-cols-6" className="sm:gap-4">
            {home.programs.map((p, i) => (
              <Link
                key={p.id}
                to={`/programs/${p.slug}`}
                className={cx("group relative isolate flex h-80 flex-col justify-between overflow-hidden rounded-3xl p-5 text-white", programSpan(i, home.programs.length), i < 2 && "lg:h-96")}
              >
                <Img src={p.image_url} alt="" level={p.skill_level} className="absolute inset-0 -z-10 h-full w-full transition-transform duration-500 group-hover:scale-[1.04]" />
                <div className="scrim-bottom absolute inset-0 -z-10" />
                <div className="flex justify-between gap-2">
                  {p.age_group && <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink">{p.age_group}</span>}
                </div>
                <div className="flex items-end justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ball">{titleCase(p.skill_level)}</p>
                    <h3 className="mt-1 font-display text-3xl uppercase leading-none sm:text-4xl">{p.title}</h3>
                    <p className="mt-2 line-clamp-2 max-w-md text-sm text-white/80">{p.summary}</p>
                  </div>
                  <span className="hidden shrink-0 rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink shadow-sm transition-colors group-hover:bg-ball sm:inline-flex">
                    Explore
                  </span>
                </div>
              </Link>
            ))}
          </Rail>
        </section>
      )}

      {/* Batches */}
      <section className="container-page pb-24">
        <SectionHeading eyebrow="Batches" title="Pick a batch that fits your week" action={<SeeMore to="/batches">See all batches</SeeMore>}>
          Small groups of 4–6 players. Seats update live as players enroll.
        </SectionHeading>
        {home.batches.length ? (
          <Rail>
            {home.batches.slice(0, 6).map((b) => (
              <BatchCard key={b.id} batch={b} image={b.program_id ? programImage[b.program_id] : null} />
            ))}
          </Rail>
        ) : (
          <p className="text-muted">New batches are announced soon. Message us on WhatsApp to get notified.</p>
        )}
      </section>

      {/* How it works: a slanted hard-court band. */}
      <section className="slant-both court-diagonals relative bg-hard py-28 text-white sm:py-32">
        <div className="container-page">
          <SectionHeading eyebrow="How it works" title="On court in three steps" light action={<SeeMore to="/batches" light>Find your batch</SeeMore>} />
          <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="glass rounded-3xl p-6">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-ball font-display text-2xl text-court-950">{i + 1}</span>
                <h3 className="mt-6 font-display text-3xl uppercase leading-none">{s.title}</h3>
                <p className="mt-3 text-white/80">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Packages */}
      {shownPlans.length > 0 && (
        <section className="container-page py-24">
          <SectionHeading eyebrow="Packages" title="Pick the plan that fits your game">
            Every batch comes with a package of sessions. Pay once by UPI and follow the sessions left in your dashboard.
          </SectionHeading>
          <div className={cx("grid grid-cols-1 gap-5", shownPlans.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3")}>
            {shownPlans.map((p, i) => (
              <PlanCard key={p.id} plan={p} index={i} best={p.id === bestPlan} />
            ))}
          </div>
        </section>
      )}

      {/* Coaches */}
      {home.coaches.length > 0 && (
        <section className={cx("container-page pb-24", shownPlans.length === 0 && "pt-24")}>
          <SectionHeading eyebrow="Coaches" title="Learn from certified coaches" action={<SeeMore to="/coaches">Meet the team</SeeMore>} />
          <Rail>
            {home.coaches.slice(0, 3).map((coach) => (
              <CoachCard key={coach.id} coach={coach} />
            ))}
          </Rail>
        </section>
      )}

      {/* Achievements & news */}
      {home.posts.length > 0 && (
        <section className="container-page pb-24">
          <SectionHeading eyebrow="Achievements & updates" title="On and off the court" action={<SeeMore to="/news">All news</SeeMore>} />
          <Rail>
            {home.posts.slice(0, 3).map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </Rail>
        </section>
      )}

      {/* Gallery & videos */}
      {(images.length > 0 || home.videos.length > 0) && (
        <section className="container-page pb-24">
          <div className="rounded-[2rem] bg-court-950 px-5 py-14 sm:px-10">
            <SectionHeading eyebrow="Gallery" title="Moments from the courts" light action={<SeeMore to="/gallery" light>Open gallery</SeeMore>} />
            {images.length > 0 && (
              <div className="grid auto-rows-[9rem] grid-cols-2 gap-3 sm:auto-rows-[11rem] sm:grid-cols-4">
                {images.slice(0, 5).map((m, i) => (
                  <Link key={m.id} to={`/gallery/${m.album}`} className={cx("group overflow-hidden rounded-3xl", i === 0 && "col-span-2 row-span-2")}>
                    <Img
                      src={i === 0 ? m.storage_url : m.thumbnail_url ?? m.storage_url}
                      alt={m.caption ?? "Gallery photo"}
                      className="h-full w-full transition-transform duration-500 group-hover:scale-[1.05]"
                    />
                  </Link>
                ))}
              </div>
            )}
            {home.videos.length > 0 && (
              <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {home.videos.slice(0, 3).map((v) => (
                  <div key={v.id}>
                    <VideoEmbed url={v.storage_url} title={v.caption ?? "Academy video"} />
                    {v.caption && <p className="mt-2 text-sm text-white/70">{v.caption}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Testimonials */}
      {home.testimonials.length > 0 && (
        <section className="container-page pb-24">
          <SectionHeading eyebrow="Testimonials" title="What our players say" />
          <Rail cols="lg:grid-cols-3">
            {home.testimonials.slice(0, 6).map((t, i) => (
              <figure key={t.id} className={cx("flex flex-col rounded-3xl p-7", i % 3 === 0 ? "bg-mint" : "bg-white shadow-[var(--shadow-card)]")}>
                <span aria-hidden className="font-display text-7xl leading-[0.6] text-court-600">“</span>
                {t.rating ? (
                  <div className="mt-4 flex gap-0.5 text-court-700" aria-label={`${t.rating} out of 5`}>
                    {Array.from({ length: t.rating }).map((_, j) => (
                      <Star key={j} size={16} fill="currentColor" />
                    ))}
                  </div>
                ) : null}
                <blockquote className="mt-3 flex-1 text-lg leading-relaxed">{t.quote}</blockquote>
                <figcaption className="mt-6 flex items-center gap-3 text-sm">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-court text-sm font-semibold text-ball">
                    {t.author_name.slice(0, 1)}
                  </span>
                  <span>
                    <span className="block font-semibold">{t.author_name}</span>
                    {t.author_title && <span className="text-muted">{t.author_title}</span>}
                  </span>
                </figcaption>
              </figure>
            ))}
          </Rail>
        </section>
      )}

      {/* Venues + events */}
      {home.venues.length > 0 && (
        <section className="container-page pb-24">
          <SectionHeading eyebrow="Venues" title="Courts across the city" action={<SeeMore to="/venues">All venues</SeeMore>} />
          <Rail>
            {home.venues.map((v) => (
              <article key={v.id} className="group">
                <div className="relative aspect-[16/11] overflow-hidden rounded-3xl">
                  <Img src={v.photo_url} alt={v.name} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.04]" />
                  <span className="absolute left-4 top-4 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink">
                    {v.courts_available} courts
                  </span>
                </div>
                <h3 className="mt-4 font-display text-2xl uppercase leading-none">{v.name}</h3>
                <p className="mt-1.5 flex gap-1.5 text-sm text-muted">
                  <MapPin size={15} className="mt-0.5 shrink-0" />
                  {v.address}
                  {v.city ? `, ${v.city}` : ""}
                </p>
              </article>
            ))}
          </Rail>
          {home.events.length > 0 && (
            <div className="mt-14">
              <h3 className="mb-4 font-display text-3xl uppercase">Upcoming events</h3>
              <ul className="space-y-2">
                {home.events.map((e) => (
                  <li key={e.id}>
                    <Link to={`/events/${e.slug}`} className="group flex items-center justify-between gap-4 rounded-full bg-white px-6 py-4 shadow-[var(--shadow-card)] hover:bg-ball-100">
                      <span className="font-semibold">{e.title}</span>
                      <span className="flex items-center gap-3 text-sm text-muted">
                        {fmtDay(e.event_date)}
                        {e.location_text ? ` · ${e.location_text}` : ""}
                        <ArrowRight size={16} className="text-ink transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* FAQ */}
      {home.faqs.length > 0 && (
        <section className="container-page grid grid-cols-1 gap-10 pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="self-start lg:sticky lg:top-28">
            <SectionHeading eyebrow="FAQ" title="Questions, answered">
              Can&apos;t find what you&apos;re looking for?{" "}
              <Link to="/contact" className="font-semibold text-court-700 underline underline-offset-4">
                Get in touch
              </Link>
              .
            </SectionHeading>
          </div>
          <div className="space-y-3">
            {home.faqs.map((f) => (
              <details key={f.id} className="group rounded-3xl bg-white px-6 py-5 shadow-[var(--shadow-card)]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold">
                  {f.question}
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-paper text-xl text-court-700 transition-transform group-open:rotate-45 group-open:bg-ball">+</span>
                </summary>
                <p className="mt-3 text-muted">{f.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Closing call to action */}
      <section className="container-page">
        <div className="court-diagonals relative isolate overflow-hidden rounded-[2rem] bg-court px-6 py-14 text-white sm:px-12 sm:py-16">
          <span aria-hidden className="absolute -right-10 -top-24 -z-10 h-48 w-48 rounded-full bg-ball shadow-[24px_24px_60px_rgb(0_0_0/0.35)] sm:-right-12 sm:-top-28 sm:h-60 sm:w-60" />
          <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end">
            <h2 className="mega max-w-[11ch] text-[clamp(2.8rem,7vw,6rem)]">Ready for your first rally?</h2>
            <div className="flex flex-col gap-4">
              <p className="max-w-sm text-white/80">Choose a batch, pay by UPI and you&apos;re on court.</p>
              <div className="flex flex-wrap gap-2.5">
                <LinkButton to="/batches" variant="ball" size="lg">
                  Join a batch <ArrowRight size={18} />
                </LinkButton>
                <LinkButton to="/contact" variant="glass" size="lg">
                  Contact us
                </LinkButton>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
