import { ArrowLeft, ArrowRight, MapPin } from "lucide-react";
import { Link, useParams } from "react-router";

import { Img } from "@/components/public/cards";
import { Seo } from "@/components/seo";
import { ErrorNote, Loading, buttonClass } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import NotFound from "@/pages/public/NotFound";

export default function EventPage() {
  const { slug } = useParams();
  const { data: e, error } = useApi<any>(`/public/events/${slug}`);
  if (error?.status === 404) return <NotFound />;
  if (!e) {
    return <div className="container-page">{error ? <div className="py-14"><ErrorNote error={error} /></div> : <Loading />}</div>;
  }
  return (
    <article className="container-page max-w-5xl py-10">
      <Seo title={e.title} description={e.description?.slice(0, 160)} />
      <Link to="/events" className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-sm font-medium shadow-[var(--shadow-card)] hover:bg-ball-100">
        <ArrowLeft size={15} /> All events
      </Link>
      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.14em] text-court-600">{fmtDate(e.event_date)}{e.end_date ? ` – ${fmtDate(e.end_date)}` : ""}</p>
      <h1 className="mega mt-2 text-[clamp(2.6rem,6vw,5.2rem)] text-court-950">{e.title}</h1>
      {(e.location_text || e.venue) && (
        <p className="mt-4 flex items-center gap-2 text-lg text-muted"><MapPin size={18} className="shrink-0 text-court-600" />{e.location_text ?? `${e.venue.name}, ${e.venue.address}`}</p>
      )}
      {e.cover_image_url && <Img src={e.cover_image_url} alt={e.title} className="mt-10 aspect-[16/9] w-full rounded-[2rem]" />}
      <div className="mx-auto max-w-3xl">
        {e.description && <div className="prose-body mt-10 text-lg leading-relaxed text-ink/85">{String(e.description).split(/\n\n+/).map((t: string, i: number) => <p key={i}>{t}</p>)}</div>}
        {e.registration_url && <a href={e.registration_url} target="_blank" rel="noopener noreferrer" className={buttonClass("ball", "lg", "mt-10")}>Register <ArrowRight size={18} /></a>}
      </div>
    </article>
  );
}
