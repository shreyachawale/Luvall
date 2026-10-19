import { ArrowRight } from "lucide-react";

import { CoachCard, Img, SectionHeading, type PublicCoach } from "@/components/public/cards";
import { Seo } from "@/components/seo";
import { ErrorNote, LinkButton, Loading, cx } from "@/components/ui";
import { useApi } from "@/lib/api";

import type { Site } from "./PublicLayout";

export default function AboutPage() {
  const { data: site, error: siteError } = useApi<Site>("/public/site");
  const { data: coaches, error: coachesError } = useApi<PublicCoach[]>("/public/coaches");
  const error = siteError ?? coachesError;
  const seo = <Seo title="About" description="About the LuvAll Sports pickleball academy." />;
  if (!site || !coaches) {
    return (
      <div className="container-page">
        {seo}
        {error ? <div className="py-14"><ErrorNote error={error} /></div> : <Loading />}
      </div>
    );
  }
  const c = site.content;
  const stats: { label: string; value: string }[] = c.stats ?? [];
  const mainImage = c.about_image_url || c.hero_image_url;
  // The hero photo fills the second tile when the page has its own about photo; otherwise a painted court does.
  const sideImage = c.about_image_url && c.hero_image_url !== c.about_image_url ? c.hero_image_url : null;
  return (
    <>
      {seo}

      {/* Editorial opener: label on a rule, the condensed title, the story beside it. */}
      <section className="container-page pt-10 sm:pt-14">
        <div className="mb-8 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted sm:mb-10">
          <span className="h-2 w-2 rounded-full bg-ball ring-4 ring-ball/25" />
          About us
          <span className="h-px flex-1 bg-line" />
        </div>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16">
          <h1 className="mega text-[clamp(3rem,7.6vw,6.8rem)] text-court-950">{c.about_title}</h1>
          <div className="flex flex-col justify-end gap-7">
            <div className="prose-body space-y-4 text-lg leading-relaxed text-ink/80">
              {String(c.about_body)
                .split(/\n\n+/)
                .map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
            </div>
            <div className="flex flex-wrap gap-2.5">
              <LinkButton to="/batches" variant="ball" size="lg">
                Join a batch <ArrowRight size={18} />
              </LinkButton>
              <LinkButton to="/contact" variant="secondary" size="lg">
                Contact us
              </LinkButton>
            </div>
          </div>
        </div>
      </section>

      {/* Photo grid with the headline number on a dark court tile. */}
      <section className="container-page pt-12 sm:pt-16">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] sm:aspect-[16/11] lg:aspect-auto lg:min-h-[36rem]">
            <div className="absolute inset-0">
              <Img src={mainImage} alt={c.about_title} className="h-full w-full" />
            </div>
            {stats.length > 1 && (
              <>
                <div className="scrim-bottom absolute inset-0" />
                <dl
                  className={cx(
                    "absolute inset-x-3 bottom-3 grid gap-2 sm:inset-x-5 sm:bottom-5 sm:flex sm:flex-wrap",
                    (stats.length - 1) % 3 === 0 ? "grid-cols-3" : "grid-cols-2",
                  )}
                >
                  {stats.slice(1).map((s) => (
                    <div key={s.label} className="glass-dark flex flex-col-reverse justify-end rounded-2xl px-3 py-3 sm:min-w-[9.5rem] sm:px-4">
                      <dt className="mt-1.5 text-xs font-medium text-white/80">{s.label}</dt>
                      <dd className="num font-display text-3xl leading-none text-ball">{s.value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </div>
          <div className="flex flex-col gap-4">
            <Img
              src={sideImage}
              alt=""
              className={cx("hidden w-full overflow-hidden rounded-3xl sm:block", stats[0] ? "aspect-[16/10]" : "aspect-[16/10] lg:aspect-auto lg:flex-1")}
            />
            {stats[0] && (
              <div className="court-lines relative isolate flex flex-1 flex-col justify-end overflow-hidden rounded-3xl bg-court-950 p-6 pt-20 text-white sm:p-8 sm:pt-24">
                <span aria-hidden className="absolute -right-8 -top-10 -z-10 h-32 w-32 rounded-full bg-ball shadow-[16px_16px_40px_rgb(0_0_0/0.35)] sm:h-36 sm:w-36" />
                <dl className="flex flex-col-reverse">
                  <dt className="mt-3 text-lg font-semibold">{stats[0].label}</dt>
                  <dd className="num font-display text-8xl leading-[0.85] text-ball sm:text-9xl">{stats[0].value}</dd>
                </dl>
              </div>
            )}
          </div>
        </div>
      </section>

      {coaches.length > 0 && (
        <section className="container-page pt-20 sm:pt-24">
          <SectionHeading eyebrow="Our team" title="Coaches" />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {coaches.map((coach) => (
              <CoachCard key={coach.id} coach={coach} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
