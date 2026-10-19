import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

import { Img, PageHero } from "@/components/public/cards";
import { Seo } from "@/components/seo";
import { ErrorNote, Loading, cx } from "@/components/ui";
import { useApi } from "@/lib/api";
import { titleCase } from "@/lib/format";

/**
 * Editorial bento on a 12-column grid: rows alternate wide / narrow (7 + 5, then 5 + 7) so the photos never
 * line up like a spreadsheet. An odd last tile takes the whole row.
 */
function tileSpan(index: number, total: number) {
  if (total === 1 || (total % 2 === 1 && index === total - 1)) return "sm:col-span-2 lg:col-span-12";
  const wideFirst = Math.floor(index / 2) % 2 === 0;
  const isFirst = index % 2 === 0;
  return wideFirst === isFirst ? "lg:col-span-7" : "lg:col-span-5";
}

export default function ProgramsPage() {
  const { data: programs, error } = useApi<any[]>("/public/programs");
  const seo = <Seo title="Programs" description="Pickleball coaching programs from beginner to competitive." />;
  if (!programs) {
    return (
      <div className="container-page">
        {seo}
        {error ? <div className="py-14"><ErrorNote error={error} /></div> : <Loading />}
      </div>
    );
  }
  return (
    <>
      {seo}
      <PageHero eyebrow="Programs" title="Coaching programs">
        Every program runs in small batches with a clear progression path.
      </PageHero>

      <section className="container-page pt-16 sm:pt-20">
        <div className="mb-8 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          <span className="h-2 w-2 rounded-full bg-ball ring-4 ring-ball/25" />
          {programs.length} program{programs.length === 1 ? "" : "s"}
          <span className="h-px flex-1 bg-line" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-12">
          {programs.map((p, i) => (
            <Link
              key={p.id}
              to={`/programs/${p.slug}`}
              className={cx(
                "group relative isolate flex min-h-[24rem] flex-col justify-between overflow-hidden rounded-3xl bg-court-950 p-5 text-white sm:min-h-[28rem] sm:p-7",
                tileSpan(i, programs.length),
              )}
            >
              <Img
                src={p.image_url}
                alt={p.title}
                level={p.skill_level}
                className="absolute inset-0 -z-10 h-full w-full transition-transform duration-500 group-hover:scale-[1.04]"
              />
              <div className="scrim-bottom absolute inset-0 -z-10" />
              <div className="flex items-start justify-between gap-3">
                {p.age_group ? (
                  <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink">{p.age_group}</span>
                ) : (
                  <span />
                )}
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-ink shadow-sm transition group-hover:rotate-45 group-hover:bg-ball sm:hidden">
                  <ArrowUpRight size={18} />
                </span>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ball">{titleCase(p.skill_level)}</p>
                <h2 className="mt-2 max-w-[14ch] font-display text-4xl uppercase leading-[0.92] sm:text-5xl lg:text-[3.4rem]">{p.title}</h2>
                <div className="mt-4 flex items-end justify-between gap-5">
                  <p className="max-w-md text-sm leading-relaxed text-white/85 sm:text-base">{p.summary}</p>
                  <span className="hidden shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition-colors group-hover:bg-ball sm:inline-flex">
                    View batches <ArrowUpRight size={16} className="transition-transform group-hover:rotate-45" />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
