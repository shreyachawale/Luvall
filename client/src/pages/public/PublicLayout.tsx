import { ArrowRight, Facebook, Instagram, Mail, MapPin, Phone, Youtube } from "lucide-react";
import { Link, Outlet } from "react-router";

import { Logo, SiteHeader, WhatsAppFab } from "@/components/public/site-chrome";
import { buttonClass, ErrorNote, Loading } from "@/components/ui";
import { maybeSignedIn, useApi } from "@/lib/api";
import { NAV } from "@/lib/nav";

export type Site = {
  academy: { name: string; description: string | null; location: string | null; contact_no: string | null; email: string | null };
  content: Record<string, any> & { stats: { label: string; value: string }[] };
  payment: { upi_id: string; payee_name: string; qr_image_url: string; whatsapp_number: string; instructions: string };
  announcements: { id: string; title: string; message: string; link_url: string | null }[];
};

const skipLink = (
  <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
    Skip to content
  </a>
);

export default function PublicLayout() {
  const { data: site, error } = useApi<Site>("/public/site");
  const { data: me } = useApi(maybeSignedIn() ? "/auth/me" : null, { shouldRetryOnError: false });
  const signedIn = !!me;
  if (!site) {
    return (
      <div className="flex min-h-screen flex-col">
        {skipLink}
        <header className="sticky top-0 z-40 pt-3">
          <div className="container-page">
            <div className="h-16 rounded-full bg-white/90 ring-1 ring-line/80" />
          </div>
        </header>
        <main id="main" className="flex-1">
          <div className="container-page">{error ? <div className="py-14"><ErrorNote error={error} /></div> : <Loading />}</div>
        </main>
      </div>
    );
  }
  const c = site.content;
  const banner = site.announcements[0];
  const social = [
    { href: c.instagram_url, label: "Instagram", icon: <Instagram size={18} /> },
    { href: c.youtube_url, label: "YouTube", icon: <Youtube size={18} /> },
    { href: c.facebook_url, label: "Facebook", icon: <Facebook size={18} /> },
  ].filter((x) => x.href);
  return (
    <div className="flex min-h-screen flex-col">
      {skipLink}
      {banner && (
        <div className="bg-court-950 text-center text-sm text-white">
          <div className="container-page py-2.5">
            <span className="font-semibold text-ball">{banner.title}</span>
            <span className="text-white/75"> — {banner.message}</span>
            {banner.link_url && (
              <Link to={banner.link_url} className="ml-2 font-semibold underline underline-offset-4 hover:text-ball">
                Learn more
              </Link>
            )}
          </div>
        </div>
      )}
      <SiteHeader name={site.academy.name} signedIn={signedIn} />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <footer className="mt-24 overflow-hidden bg-court-950 text-white/75">
        <div className="container-page grid grid-cols-1 gap-10 pb-10 pt-16 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="space-y-4">
            <Logo name={site.academy.name} light />
            <p className="max-w-sm text-sm leading-relaxed">{c.hero_subtitle}</p>
            <Link to="/batches" className={buttonClass("ball", "md")}>
              Join a batch <ArrowRight size={16} />
            </Link>
          </div>
          <div>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-white">Explore</h2>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
              {[...NAV, { href: "/faq", label: "FAQs" }, { href: "/events", label: "Events" }, { href: "/about", label: "About" }].map((n) => (
                <li key={n.href}>
                  <Link to={n.href} className="hover:text-ball">
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-white">Contact</h2>
            <ul className="space-y-2.5 text-sm">
              {c.contact_phone && (
                <li className="flex gap-2.5">
                  <Phone size={16} className="mt-0.5 shrink-0 text-ball" />
                  <a href={`tel:${c.contact_phone.replace(/\s/g, "")}`} className="hover:text-ball">{c.contact_phone}</a>
                </li>
              )}
              {c.contact_email && (
                <li className="flex gap-2.5">
                  <Mail size={16} className="mt-0.5 shrink-0 text-ball" />
                  <a href={`mailto:${c.contact_email}`} className="break-all hover:text-ball">{c.contact_email}</a>
                </li>
              )}
              {c.contact_address && (
                <li className="flex gap-2.5">
                  <MapPin size={16} className="mt-0.5 shrink-0 text-ball" />
                  <span>{c.contact_address}</span>
                </li>
              )}
              {c.contact_hours && <li className="pl-[26px] text-white/55">{c.contact_hours}</li>}
            </ul>
          </div>
          <div>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-white">Follow</h2>
            {social.length > 0 && (
              <div className="flex gap-2">
                {social.map((x) => (
                  <a key={x.label} href={x.href} target="_blank" rel="noopener noreferrer" aria-label={x.label} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-ball hover:text-court-950">
                    {x.icon}
                  </a>
                ))}
              </div>
            )}
            <Link to="/login" className="mt-6 inline-block text-sm underline underline-offset-4 hover:text-ball">
              Student & coach sign in
            </Link>
          </div>
        </div>
        <div className="container-page">
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 py-5 text-xs text-white/45">
            <span>© {new Date().getFullYear()} {site.academy.name}. All rights reserved.</span>
            {site.academy.location && <span>{site.academy.location}</span>}
          </div>
        </div>
        <p aria-hidden className="pointer-events-none -mb-[0.05em] select-none whitespace-nowrap text-center font-display text-[16.5vw] uppercase leading-[0.8] text-white/[0.07]">
          {site.academy.name}
        </p>
      </footer>
      <WhatsAppFab number={site.payment.whatsapp_number} />
    </div>
  );
}
