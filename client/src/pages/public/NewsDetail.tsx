import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router";

import { Img, SeeMore, VideoEmbed } from "@/components/public/cards";
import { Seo } from "@/components/seo";
import { ErrorNote, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate, titleCase } from "@/lib/format";
import NotFound from "@/pages/public/NotFound";

export default function PostPage() {
  const { slug } = useParams();
  const { data: p, error } = useApi<any>(`/public/posts/${slug}`);
  if (error?.status === 404) return <NotFound />;
  if (!p) {
    return <div className="container-page">{error ? <div className="py-14"><ErrorNote error={error} /></div> : <Loading />}</div>;
  }
  return (
    <article>
      <Seo title={p.title} description={p.summary} image={p.cover_image_url} />
      <header className="container-page max-w-5xl pt-10">
        <Link to="/news" className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-sm font-medium shadow-[var(--shadow-card)] hover:bg-ball-100">
          <ArrowLeft size={15} /> All news
        </Link>
        <div className="mt-8 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-ball px-2.5 py-1 text-xs font-semibold text-court-950">{titleCase(p.category)}</span>
          {p.publish_from && <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{fmtDate(p.publish_from)}</span>}
        </div>
        <h1 className="mega mt-4 text-[clamp(2.6rem,6vw,5.2rem)] text-court-950">{p.title}</h1>
        {p.summary && <p className="mt-5 max-w-3xl text-xl leading-relaxed text-muted">{p.summary}</p>}
      </header>
      {p.cover_image_url && (
        <div className="container-page mt-10">
          <Img src={p.cover_image_url} alt={p.title} className="aspect-[16/9] w-full rounded-[2rem] lg:aspect-[21/9]" />
        </div>
      )}
      <div className="container-page max-w-3xl pb-6 pt-10">
        {p.body && (
          <div className="prose-body text-lg leading-relaxed text-ink/85">
            {String(p.body).split(/\n\n+/).map((t: string, i: number) => <p key={i}>{t}</p>)}
          </div>
        )}
        {p.video_url && <div className="mt-10"><VideoEmbed url={p.video_url} title={p.title} /></div>}
      </div>
      {p.images?.length > 0 && (
        <div className="container-page max-w-5xl pb-10 pt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {p.images.map((m: any, i: number) =>
              m.media_type === "video" ? (
                <div key={i} className="col-span-full"><VideoEmbed url={m.url} title={m.caption ?? p.title} /></div>
              ) : (
                <a key={i} href={m.url} target="_blank" rel="noopener noreferrer" className="group overflow-hidden rounded-3xl">
                  <Img src={m.thumbnail_url ?? m.url} alt={m.alt_text ?? m.caption ?? p.title} className="aspect-square w-full transition-transform duration-500 group-hover:scale-[1.04]" />
                </a>
              ),
            )}
          </div>
        </div>
      )}
      <div className="container-page max-w-3xl pt-6">
        <SeeMore to="/news">More news</SeeMore>
      </div>
    </article>
  );
}
