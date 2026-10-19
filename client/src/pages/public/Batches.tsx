import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import { BatchCard, PageHero, type PublicBatch } from "@/components/public/cards";
import { Seo } from "@/components/seo";
import { EmptyState, ErrorNote, Loading, cx } from "@/components/ui";
import { useApi } from "@/lib/api";
import { titleCase } from "@/lib/format";

/** One labelled row of pill filters: a swipeable line on phones, wrapping from tablets up. */
function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={`Filter by ${label.toLowerCase()}`} className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-5">
      <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-muted">{label}</span>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
        {children}
      </div>
    </div>
  );
}

export default function BatchesPage() {
  const [params] = useSearchParams();
  const level = params.get("level") ?? undefined;
  const venue = params.get("venue") ?? undefined;
  const { data: all, error: batchesError } = useApi<PublicBatch[]>("/public/batches");
  const { data: venues, error: venuesError } = useApi<any[]>("/public/venues");
  // Programs only lend their photo to each batch tile; the list still renders if this request fails.
  const { data: programs, error: programsError } = useApi<{ id: string; image_url: string | null }[]>("/public/programs");
  const error = batchesError ?? venuesError;
  const seo = (
    <Seo title="Batches & schedule" description="Available pickleball batches with timings, venues, coaches and live seat availability." />
  );
  if (!all || !venues || (programs === undefined && !programsError)) {
    return (
      <div className="container-page">
        {seo}
        {error ? <div className="py-14"><ErrorNote error={error} /></div> : <Loading />}
      </div>
    );
  }
  const programImage = Object.fromEntries((programs ?? []).map((p) => [p.id, p.image_url]));
  const levels = [...new Set(all.map((b) => b.skill_level).filter(Boolean))] as string[];
  const venueName = venues.find((v) => String(v.id) === venue)?.name;
  const batches = all.filter(
    (b) => (!level || b.skill_level === level) && (!venueName || b.schedules.some((s) => s.venue_name === venueName)),
  );
  const chip = (active: boolean) =>
    cx(
      "inline-flex h-10 items-center rounded-full px-4 text-sm font-semibold transition-colors",
      active ? "bg-court text-white shadow-sm" : "bg-paper text-ink/80 hover:bg-court-50 hover:text-ink",
    );
  const link = (overrides: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ level, venue, ...overrides }).filter(([, v]) => v) as [string, string][]);
    return `/batches${p.size ? `?${p}` : ""}`;
  };
  return (
    <>
      {seo}
      <PageHero eyebrow="Batches & schedule" title="Find your batch" tone="hard">
        Seat availability updates in real time. Pending enrollments hold a seat while payment is verified.
      </PageHero>

      {/* Filters float over the bottom edge of the hero. */}
      <div className="container-page relative z-10 -mt-7 sm:-mt-10">
        <div className="mx-2 rounded-3xl bg-white p-4 shadow-[var(--shadow-lift)] sm:mx-6 sm:p-5 lg:mx-10">
          <div className="space-y-3.5">
            <FilterRow label="Level">
              <Link to={link({ level: undefined })} className={chip(!level)}>All levels</Link>
              {levels.map((l) => (
                <Link key={l} to={link({ level: l })} className={chip(level === l)}>{titleCase(l)}</Link>
              ))}
            </FilterRow>
            <div className="h-px bg-line" />
            <FilterRow label="Venue">
              <Link to={link({ venue: undefined })} className={chip(!venue)}>All venues</Link>
              {venues.map((v) => (
                <Link key={v.id} to={link({ venue: String(v.id) })} className={chip(venue === String(v.id))}>{v.name}</Link>
              ))}
            </FilterRow>
          </div>
        </div>
      </div>

      <section className="container-page pt-12 sm:pt-16">
        <div className="mb-8 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted" aria-live="polite">
          <span className="h-2 w-2 rounded-full bg-ball ring-4 ring-ball/25" />
          {batches.length} batch{batches.length === 1 ? "" : "es"}
          {level ? ` · ${titleCase(level)}` : ""}
          {venueName ? ` · ${venueName}` : ""}
          <span className="h-px flex-1 bg-line" />
        </div>
        {batches.length ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {batches.map((b) => (
              <BatchCard key={b.id} batch={b} image={b.program_id ? programImage[b.program_id] : null} />
            ))}
          </div>
        ) : (
          <EmptyState title="No batches match these filters." />
        )}
      </section>
    </>
  );
}
