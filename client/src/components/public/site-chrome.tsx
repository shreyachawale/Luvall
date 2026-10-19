import { Menu, MessageCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";

import { buttonClass, cx } from "@/components/ui";
import { waLink } from "@/lib/format";
import { NAV } from "@/lib/nav";

/** Ball mark + condensed uppercase wordmark. */
export function Logo({ name, light }: { name: string; light?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label={`${name} home`}>
      <span className="grid h-9 w-9 place-items-center rounded-full bg-court shadow-sm">
        <span className="h-4 w-4 rounded-full bg-ball ring-[3px] ring-ball/25" />
      </span>
      <span className={cx("font-display text-xl uppercase leading-none tracking-wide", light ? "text-white" : "text-court-950")}>
        {name}
      </span>
    </Link>
  );
}

/** Floating pill navigation bar. */
export function SiteHeader({ name, signedIn }: { name: string; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <header className="sticky top-0 z-40 pt-3">
      <div className="container-page">
        <div className="flex h-16 items-center justify-between gap-4 rounded-full bg-white/90 pl-4 pr-2.5 shadow-[0_8px_30px_-12px_rgb(15_27_22/0.25)] ring-1 ring-line/80 backdrop-blur sm:pl-5">
          <Logo name={name} />
          <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Main">
            {NAV.map((n) => (
              <Link
                key={n.href}
                to={n.href}
                className={cx(
                  "rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                  pathname.startsWith(n.href) ? "bg-court text-white" : "text-ink/75 hover:bg-paper hover:text-ink",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-1.5 lg:flex">
            {signedIn ? (
              <Link to="/account" className={buttonClass("primary", "md")}>
                My dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className={buttonClass("ghost", "md")}>
                  Sign in
                </Link>
                <Link to="/batches" className={buttonClass("ball", "md")}>
                  Join a batch
                </Link>
              </>
            )}
          </div>
          <button
            className="grid h-11 w-11 place-items-center rounded-full bg-paper text-court lg:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label="Menu"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {open && (
          <div className="mt-2 rounded-3xl bg-white p-3 shadow-[var(--shadow-lift)] ring-1 ring-line lg:hidden">
            <nav className="flex flex-col" aria-label="Mobile">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  to={n.href}
                  className={cx(
                    "rounded-2xl px-4 py-3 font-medium",
                    pathname.startsWith(n.href) ? "bg-court text-white" : "text-ink hover:bg-paper",
                  )}
                >
                  {n.label}
                </Link>
              ))}
              <div className="mt-3 flex gap-2">
                {signedIn ? (
                  <Link to="/account" className={buttonClass("primary", "lg", "flex-1")}>
                    My dashboard
                  </Link>
                ) : (
                  <>
                    <Link to="/login" className={buttonClass("secondary", "lg", "flex-1")}>
                      Sign in
                    </Link>
                    <Link to="/batches" className={buttonClass("ball", "lg", "flex-1")}>
                      Join a batch
                    </Link>
                  </>
                )}
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}

export function WhatsAppFab({ number }: { number: string }) {
  if (!number) return null;
  return (
    <a
      href={waLink(number, "Hi LuvAll Sports! I'd like to know more about your pickleball batches.")}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-5 right-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-[#25D366] text-white shadow-lg transition-transform hover:scale-105"
      aria-label="Chat with us on WhatsApp"
    >
      <MessageCircle size={26} />
    </a>
  );
}
