import { CoachCard, Img, PageHero, type PublicCoach } from "@/components/public/cards";
import { Seo } from "@/components/seo";
import { ErrorNote, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";

export default function CoachesPage() {
  const { data: coaches, error } = useApi<PublicCoach[]>("/public/coaches");
  const seo = <Seo title="Coaches" description="Meet our certified pickleball coaches." />;
  if (!coaches) {
    return (
      <div className="container-page">
        {seo}
        {error ? <div className="py-14"><ErrorNote error={error} /></div> : <Loading />}
      </div>
    );
  }
  const years = coaches.reduce((sum, c) => sum + (c.experience_years ?? 0), 0);
  const facts = [
    { value: String(coaches.length), label: coaches.length === 1 ? "Certified coach" : "Certified coaches" },
    ...(years > 0 ? [{ value: `${years}+`, label: "Combined years coaching" }] : []),
  ];
  return (
    <>
      {seo}
      <PageHero
        eyebrow="Coaches"
        title="Meet the coaching team"
        actions={
          coaches.length > 0 && (
            <dl className="grid w-full grid-cols-2 gap-2.5 sm:flex sm:w-auto sm:flex-wrap">
              {facts.map((f, i) => (
                <div key={f.label} className="glass-dark flex items-center gap-5 rounded-2xl px-4 py-3">
                  <div className="flex min-w-0 flex-col-reverse">
                    <dt className="mt-1.5 text-xs font-medium text-white/75">{f.label}</dt>
                    <dd className="num font-display text-3xl leading-none text-ball">{f.value}</dd>
                  </div>
                  {i === 0 && (
                    <div className="hidden -space-x-2.5 sm:flex" aria-hidden>
                      {coaches.slice(0, 4).map((c) => (
                        <Img key={c.id} src={c.photo_url} alt="" className="h-10 w-10 overflow-hidden rounded-full ring-2 ring-court-950" />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </dl>
          )
        }
      >
        Certified coaches who keep batches small and feedback personal.
      </PageHero>

      <section className="container-page pt-16 sm:pt-20">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {coaches.map((c) => (
            <CoachCard key={c.id} coach={c} full />
          ))}
        </div>
      </section>
    </>
  );
}
