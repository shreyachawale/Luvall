import { Check } from "lucide-react";
import { useParams } from "react-router";

import { BatchCard, Img, SectionHeading, type PublicBatch } from "@/components/public/cards";
import { Seo } from "@/components/seo";
import { EmptyState, ErrorNote, LinkButton, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { titleCase } from "@/lib/format";
import NotFound from "@/pages/public/NotFound";

export default function ProgramPage() {
  const { slug } = useParams();
  const { data: p, error } = useApi<any>(`/public/programs/${slug}`);
  if (error?.status === 404) return <NotFound />;
  if (!p) {
    return <div className="container-page">{error ? <div className="py-14"><ErrorNote error={error} /></div> : <Loading />}</div>;
  }
  const batches: PublicBatch[] = p.batches;
  const openSeats = batches.filter((b) => b.display_status !== "full").reduce((sum, b) => sum + Math.max(0, b.seats_left), 0);
  return (
    <>
      <Seo title={p.title} description={p.summary} />

      {/* Photo panel with the program name set huge. */}
      <section className="container-page pt-4">
        <div className="relative isolate overflow-hidden rounded-[2rem] bg-court-950 text-white">
          <Img src={p.image_url} alt={p.title} level={p.skill_level} className="absolute inset-0 -z-10 h-full w-full" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-court-950/95 via-court-950/45 to-court-950/5" />
          <div className="flex min-h-[34rem] flex-col justify-between gap-10 p-5 sm:min-h-[38rem] sm:p-8 lg:min-h-[42rem] lg:p-10">
            <div className="flex flex-wrap items-center gap-2">
              <p className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium">
                <span className="h-2 w-2 rounded-full bg-ball" /> {titleCase(p.skill_level)}
              </p>
              {p.age_group && <span className="glass rounded-full px-3.5 py-1.5 text-sm font-medium">{p.age_group}</span>}
            </div>
            <div className="grid grid-cols-1 items-end gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
              <h1 className="mega max-w-[12ch]">{p.title}</h1>
              <p className="glass rounded-3xl p-5 text-base leading-relaxed text-white/90 sm:text-lg">{p.summary}</p>
            </div>
          </div>
        </div>
      </section>

      {/* About the program, with the batch count as a scoreboard stat. */}
      {p.description && (
        <section className="container-page pt-16 sm:pt-24">
          <div className="mb-8 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            <span className="h-2 w-2 rounded-full bg-ball ring-4 ring-ball/25" />
            About the program
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-12">
            <div className="prose-body space-y-4 text-xl leading-relaxed text-ink/80 sm:text-2xl sm:leading-relaxed">
              {String(p.description).split(/\n\n+/).map((t: string, i: number) => <p key={i}>{t}</p>)}
            </div>
            <div className="court-lines self-start rounded-3xl bg-court-950 p-6 text-white sm:p-7">
              <p className="num font-display text-7xl leading-none text-ball sm:text-8xl">{batches.length}</p>
              <p className="mt-2 text-lg font-semibold">Batch{batches.length === 1 ? "" : "es"} in this program</p>
              <ul className="mt-4 space-y-1.5 text-sm text-white/75">
                <li className="flex items-center gap-2"><Check size={15} className="text-ball" /> {titleCase(p.skill_level)} level</li>
                {p.age_group && <li className="flex items-center gap-2"><Check size={15} className="text-ball" /> {p.age_group}</li>}
                {batches.length > 0 && (
                  <li className="flex items-center gap-2"><Check size={15} className="text-ball" /> {openSeats} seat{openSeats === 1 ? "" : "s"} open now</li>
                )}
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* Batches */}
      <section className="container-page pt-16 sm:pt-24">
        <SectionHeading eyebrow="Batches" title="Batches in this program" />
        {batches.length ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {batches.map((b) => <BatchCard key={b.id} batch={b} image={p.image_url} />)}
          </div>
        ) : (
          <EmptyState
            title="No open batches right now"
            action={<LinkButton to="/contact" variant="secondary">Contact us</LinkButton>}
          >
            Message us and we&apos;ll let you know when the next one opens.
          </EmptyState>
        )}
      </section>
    </>
  );
}
