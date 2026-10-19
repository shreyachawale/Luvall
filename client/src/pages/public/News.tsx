import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { CATEGORY_LABEL, Img, PageHero, PostCard, type PublicPost } from "@/components/public/cards";
import { Seo } from "@/components/seo";
import { EmptyState, ErrorNote, LinkButton, Loading, cx } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";

const CATS = [
  { value: "", label: "All" },
  { value: "achievement", label: "Achievements" },
  { value: "tournament", label: "Tournaments" },
  { value: "event", label: "Events" },
  { value: "academy_update", label: "Academy updates" },
];

export default function NewsPage() {
  const [params] = useSearchParams();
  const category = params.get("category") ?? "";
  const page = params.get("page") ?? "1";
  const { data, error } = useApi<{ items: PublicPost[]; has_more: boolean }>(
    `/public/posts?page=${Number(page) || 1}${category ? `&category=${category}` : ""}`,
  );
  const seo = <Seo title="News & achievements" description="Player achievements, tournaments, events and academy updates." />;
  if (!data) {
    return (
      <div className="container-page">
        {seo}
        {error ? <div className="py-14"><ErrorNote error={error} /></div> : <Loading />}
      </div>
    );
  }
  const qs = (n: number) => `/news?page=${n}${category ? `&category=${category}` : ""}`;
  const [featured, ...rest] = data.items;
  const showFeatured = Number(page) === 1 && !!featured;
  return (
    <div>
      {seo}
      <PageHero eyebrow="News" title="Achievements & updates">
        Podiums, tournaments, new batches and everything else happening at the academy.
      </PageHero>
      <div className="container-page py-12">
        <div className="mb-10 flex flex-wrap gap-2">
          {CATS.map((c) => (
            <Link
              key={c.value}
              to={c.value ? `/news?category=${c.value}` : "/news"}
              className={cx(
                "rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                category === c.value ? "bg-court text-white" : "bg-white text-ink/80 shadow-[var(--shadow-card)] hover:bg-ball-100",
              )}
            >
              {c.label}
            </Link>
          ))}
        </div>
        {data.items.length ? (
          <>
            {showFeatured && (
              <Link to={`/news/${featured.slug}`} className="group mb-12 grid grid-cols-1 items-center gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-10">
                <div className="relative aspect-[16/10] overflow-hidden rounded-3xl">
                  <Img src={featured.cover_image_url} alt={featured.title} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]" />
                  <span className="absolute left-4 top-4 rounded-full bg-ball px-2.5 py-1 text-xs font-semibold text-court-950">
                    {CATEGORY_LABEL[featured.category] ?? featured.category}
                  </span>
                </div>
                <div>
                  {featured.publish_from && <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{fmtDate(featured.publish_from)}</p>}
                  <h2 className="mt-2 font-display text-4xl uppercase leading-[0.95] group-hover:text-court-700 sm:text-5xl">{featured.title}</h2>
                  {featured.summary && <p className="mt-4 text-lg text-muted">{featured.summary}</p>}
                  <span className="mt-6 inline-flex items-center gap-2.5 text-sm font-semibold">
                    Read the story
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-ball text-court-950 transition-transform group-hover:translate-x-0.5"><ArrowRight size={16} /></span>
                  </span>
                </div>
              </Link>
            )}
            {(showFeatured ? rest : data.items).length > 0 && (
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
                {(showFeatured ? rest : data.items).map((p) => <PostCard key={p.id} post={p} />)}
              </div>
            )}
          </>
        ) : (
          <EmptyState title="Nothing here yet">New stories appear here as soon as the academy publishes them.</EmptyState>
        )}
        <div className="mt-12 flex justify-between gap-3">
          {Number(page) > 1 ? <LinkButton variant="secondary" to={qs(Number(page) - 1)}><ArrowLeft size={16} /> Newer</LinkButton> : <span />}
          {data.has_more && <LinkButton variant="secondary" to={qs(Number(page) + 1)}>Older <ArrowRight size={16} /></LinkButton>}
        </div>
      </div>
    </div>
  );
}
