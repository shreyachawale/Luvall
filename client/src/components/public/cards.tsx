import { ArrowRight, ArrowUpRight, CalendarDays, MapPin, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Badge, buttonClass, cx } from "@/components/ui";
import { embedUrl, fmtDate, inr, isVertical, scheduleSummary, titleCase } from "@/lib/format";

/** "See all" link with the ball-lime arrow disc. */
export function SeeMore({ to, children, light }: { to: string; children: ReactNode; light?: boolean }) {
  return (
    <Link
      to={to}
      className={cx(
        "group inline-flex shrink-0 items-center gap-2.5 text-sm font-semibold",
        light ? "text-white" : "text-ink",
      )}
    >
      <span className="underline-offset-4 group-hover:underline">{children}</span>
      <span className="grid h-8 w-8 place-items-center rounded-full bg-ball text-court-950 transition-transform group-hover:translate-x-0.5">
        <ArrowRight size={16} />
      </span>
    </Link>
  );
}

/** Section label on a hairline rule, a condensed uppercase title, optional intro and action. */
export function SectionHeading({
  eyebrow,
  title,
  children,
  action,
  light,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  light?: boolean;
}) {
  return (
    <div className="mb-10">
      {eyebrow && (
        <div className={cx("mb-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em]", light ? "text-white/70" : "text-muted")}>
          <span className="h-2 w-2 rounded-full bg-ball ring-4 ring-ball/25" />
          {eyebrow}
          <span className={cx("h-px flex-1", light ? "bg-white/15" : "bg-line")} />
        </div>
      )}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <h2 className={cx("display-title", light ? "text-white" : "text-court-950")}>{title}</h2>
          {children && <p className={cx("mt-4 max-w-2xl text-base sm:text-lg", light ? "text-white/75" : "text-muted")}>{children}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}

const FALLBACK_SURFACE: Record<string, string> = {
  beginner: "bg-court-600",
  intermediate: "bg-hard",
  advanced: "bg-court-900",
  kids: "bg-clay",
};

/** Image, or a painted-court placeholder in the level's colour when there is none. */
export function Img({ src, alt, className, level }: { src?: string | null; alt: string; className?: string; level?: string | null }) {
  if (!src) {
    return (
      <div className={cx("court-surface relative", level ? FALLBACK_SURFACE[level] : null, className)} aria-hidden>
        <span className="absolute bottom-[18%] right-[22%] h-7 w-7 rounded-full bg-ball shadow-[6px_6px_12px_rgb(0_0_0/0.3)]" />
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" className={cx("object-cover", className)} />;
}

export type PublicBatch = {
  id: string;
  name: string;
  code: string;
  program_id?: string | null;
  skill_level: string | null;
  period_label: string;
  start_date: string | null;
  end_date: string | null;
  max_players: number;
  seats_left: number;
  display_status: string;
  display_price: number | null;
  fee_plan: { name: string; number_of_sessions: number; plan_type: string } | null;
  program_title: string | null;
  description: string | null;
  schedules: { weekday: number; start_time: string; end_time: string; venue_name: string; venue_city?: string }[];
  coaches: { coach_id: string; name: string; role: string; photo_url: string | null }[];
};

export function SeatsBadge({ batch }: { batch: PublicBatch }) {
  if (batch.display_status === "full") return <Badge tone="red">Full</Badge>;
  if (batch.seats_left <= 2) return <Badge tone="amber">{batch.seats_left} seat{batch.seats_left === 1 ? "" : "s"} left</Badge>;
  return <Badge tone="green">{batch.seats_left} seats left</Badge>;
}

/** Overlay chip on photos. */
function PhotoChip({ children, tone = "light" }: { children: ReactNode; tone?: "light" | "ball" | "dark" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        tone === "ball" && "bg-ball text-court-950",
        tone === "light" && "bg-white/90 text-ink",
        tone === "dark" && "bg-court-950/70 text-white backdrop-blur",
      )}
    >
      {children}
    </span>
  );
}

function seatsText(batch: PublicBatch) {
  if (batch.display_status === "full") return "Full";
  return `${batch.seats_left} seat${batch.seats_left === 1 ? "" : "s"} left`;
}

/** Batch as a photo tile: level and seats over the image, schedule below, price with a pill action. */
export function BatchCard({ batch, image }: { batch: PublicBatch; image?: string | null }) {
  const venues = [...new Set(batch.schedules.map((s) => s.venue_name))].join(", ");
  const full = batch.display_status === "full";
  return (
    <article className="group flex flex-col overflow-hidden rounded-3xl bg-white shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-lift)]">
      <Link to={`/batches/${batch.id}`} className="relative block aspect-[16/10] overflow-hidden" tabIndex={-1} aria-hidden>
        <Img src={image} alt="" level={batch.skill_level} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.04]" />
        <div className="scrim-bottom absolute inset-0" />
        <div className="absolute left-4 top-4 flex flex-wrap gap-1.5">
          {batch.skill_level && <PhotoChip tone="ball">{titleCase(batch.skill_level)}</PhotoChip>}
          {batch.display_status === "upcoming" && <PhotoChip>Starts {fmtDate(batch.start_date, { year: undefined })}</PhotoChip>}
        </div>
        <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3 text-white">
          <p className="text-sm text-white/80">{batch.program_title ?? batch.period_label}</p>
          <PhotoChip tone={full ? "light" : batch.seats_left <= 2 ? "light" : "dark"}>
            <span className={cx("mr-1.5 h-1.5 w-1.5 rounded-full", full ? "bg-red-500" : batch.seats_left <= 2 ? "bg-amber-500" : "bg-ball")} />
            {seatsText(batch)}
          </PhotoChip>
        </div>
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-lg font-bold leading-snug">
          <Link to={`/batches/${batch.id}`} className="hover:text-court-700">
            {batch.name}
          </Link>
        </h3>
        <dl className="mt-3 space-y-1.5 text-sm text-ink/80">
          <div className="flex gap-2">
            <CalendarDays size={16} className="mt-0.5 shrink-0 text-court-600" />
            <dd>{scheduleSummary(batch.schedules)}</dd>
          </div>
          <div className="flex gap-2">
            <MapPin size={16} className="mt-0.5 shrink-0 text-court-600" />
            <dd>{venues || "Venue to be announced"}</dd>
          </div>
          <div className="flex gap-2">
            <Users size={16} className="mt-0.5 shrink-0 text-court-600" />
            <dd>
              {batch.coaches.map((c) => c.name).join(" & ") || "Coach to be announced"} · max {batch.max_players} players
            </dd>
          </div>
        </dl>
        <div className="mt-auto pt-5">
        <div className="flex items-end justify-between gap-3 border-t border-line pt-4">
          <div>
            {batch.display_price !== null ? (
              <>
                <div className="num font-display text-3xl leading-none text-court-950">{inr(batch.display_price)}</div>
                <div className="mt-1 text-xs text-muted">
                  {batch.fee_plan ? `${batch.fee_plan.number_of_sessions} sessions` : batch.period_label || "per batch"}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted">Contact for pricing</div>
            )}
          </div>
          <Link
            to={`/batches/${batch.id}`}
            className={buttonClass(full ? "secondary" : "primary", "md")}
            aria-label={`${full ? "View" : "Join"} ${batch.name}`}
          >
            {full ? "View" : "Join"}
            {!full && <ArrowRight size={16} />}
          </Link>
        </div>
        </div>
      </div>
    </article>
  );
}

export type PublicCoach = {
  id: string;
  name: string;
  photo_url: string | null;
  title: string | null;
  certifications: string | null;
  bio: string | null;
  specialties: string | null;
  experience_years: number | null;
};

/** Portrait tile with the name over the photo. */
export function CoachCard({ coach, full }: { coach: PublicCoach; full?: boolean }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-3xl bg-white shadow-[var(--shadow-card)]">
      <div className="relative aspect-[4/5] overflow-hidden">
        <Img src={coach.photo_url} alt={coach.name} className="h-full w-full" />
        <div className="scrim-bottom absolute inset-0" />
        {coach.experience_years ? (
          <span className="absolute right-4 top-4 rounded-full bg-ball px-2.5 py-1 text-xs font-semibold text-court-950">
            {coach.experience_years}+ yrs
          </span>
        ) : null}
        <div className="absolute bottom-0 left-0 right-0 p-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ball">{coach.title}</p>
          <h3 className="mt-1 font-display text-3xl uppercase leading-none">{coach.name}</h3>
        </div>
      </div>
      {(coach.certifications || (full && (coach.bio || coach.specialties))) && (
        <div className="flex-1 p-5">
          {coach.certifications && <p className="text-sm font-medium text-court-700">{coach.certifications}</p>}
          {full && coach.bio && <p className="mt-3 text-sm leading-relaxed text-ink/80">{coach.bio}</p>}
          {full && coach.specialties && (
            <p className="mt-3 text-sm">
              <span className="font-semibold">Specialties:</span> {coach.specialties}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

export type PublicPost = {
  id: string;
  title: string;
  slug: string;
  category: string;
  summary: string | null;
  cover_image_url: string | null;
  video_url: string | null;
  publish_from: string | null;
};

export const CATEGORY_LABEL: Record<string, string> = {
  achievement: "Achievement",
  tournament: "Tournament",
  event: "Event",
  academy_update: "Academy update",
};

export function PostCard({ post }: { post: PublicPost }) {
  return (
    <Link to={`/news/${post.slug}`} className="group flex flex-col">
      <div className="relative aspect-[16/11] overflow-hidden rounded-3xl">
        <Img src={post.cover_image_url} alt={post.title} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.04]" />
        <div className="absolute left-4 top-4 flex gap-1.5">
          <PhotoChip tone={post.category === "achievement" ? "ball" : "light"}>{CATEGORY_LABEL[post.category] ?? post.category}</PhotoChip>
          {post.video_url && <PhotoChip tone="dark">Video</PhotoChip>}
        </div>
        <span className="absolute bottom-4 right-4 grid h-10 w-10 place-items-center rounded-full bg-white text-ink shadow transition-transform group-hover:rotate-45">
          <ArrowUpRight size={18} />
        </span>
      </div>
      <div className="px-1 pt-4">
        {post.publish_from && <p className="text-xs font-medium uppercase tracking-wider text-muted">{fmtDate(post.publish_from)}</p>}
        <h3 className="mt-1 text-lg font-bold leading-snug group-hover:text-court-700">{post.title}</h3>
        {post.summary && <p className="mt-1.5 line-clamp-2 text-sm text-muted">{post.summary}</p>}
      </div>
    </Link>
  );
}

export type PublicFeePlan = {
  id: string;
  name: string;
  description: string | null;
  plan_type: string;
  number_of_sessions: number;
  base_fee: number;
  validity_days: number | null;
};

const PLAN_STYLES = [
  { card: "bg-mint text-court-950", chip: "bg-court-950 text-white", outline: "border-court-950/30", price: "bg-court text-white", rule: "bg-court-950/15", arrow: "bg-white text-ink", muted: "text-court-950/70" },
  { card: "court-diagonals bg-court-900 text-white", chip: "bg-white/15 text-white", outline: "border-white/30", price: "bg-white text-ink", rule: "bg-white/20", arrow: "bg-ball text-court-950", muted: "text-white/70" },
  { card: "court-diagonals bg-hard-700 text-white", chip: "bg-white/15 text-white", outline: "border-white/30", price: "bg-ball text-court-950", rule: "bg-white/20", arrow: "bg-white text-ink", muted: "text-white/70" },
];

/** A fee plan as a package card: sessions, price per session, total. */
export function PlanCard({ plan, index, best }: { plan: PublicFeePlan; index: number; best?: boolean }) {
  const st = PLAN_STYLES[index % PLAN_STYLES.length];
  const perSession = plan.number_of_sessions ? plan.base_fee / plan.number_of_sessions : plan.base_fee;
  return (
    <article className={cx("relative flex min-h-[23rem] flex-col overflow-hidden rounded-3xl p-6", st.card)}>
      <div className="flex flex-wrap items-center gap-2">
        {best && <span className={cx("rounded-full px-3 py-1 text-xs font-semibold", st.chip)}>Best value</span>}
        {plan.validity_days && (
          <span className={cx("rounded-full border px-3 py-1 text-xs font-medium", st.outline)}>{plan.validity_days} days</span>
        )}
      </div>
      <div className="my-auto py-8 text-center">
        <p className="font-display text-5xl uppercase leading-none sm:text-6xl">{plan.number_of_sessions} sessions</p>
        <p className={cx("mx-auto mt-3 max-w-[16rem] text-sm", st.muted)}>{plan.description || plan.name}</p>
        <span className={cx("mt-6 inline-flex rounded-full px-5 py-2.5 text-sm font-semibold", st.price)}>
          {inr(Math.round(perSession))} / session
        </span>
      </div>
      <div className={cx("h-px w-full", st.rule)} />
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-sm">
          <span className="font-semibold">{inr(plan.base_fee)}</span> <span className={st.muted}>total{plan.description ? ` · ${plan.name}` : ""}</span>
        </p>
        <Link to="/batches" aria-label={`Find a batch for ${plan.name}`} className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-full", st.arrow)}>
          <ArrowRight size={18} />
        </Link>
      </div>
    </article>
  );
}

export function VideoEmbed({ url, title }: { url: string; title: string }) {
  const src = embedUrl(url);
  if (!src) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary")}>
        Watch video
      </a>
    );
  }
  const vertical = isVertical(url);
  return (
    <div className={cx("overflow-hidden rounded-3xl bg-court-950", vertical ? "mx-auto aspect-[9/16] max-w-sm" : "aspect-video")}>
      <iframe
        src={src}
        title={title}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        className="h-full w-full border-0"
      />
    </div>
  );
}

/**
 * Top band of an inner public page: a rounded court panel with the condensed headline, an intro and
 * optional actions. `image` lays a photo under it; `tone` picks court green or hard-court blue.
 */
export function PageHero({
  eyebrow,
  title,
  children,
  actions,
  image,
  tone = "court",
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  image?: string | null;
  tone?: "court" | "hard";
}) {
  return (
    <section className="container-page pt-4">
      <div
        className={cx(
          "relative isolate overflow-hidden rounded-[2rem] px-6 py-14 text-white sm:px-10 sm:py-20",
          tone === "hard" ? "bg-hard-700" : "bg-court-950",
          !image && "court-diagonals",
        )}
      >
        {image && (
          <>
            <Img src={image} alt="" className="absolute inset-0 -z-10 h-full w-full" />
            <div className="absolute inset-0 -z-10 bg-gradient-to-r from-court-950/90 via-court-950/60 to-court-950/20" />
          </>
        )}
        {eyebrow && (
          <p className="glass mb-6 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium">
            <span className="h-2 w-2 rounded-full bg-ball" /> {eyebrow}
          </p>
        )}
        <h1 className="mega max-w-[16ch] text-[clamp(2.9rem,7.4vw,6.4rem)]">{title}</h1>
        {children && <div className="mt-5 max-w-2xl text-base text-white/80 sm:text-lg">{children}</div>}
        {actions && <div className="mt-7 flex flex-wrap gap-2.5">{actions}</div>}
      </div>
    </section>
  );
}

/**
 * A grid on tablets and up, a swipeable row on phones (cards snap, the row bleeds to the screen edges).
 * `cols` is the desktop grid class, e.g. "lg:grid-cols-3".
 */
export function Rail({ children, cols = "lg:grid-cols-3", className }: { children: ReactNode; cols?: string; className?: string }) {
  return (
    <div
      className={cx(
        "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-3 [scrollbar-width:none] sm:mx-0 sm:grid sm:snap-none sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden",
        cols,
        "[&>*]:w-[84%] [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}
