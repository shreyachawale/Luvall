import { Link } from "react-router";

import { Img, PageHero } from "@/components/public/cards";
import { Seo } from "@/components/seo";
import { EmptyState, ErrorNote, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";

export default function EventsPage() {
  const { data: events, error } = useApi<any[]>("/public/events");
  const seo = <Seo title="Events" description="Clinics, workshops and tournaments at LuvAll Sports." />;
  if (!events) {
    return (
      <div className="container-page">
        {seo}
        {error ? <div className="py-14"><ErrorNote error={error} /></div> : <Loading />}
      </div>
    );
  }
  return (
    <div>
      {seo}
      <PageHero eyebrow="Events" title="Clinics, socials & tournaments" tone="hard">
        Open days, coaching clinics and the academy&apos;s own tournaments. Everyone is welcome.
      </PageHero>
      <div className="container-page py-14">
        {events.length ? (
          <div className="space-y-4">
            {events.map((e) => {
              const d = new Date(`${e.event_date}T00:00:00`);
              return (
                <Link
                  key={e.id}
                  to={`/events/${e.slug}`}
                  className="group grid grid-cols-[5.5rem_minmax(0,1fr)] items-stretch overflow-hidden rounded-3xl bg-white shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-lift)] sm:grid-cols-[7rem_minmax(0,1fr)_14rem]"
                >
                  <div className="flex flex-col items-center justify-center bg-court-950 py-5 text-white">
                    <span className="font-display text-5xl leading-none text-ball">{d.getDate()}</span>
                    <span className="mt-1 text-xs font-semibold uppercase tracking-[0.14em]">{d.toLocaleString("en-IN", { month: "short" })}</span>
                  </div>
                  <div className="p-5 sm:p-6">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                      {fmtDate(e.event_date)}{e.end_date ? ` – ${fmtDate(e.end_date)}` : ""}
                    </p>
                    <h2 className="mt-1 font-display text-2xl uppercase leading-none group-hover:text-court-700 sm:text-3xl">{e.title}</h2>
                    {e.location_text && <p className="mt-2 text-sm text-muted">{e.location_text}</p>}
                  </div>
                  <Img src={e.cover_image_url} alt={e.title} className="hidden h-full w-full sm:block" />
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No upcoming events right now">
            Clinics and tournaments are announced here and on WhatsApp. Meanwhile, catch up on the{" "}
            <Link className="font-semibold text-court-700 underline underline-offset-4" to="/news">latest news</Link>.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
