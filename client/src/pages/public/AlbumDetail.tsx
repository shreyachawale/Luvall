import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router";

import { VideoEmbed } from "@/components/public/cards";
import { Lightbox } from "@/components/public/lightbox";
import { Seo } from "@/components/seo";
import { ErrorNote, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import NotFound from "@/pages/public/NotFound";

export default function AlbumPage() {
  const { slug } = useParams();
  const { data: a, error } = useApi<any>(`/public/gallery/${slug}`);
  if (error?.status === 404) return <NotFound />;
  if (!a) {
    return <div className="container-page">{error ? <div className="py-14"><ErrorNote error={error} /></div> : <Loading />}</div>;
  }
  const images = a.items.filter((i: any) => i.media_type === "image");
  const videos = a.items.filter((i: any) => i.media_type === "video");
  return (
    <div className="container-page py-10">
      <Seo title={a.title} description={a.description ?? undefined} />
      <Link to="/gallery" className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-sm font-medium shadow-[var(--shadow-card)] hover:bg-ball-100">
        <ArrowLeft size={15} /> All albums
      </Link>
      <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="mega max-w-[16ch] text-[clamp(2.6rem,6vw,5.2rem)] text-court-950">{a.title}</h1>
        <p className="shrink-0 text-sm font-semibold uppercase tracking-[0.14em] text-muted">
          {images.length} photo{images.length === 1 ? "" : "s"}{videos.length ? ` · ${videos.length} video${videos.length === 1 ? "" : "s"}` : ""}
        </p>
      </div>
      {a.description && <p className="mt-4 max-w-2xl text-lg text-muted">{a.description}</p>}
      {videos.length > 0 && (
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v: any) => (
            <div key={v.id}>
              <VideoEmbed url={v.storage_url} title={v.caption ?? a.title} />
              {v.caption && <p className="mt-2 text-sm text-muted">{v.caption}</p>}
            </div>
          ))}
        </div>
      )}
      <Lightbox images={images} />
    </div>
  );
}
