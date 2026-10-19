import { Link } from "react-router";

import { PageHero } from "@/components/public/cards";
import { Seo } from "@/components/seo";
import { ErrorNote, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";

export default function FaqPage() {
  const { data: faqs, error } = useApi<any[]>("/public/faqs");
  const seo = <Seo title="FAQs" description="Frequently asked questions about batches, payments and make-ups." />;
  if (!faqs) {
    return (
      <div className="container-page max-w-3xl">
        {seo}
        {error ? <div className="py-14"><ErrorNote error={error} /></div> : <Loading />}
      </div>
    );
  }
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
  };
  return (
    <div>
      {seo}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <PageHero eyebrow="FAQ" title="Questions, answered">
        Batches, payments, make-ups and cancellations. Can&apos;t find your answer?{" "}
        <Link to="/contact" className="font-semibold text-white underline underline-offset-4 hover:text-ball">Get in touch</Link>.
      </PageHero>
      <div className="container-page max-w-4xl space-y-3 py-14">
        {faqs.map((f) => (
          <details key={f.id} className="group rounded-3xl bg-white px-6 py-5 shadow-[var(--shadow-card)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold">
              {f.question}
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-paper text-xl text-court-700 transition-transform group-open:rotate-45 group-open:bg-ball">+</span>
            </summary>
            <p className="mt-3 whitespace-pre-line text-muted">{f.answer}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
