/**
 * Production web front: /robots.txt and /sitemap.xml (ports of the Next.js robots.ts and sitemap.ts), and the
 * built React app (client/dist) with route-aware <title>, description, Open Graph and canonical tags injected
 * into index.html so crawlers and link previews see the same metadata the Next.js pages declared.
 */
import fs from "node:fs";
import path from "node:path";

import express from "express";
import mongoose from "mongoose";

import { config } from "./config.js";
import { Academy, Batch, Event, GalleryAlbum, Post, Program, sameId } from "./models/index.js";
import { isObjectId } from "./models/plugins.js";
import { albumOut, liveFilter, sitemapData } from "./routes/public.js";
import * as batchSvc from "./services/batches.js";
import { SiteContent, siteContent } from "./services/rules.js";
import { now } from "./utils/clock.js";
import { log } from "./utils/logger.js";

const DEFAULT_NAME = "LuvAll Sports";
/** Root-layout metadata of the Next.js app (used outside the public website, e.g. the portals). */
const ROOT_DESCRIPTION = "Pickleball coaching batches for every level.";

/** Sitemap pages that always exist, in sitemap.ts order ("" is the homepage). */
const STATIC_PATHS = ["", "/about", "/programs", "/batches", "/coaches", "/venues", "/news", "/gallery", "/events", "/faq", "/contact"];

/** Page titles and descriptions declared by the Next.js `metadata` exports. */
const STATIC_PAGES = {
  "/about": { title: "About", description: "About the LuvAll Sports pickleball academy." },
  "/programs": { title: "Programs", description: "Pickleball coaching programs from beginner to competitive." },
  "/batches": {
    title: "Batches & schedule",
    description: "Available pickleball batches with timings, venues, coaches and live seat availability.",
  },
  "/coaches": { title: "Coaches", description: "Meet our certified pickleball coaches." },
  "/venues": { title: "Venues", description: "Where our pickleball batches are held." },
  "/news": { title: "News & achievements", description: "Player achievements, tournaments, events and academy updates." },
  "/gallery": { title: "Gallery", description: "Photos and videos from LuvAll Sports batches and tournaments." },
  "/events": { title: "Events", description: "Clinics, workshops and tournaments at LuvAll Sports." },
  "/faq": { title: "FAQs", description: "Frequently asked questions about batches, payments and make-ups." },
  "/contact": { title: "Contact", description: "Get in touch with LuvAll Sports." },
  "/login": { title: "Sign in", noindex: true },
  "/register": { title: "Create account", noindex: true },
};

/** Detail pages whose title/description come from the content item. */
const DETAIL_ROUTE = /^\/(news|programs|batches|events|gallery)\/([^/]+)$/;

/** Signed-in areas: never indexed (robots.txt also disallows them). Titles match the portal shells. */
const PORTAL_PREFIXES = ["/admin", "/coach", "/student", "/account"];
const PORTAL_TITLES = { "/admin": "Admin", "/coach": "Coach", "/student": "Student" };

const SEO_BLOCK = /<!--seo-->[\s\S]*?<!--\/seo-->/;

function siteBase() {
  return config.siteUrl.replace(/\/+$/, "");
}

function underPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeXml(value) {
  return escapeHtml(value).replace(/&#39;/g, "&apos;");
}

/** Make an image URL absolute against SITE_URL (uploads are served as /media/...). */
function absoluteUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;
  return `${siteBase()}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Same as the client's titleCase(): "intermediate_plus" -> "Intermediate Plus", empty -> "—". */
function titleCase(value) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const dbReady = () => mongoose.connection.readyState === 1;

async function currentAcademy() {
  return dbReady() ? Academy.findOne({ code: config.defaultAcademyCode }) : null;
}

/** robots.txt in the format Next.js renders for robots.ts. */
export function robotsTxt() {
  const disallow = [...PORTAL_PREFIXES, "/api/"];
  return [
    "User-Agent: *",
    "Allow: /",
    ...disallow.map((p) => `Disallow: ${p}`),
    "",
    `Sitemap: ${siteBase()}/sitemap.xml`,
    "",
  ].join("\n");
}

/** sitemap.xml in the format Next.js renders for sitemap.ts. Content lookups that fail leave only static pages. */
export async function sitemapXml() {
  const base = siteBase();
  let s = { programs: [], posts: [], albums: [], events: [], batches: [] };
  try {
    const academy = await currentAcademy();
    if (academy) s = await sitemapData(academy._id);
  } catch (err) {
    log("warning", "sitemap lookup failed", { error: String(err) });
  }
  const entries = [
    ...STATIC_PATHS.map((p) => ({ url: `${base}${p}`, changeFrequency: "weekly", priority: p === "" ? 1 : 0.7 })),
    ...s.programs.map((x) => ({ url: `${base}/programs/${encodeURIComponent(x)}` })),
    ...s.posts.map((x) => ({ url: `${base}/news/${encodeURIComponent(x)}` })),
    ...s.albums.map((x) => ({ url: `${base}/gallery/${encodeURIComponent(x)}` })),
    ...s.events.map((x) => ({ url: `${base}/events/${encodeURIComponent(x)}` })),
    ...s.batches.map((x) => ({ url: `${base}/batches/${x}` })),
  ];
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const e of entries) {
    xml += `<url>\n<loc>${escapeXml(e.url)}</loc>\n`;
    if (e.changeFrequency) xml += `<changefreq>${e.changeFrequency}</changefreq>\n`;
    if (typeof e.priority === "number") xml += `<priority>${e.priority}</priority>\n`;
    xml += "</url>\n";
  }
  return `${xml}</urlset>\n`;
}

/** Title/description/image for a detail page, or null when the item does not exist (or is not published). */
async function detailMeta(kind, key, academy) {
  const academyId = academy._id;
  switch (kind) {
    case "news": {
      const p = await Post.findOne({ academy_id: academyId, slug: key, ...liveFilter(now()) });
      return p && { title: p.title, description: p.summary, image: p.cover_image_url, type: "article" };
    }
    case "programs": {
      const p = await Program.findOne({ academy_id: academyId, slug: key, status: "published" });
      return p && { title: p.title, description: p.summary, image: p.image_url };
    }
    case "batches": {
      // Same visibility rule as GET /public/batches/{id}.
      const b = isObjectId(key) ? await Batch.findById(key) : null;
      if (!b || !sameId(b.academy_id, academyId) || !b.is_public) return null;
      const seatsLeft = await batchSvc.seatsLeft(b);
      return { title: b.name, description: `${b.name} — ${titleCase(b.skill_level)} pickleball batch. ${seatsLeft} seats left.` };
    }
    case "events": {
      const e = await Event.findOne({ academy_id: academyId, slug: key, status: "published" });
      return e && { title: e.title, description: e.description ? e.description.slice(0, 160) : null, image: e.cover_image_url };
    }
    case "gallery": {
      const a = await GalleryAlbum.findOne({ academy_id: academyId, slug: key, status: "published" });
      return a && { title: a.title, description: a.description, image: (await albumOut(a)).cover_url };
    }
    default:
      return null;
  }
}

/** The academy's homepage/SEO content, falling back to the defaults when it is missing or invalid. */
function contentOf(academy) {
  try {
    return siteContent(academy);
  } catch (err) {
    log("warning", "seo site content invalid", { error: String(err) });
    return SiteContent.parse({});
  }
}

/**
 * Metadata for a client route, following the Next.js layouts: the public website uses the academy's
 * seo_title / seo_description / hero image with "<title> · <academy>" page titles and per-item titles on detail
 * pages; the portals are noindex. Unknown paths and missing items get a 404 status (Next's notFound()) so
 * crawlers drop them, while the browser still receives the app shell. Never throws: failed lookups use the
 * site defaults.
 */
export async function pageMeta(pathname) {
  let academy = null;
  try {
    academy = await currentAcademy();
  } catch (err) {
    log("warning", "seo academy lookup failed", { error: String(err) });
  }
  const content = contentOf(academy);
  const name = academy?.name || DEFAULT_NAME;
  const meta = {
    title: content.seo_title || `${name} — Pickleball Academy`,
    description: content.seo_description || null,
    image: content.hero_image_url || null,
    type: "website",
    noindex: false,
    status: 200,
    siteName: name,
  };
  const page = (title) => `${title} · ${name}`;

  const portal = PORTAL_PREFIXES.find((p) => underPrefix(pathname, p));
  if (portal) {
    const label = PORTAL_TITLES[portal];
    return {
      ...meta,
      title: label ? `${label} · ${DEFAULT_NAME}` : `${name} — Pickleball Academy`,
      description: ROOT_DESCRIPTION,
      image: null,
      noindex: true,
    };
  }
  if (pathname === "/") return meta;
  const fixed = STATIC_PAGES[pathname];
  if (fixed) {
    meta.title = page(fixed.title);
    if (fixed.description) meta.description = fixed.description;
    meta.noindex = !!fixed.noindex;
    return meta;
  }
  const match = DETAIL_ROUTE.exec(pathname);
  if (!match) return { ...meta, status: 404, noindex: true };
  if (!academy) return meta;
  try {
    const found = await detailMeta(match[1], decodeURIComponent(match[2]), academy);
    if (!found) return { ...meta, status: 404, noindex: true };
    meta.title = page(found.title);
    if (found.description) meta.description = found.description;
    if (found.image) meta.image = found.image;
    if (found.type) meta.type = found.type;
  } catch (err) {
    log("warning", "seo lookup failed", { path: pathname, error: String(err) });
  }
  return meta;
}

/** The <!--seo--> block for a page. */
export function renderSeoTags(meta, pathname) {
  const canonical = `${siteBase()}${pathname}`;
  const tags = [`<title>${escapeHtml(meta.title)}</title>`];
  if (meta.description) tags.push(`<meta name="description" content="${escapeHtml(meta.description)}" />`);
  if (meta.noindex) tags.push('<meta name="robots" content="noindex" />');
  else tags.push(`<link rel="canonical" href="${escapeHtml(canonical)}" />`);
  tags.push(`<meta property="og:site_name" content="${escapeHtml(meta.siteName)}" />`);
  tags.push(`<meta property="og:type" content="${escapeHtml(meta.type)}" />`);
  tags.push(`<meta property="og:title" content="${escapeHtml(meta.title)}" />`);
  if (meta.description) tags.push(`<meta property="og:description" content="${escapeHtml(meta.description)}" />`);
  if (meta.image) tags.push(`<meta property="og:image" content="${escapeHtml(absoluteUrl(meta.image))}" />`);
  if (!meta.noindex) tags.push(`<meta property="og:url" content="${escapeHtml(canonical)}" />`);
  return tags.join("\n    ");
}

/** Replace the <!--seo--> ... <!--/seo--> block of index.html (or add one before </head>). */
export function injectSeo(template, tags) {
  const block = `<!--seo-->\n    ${tags}\n    <!--/seo-->`;
  if (SEO_BLOCK.test(template)) return template.replace(SEO_BLOCK, () => block);
  return template.replace("</head>", () => `${block}\n  </head>`);
}

/** Request path without trailing slashes; "/index.html" is the homepage. */
function normalisePath(p) {
  const trimmed = p.replace(/\/+$/, "") || "/";
  return trimmed === "/index.html" ? "/" : trimmed;
}

/** index.html of the build, re-read whenever the file changes (a rebuild renames the hashed assets). */
function templateLoader(indexFile) {
  let cached = null;
  let mtime = null;
  return () => {
    try {
      const { mtimeMs } = fs.statSync(indexFile);
      if (cached === null || mtimeMs !== mtime) {
        cached = fs.readFileSync(indexFile, "utf8");
        mtime = mtimeMs;
      }
    } catch (err) {
      if (cached === null) throw err;
    }
    return cached;
  };
}

/**
 * robots.txt and sitemap.xml always; the built client (config.clientDist, resolved now) only when its
 * index.html exists, so the API runs without a client build.
 */
export function mountClient(app) {
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send(robotsTxt());
  });

  app.get("/sitemap.xml", async (_req, res) => {
    res.type("application/xml").send(await sitemapXml());
  });

  const dist = config.clientDist;
  const indexFile = path.join(dist, "index.html");
  if (!fs.existsSync(indexFile)) return;
  const template = templateLoader(indexFile);

  // Hashed build assets never change: cache them for a year. A missing asset is a 404, not the app shell.
  app.use("/assets", express.static(path.join(dist, "assets"), { maxAge: "1y", immutable: true, fallthrough: false }));
  const serveStatic = express.static(dist, { index: false });
  app.use((req, res, next) => (req.path === "/index.html" ? next() : serveStatic(req, res, next)));

  // The app shell for every other page. A plain middleware rather than a "/{*splat}" route: route params are
  // percent-decoded while matching, and a malformed path (e.g. "/news/%E0%A4%A") would fail before reaching
  // this handler instead of falling back to the default tags.
  app.use(async (req, res, next) => {
    const isPage = req.method === "GET" || req.method === "HEAD";
    if (!isPage || underPrefix(req.path, "/api") || underPrefix(req.path, config.mediaUrlPrefix)) {
      next();
      return;
    }
    const pathname = normalisePath(req.path);
    const meta = await pageMeta(pathname);
    res
      .status(meta.status)
      .type("html")
      .set("Cache-Control", "no-cache")
      .send(injectSeo(template(), renderSeoTags(meta, pathname)));
  });
}
