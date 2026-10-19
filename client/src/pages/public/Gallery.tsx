import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

import { Img, PageHero } from "@/components/public/cards";
import { Seo } from "@/components/seo";
import { EmptyState, ErrorNote, Loading, cx } from "@/components/ui";
import { useApi } from "@/lib/api";

export default function GalleryPage() {
  const { data: albums, error } = useApi<any[]>("/public/gallery");
  const seo = <Seo title="Gallery" description="Photos and videos from LuvAll Sports batches and tournaments." />;
  if (!albums) {
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
      <PageHero eyebrow="Gallery" title="Photos & videos" image={albums[0]?.cover_url}>
        Match days, drills, clinics and podiums from across our batches.
      </PageHero>
      <div className="container-page py-14">
        {albums.length ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {albums.map((a, i) => (
              <Link
                key={a.id}
                to={`/gallery/${a.slug}`}
                className={cx(
                  "group relative isolate flex min-h-80 flex-col justify-end overflow-hidden rounded-3xl p-6 text-white",
                  albums.length === 1 && "sm:col-span-2 sm:min-h-[30rem] lg:col-span-3",
                  i === 0 && albums.length > 2 && "sm:col-span-2 lg:row-span-2 lg:min-h-[34rem]",
                )}
              >
                <Img src={a.cover_url} alt="" className="absolute inset-0 -z-10 h-full w-full transition-transform duration-500 group-hover:scale-[1.04]" />
                <div className="scrim-bottom absolute inset-0 -z-10" />
                <span className="absolute left-5 top-5 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink">{a.count} items</span>
                <span className="absolute bottom-6 right-6 grid h-10 w-10 place-items-center rounded-full bg-white text-ink shadow transition-transform group-hover:rotate-45">
                  <ArrowUpRight size={18} />
                </span>
                <h2 className="max-w-[80%] font-display text-3xl uppercase leading-none sm:text-4xl">{a.title}</h2>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState title="Albums are coming soon">Photos from batches and tournaments will appear here.</EmptyState>
        )}
      </div>
    </div>
  );
}
