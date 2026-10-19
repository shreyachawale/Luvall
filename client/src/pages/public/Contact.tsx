import { ArrowUpRight, Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { ReactNode } from "react";

import { PageHero } from "@/components/public/cards";
import { EnquiryForm } from "@/components/public/enquiry-form";
import { Seo } from "@/components/seo";
import { ErrorNote, Loading, buttonClass, cx } from "@/components/ui";
import { useApi } from "@/lib/api";
import { waLink } from "@/lib/format";

import type { Site } from "./PublicLayout";

/** One contact detail as a rounded tile; the whole tile is the link when there is one. */
function InfoTile({ icon, label, href, children }: { icon: ReactNode; label: string; href?: string; children: ReactNode }) {
  const body = (
    <>
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-court text-ball">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-muted">{label}</span>
        <span className="mt-1 block font-semibold leading-snug text-ink">{children}</span>
      </span>
      {href && (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper text-ink transition-transform group-hover:rotate-45">
          <ArrowUpRight size={16} />
        </span>
      )}
    </>
  );
  const tile = "flex items-center gap-4 rounded-3xl bg-white p-4 pr-5 shadow-[var(--shadow-card)]";
  return href ? (
    <a href={href} className={cx(tile, "group transition-colors hover:bg-ball-100")}>
      {body}
    </a>
  ) : (
    <div className={tile}>{body}</div>
  );
}

export default function ContactPage() {
  const { data: site, error } = useApi<Site>("/public/site");
  const seo = <Seo title="Contact" description="Get in touch with LuvAll Sports." />;
  if (!site) {
    return (
      <div className="container-page">
        {seo}
        {error ? <div className="py-14"><ErrorNote error={error} /></div> : <Loading />}
      </div>
    );
  }
  const c = site.content;
  return (
    <>
      {seo}
      <PageHero
        eyebrow="Contact"
        title="Talk to us"
        actions={
          site.payment.whatsapp_number && (
            <a href={waLink(site.payment.whatsapp_number, "Hi LuvAll Sports!")} target="_blank" rel="noopener noreferrer" className={buttonClass("ball", "lg")}>
              <MessageCircle size={18} /> Chat on WhatsApp
            </a>
          )
        }
      >
        Questions about batches, trials or private sessions? We usually reply within a few hours.
      </PageHero>

      <section className="container-page pt-16 sm:pt-20">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-start lg:gap-8">
          <div className="space-y-3">
            <ul className="space-y-3">
              {c.contact_phone && (
                <li>
                  <InfoTile icon={<Phone size={20} />} label="Phone" href={`tel:${c.contact_phone.replace(/\s/g, "")}`}>
                    {c.contact_phone}
                  </InfoTile>
                </li>
              )}
              {c.contact_email && (
                <li>
                  <InfoTile icon={<Mail size={20} />} label="Email" href={`mailto:${c.contact_email}`}>
                    <span className="break-all">{c.contact_email}</span>
                  </InfoTile>
                </li>
              )}
              {c.contact_address && (
                <li>
                  <InfoTile icon={<MapPin size={20} />} label="Address">
                    {c.contact_address}
                  </InfoTile>
                </li>
              )}
              {c.contact_hours && (
                <li>
                  <InfoTile icon={<Clock size={20} />} label="Hours">
                    {c.contact_hours}
                  </InfoTile>
                </li>
              )}
            </ul>
            {c.map_embed_url && (
              <iframe
                src={c.map_embed_url}
                title="Map"
                loading="lazy"
                className="aspect-[4/3] w-full rounded-3xl border-0 bg-white shadow-[var(--shadow-card)]"
                referrerPolicy="no-referrer-when-downgrade"
              />
            )}
          </div>
          <div className="rounded-3xl bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
            <h2 className="font-display text-4xl uppercase leading-none text-court-950">Send a message</h2>
            <div className="mt-6">
              <EnquiryForm />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
