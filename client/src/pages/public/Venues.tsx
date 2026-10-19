import { ArrowUpRight, MapPin } from "lucide-react";

import { Img, PageHero, SeeMore } from "@/components/public/cards";
import { Seo } from "@/components/seo";
import { ErrorNote, Loading, buttonClass } from "@/components/ui";
import { useApi } from "@/lib/api";

/** Amenities arrive as one comma-separated string; show each as a chip. */
function amenityList(value: unknown): string[] {
  if (!value) return [];
  const parts = Array.isArray(value) ? value.map(String) : String(value).split(",");
  return parts
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => a.charAt(0).toUpperCase() + a.slice(1));
}

export default function VenuesPage() {
  const { data: venues, error } = useApi<any[]>("/public/venues");
  const seo = <Seo title="Venues" description="Where our pickleball batches are held." />;
  if (!venues) {
    return (
      <div className="container-page">
        {seo}
        {error ? <div className="py-14"><ErrorNote error={error} /></div> : <Loading />}
      </div>
    );
  }
  const courts = venues.reduce((sum, v) => sum + (Number(v.courts_available) || 0), 0);
  const facts = [
    { value: String(venues.length), label: venues.length === 1 ? "Venue" : "Venues" },
    ...(courts > 0 ? [{ value: String(courts), label: courts === 1 ? "Court" : "Courts" }] : []),
  ];
  return (
    <>
      {seo}
      <PageHero
        eyebrow="Venues"
        title="Our courts"
        tone="hard"
        actions={
          venues.length > 0 && (
            <dl className="grid w-full grid-cols-2 gap-2.5 sm:flex sm:w-auto sm:flex-wrap">
              {facts.map((f) => (
                <div key={f.label} className="glass flex min-w-[8.5rem] flex-col-reverse rounded-2xl px-4 py-3">
                  <dt className="mt-1.5 text-xs font-medium text-white/80">{f.label}</dt>
                  <dd className="num font-display text-3xl leading-none text-ball">{f.value}</dd>
                </div>
              ))}
            </dl>
          )
        }
      >
        Where our pickleball batches are held.
      </PageHero>

      <section className="container-page pt-16 sm:pt-20">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {venues.map((v) => {
            const amenities = amenityList(v.amenities);
            return (
              <article
                key={v.id}
                className="group flex flex-col overflow-hidden rounded-3xl bg-white shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-lift)]"
              >
                <div className="relative aspect-[4/3] overflow-hidden">
                  <Img src={v.photo_url} alt={v.name} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.04]" />
                  <div className="scrim-bottom absolute inset-0" />
                  <span className="absolute left-4 top-4 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink">
                    {v.courts_available} court{Number(v.courts_available) === 1 ? "" : "s"}
                  </span>
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5 text-white">
                    <div className="min-w-0">
                      {v.city && <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ball">{v.city}</p>}
                      <h2 className="mt-1 font-display text-3xl uppercase leading-none">{v.name}</h2>
                    </div>
                    {v.map_url && (
                      <a href={v.map_url} target="_blank" rel="noopener noreferrer" className={buttonClass("light", "sm", "shrink-0")}>
                        Open in Maps <ArrowUpRight size={14} />
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <p className="flex gap-1.5 text-sm text-muted">
                    <MapPin size={16} className="mt-0.5 shrink-0 text-court-600" />
                    {v.address}
                    {v.city ? `, ${v.city}` : ""}
                  </p>
                  {v.description && <p className="mt-3 leading-relaxed text-ink/80">{v.description}</p>}
                  {amenities.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Amenities</p>
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {amenities.map((a) => (
                          <li key={a} className="rounded-full bg-court-50 px-3 py-1 text-xs font-semibold text-court-700">
                            {a}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-auto pt-5">
                    <div className="border-t border-line pt-4">
                      <SeeMore to={`/batches?venue=${v.id}`}>Batches here</SeeMore>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
