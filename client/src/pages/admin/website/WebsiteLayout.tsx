import { Link, Outlet, useLocation } from "react-router";

import { cx } from "@/components/ui";

const LINKS = [
  { href: "/admin/website", label: "Homepage" },
  { href: "/admin/website/posts", label: "Posts & campaigns" },
  { href: "/admin/website/programs", label: "Programs" },
  { href: "/admin/website/gallery", label: "Gallery" },
  { href: "/admin/website/media", label: "Media library" },
  { href: "/admin/website/events", label: "Events" },
  { href: "/admin/website/testimonials", label: "Testimonials" },
  { href: "/admin/website/faqs", label: "FAQs" },
  { href: "/admin/website/announcements", label: "Announcements" },
  { href: "/admin/website/enquiries", label: "Enquiries" },
];

export default function WebsiteLayout() {
  const pathname = useLocation().pathname;
  return (
    <>
      <nav className="-mx-1 mb-6 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Website sections">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            to={l.href}
            className={cx(
              "whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium",
              pathname === l.href ? "bg-court text-white" : "bg-white text-ink/75 ring-1 ring-line hover:text-court",
            )}
          >
            {l.label}
          </Link>
        ))}
        <a href="/" target="_blank" className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold text-court-700 underline">View site ↗</a>
      </nav>
      <Outlet />
    </>
  );
}
