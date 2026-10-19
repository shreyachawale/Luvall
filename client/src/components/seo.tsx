import { useEffect } from "react";

import { useApi } from "@/lib/api";

const FALLBACK_NAME = "LuvAll Sports";

function setMeta(attr: "name" | "property", key: string, content: string | undefined) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!content) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

/**
 * Sets the document title and description for the current route. The server also injects these tags into
 * the initial HTML for crawlers and link previews (server/src/seo.js); this keeps them right while navigating.
 * Titles follow the "<title> · <academy name>" template; pages without their own image share the hero image.
 * Render exactly one <Seo> per screen.
 */
export function Seo({
  title,
  description,
  image,
  fullTitle,
  noindex,
}: {
  title?: string;
  description?: string | null;
  image?: string | null;
  fullTitle?: string;
  noindex?: boolean;
}) {
  // Already cached by the public layout; portal screens pass fullTitle and skip the request.
  const { data: site } = useApi<{ academy: { name: string }; content: { hero_image_url?: string } }>(
    fullTitle ? null : "/public/site",
  );
  const name = site?.academy?.name || FALLBACK_NAME;
  const ogImage = image ?? (site?.content?.hero_image_url || undefined);

  useEffect(() => {
    const t = fullTitle ?? (title ? `${title} · ${name}` : `${name} — Pickleball Academy`);
    document.title = t;
    setMeta("name", "description", description ?? undefined);
    setMeta("name", "robots", noindex ? "noindex" : undefined);
    setMeta("property", "og:title", t);
    setMeta("property", "og:description", description ?? undefined);
    setMeta(
      "property",
      "og:image",
      ogImage ? new URL(ogImage, window.location.origin).toString() : undefined,
    );
  }, [title, description, ogImage, fullTitle, noindex, name]);
  return null;
}
