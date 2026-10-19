import { ArrowRight } from "lucide-react";

import { Seo } from "@/components/seo";
import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="container-page pt-4">
      <Seo description="Pickleball coaching batches for every level." noindex />
      <div className="court-diagonals relative isolate flex min-h-[60vh] flex-col items-start justify-end overflow-hidden rounded-[2rem] bg-court-950 p-6 text-white sm:p-12">
        <span aria-hidden className="absolute -right-10 -top-10 -z-10 h-48 w-48 rounded-full bg-ball shadow-[24px_24px_60px_rgb(0_0_0/0.35)] sm:h-64 sm:w-64" />
        <p className="font-display text-[clamp(6rem,22vw,14rem)] leading-[0.8] text-ball">404</p>
        <h1 className="mega mt-4 text-[clamp(2.4rem,5vw,4.4rem)]">That page is out of bounds</h1>
        <p className="mt-3 max-w-lg text-white/75">The page you are looking for doesn&apos;t exist or is no longer published.</p>
        <div className="mt-8 flex flex-wrap gap-2.5">
          <LinkButton to="/" variant="ball" size="lg">Back to home</LinkButton>
          <LinkButton to="/batches" variant="glass" size="lg">See batches <ArrowRight size={18} /></LinkButton>
        </div>
      </div>
    </div>
  );
}
