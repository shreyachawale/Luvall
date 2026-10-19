/** Read-only endpoints that power the public marketing website (no authentication). */
import express from "express";

import {
  Announcement,
  Batch,
  CoachProfile,
  Enquiry,
  Event,
  Faq,
  FeePlan,
  GalleryAlbum,
  MediaAsset,
  Post,
  Program,
  sameId,
  sid,
  Testimonial,
  toJSON,
  User,
  Venue,
} from "../models/index.js";
import { isObjectId } from "../models/plugins.js";
import * as batchSvc from "../services/batches.js";
import { businessRules, siteContent } from "../services/rules.js";
import { authRateLimiter } from "../services/security.js";
import { now, today } from "../utils/clock.js";
import { badRequest, BusinessRuleError, NotFoundError } from "../utils/errors.js";
import { clientIp, read, write } from "../utils/http.js";
import { opt, parseBody, parseQuery, z, zEmailStr, zId } from "../utils/validate.js";
import { batchOut } from "./serializers.js";

const router = express.Router();

const PUBLIC_BATCH_STATUSES = ["upcoming", "active"];

/** Query-string integer parsed like FastAPI/Pydantic: "", "2.5" or "abc" are rejected (422). */
const qInt = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v;
    const s = v.trim();
    return /^[+-]?\d+(_\d+)*(\.0*)?$/.test(s) ? Number(s.replace(/_/g, "").replace(/\.0*$/, "")) : v;
  },
  z.number({ invalid_type_error: "Input should be a valid integer, unable to parse string as an integer" }).int(),
);

const TRUTHY = new Set(["1", "on", "t", "true", "y", "yes"]);
const FALSY = new Set(["0", "off", "f", "false", "n", "no"]);

/** Query-string boolean parsed like FastAPI/Pydantic: anything but the known spellings is rejected (422). */
const qBool = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v;
    const s = v.toLowerCase();
    if (TRUTHY.has(s)) return true;
    if (FALSY.has(s)) return false;
    return v;
  },
  z.boolean({ invalid_type_error: "Input should be a valid boolean, unable to interpret input" }),
);

/** Mongo filter for content that is published and inside its publish window at `at`. */
export function liveFilter(at) {
  return {
    status: "published",
    $and: [
      { $or: [{ publish_from: null }, { publish_from: { $lte: at } }] },
      { $or: [{ publish_to: null }, { publish_to: { $gt: at } }] },
    ],
  };
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function siteInfo(academy) {
  const rules = businessRules(academy);
  return {
    academy: {
      name: academy.name,
      description: academy.description ?? null,
      location: academy.location ?? null,
      contact_no: academy.contact_no ?? null,
      email: academy.email ?? null,
      logo_url: academy.logo_url ?? null,
    },
    content: siteContent(academy),
    payment: rules.payment,
  };
}

/** Live announcements for the given audiences: pinned first, then newest. */
export async function announcementsFor(academyId, audiences, limit = 10) {
  const rows = await Announcement.find({ academy_id: academyId, audience: { $in: audiences }, ...liveFilter(now()) })
    .sort({ is_pinned: -1, publish_from: -1, _id: -1 })
    .limit(limit);
  return toJSON(rows);
}

/** Public, active coaches with active user accounts, by display order then name. */
export async function publicCoaches(academyId) {
  const profiles = await CoachProfile.find({ academy_id: academyId, is_public: true, status: "active" });
  if (!profiles.length) return [];
  const users = await User.find({ _id: { $in: profiles.map((p) => p._id) }, status: "active" }).select("name photo_url");
  const byId = new Map(users.map((u) => [sid(u), u]));
  return profiles
    .filter((p) => byId.has(sid(p)))
    .map((p) => [p, byId.get(sid(p))])
    .sort(([pa, ua], [pb, ub]) => (pa.display_order ?? 0) - (pb.display_order ?? 0) || cmp(ua.name, ub.name))
    .map(([p, u]) => ({
      id: sid(u),
      name: u.name,
      photo_url: u.photo_url ?? null,
      title: p.title ?? null,
      certifications: p.certifications ?? null,
      bio: p.profile_bio ?? null,
      specialties: p.specialties ?? null,
      experience_years: p.experience_years ?? null,
    }));
}

const VENUE_FIELDS = ["name", "address", "city", "map_url", "courts_available", "description", "photo_url", "amenities"];

export async function publicVenues(academyId) {
  const rows = await Venue.find({ academy_id: academyId, is_public: true, status: "active" }).sort({ name: 1 });
  return rows.map((v) => ({ id: sid(v), ...Object.fromEntries(VENUE_FIELDS.map((k) => [k, v[k] ?? null])) }));
}

/**
 * Bookable batches (public, upcoming or active) ordered by start date (undated last) then name, with live seat
 * availability. `limit` trims the list before serialising (the homepage shows the first nine).
 */
export async function publicBatches(academyId, { programId = null, venueId = null, skillLevel = null } = {}, limit = null) {
  const filter = { academy_id: academyId, is_public: true, status: { $in: PUBLIC_BATCH_STATUSES } };
  if (programId) filter.program_id = programId;
  if (skillLevel) filter.skill_level = skillLevel;
  let batches = (await Batch.find(filter)).sort(
    (a, b) => (a.start_date == null) - (b.start_date == null) || cmp(a.start_date ?? "", b.start_date ?? "") || cmp(a.name, b.name),
  );
  if (venueId) batches = batches.filter((b) => b.schedules.some((s) => sameId(s.venue_id, venueId)));
  if (limit !== null) batches = batches.slice(0, limit);
  const taken = await batchSvc.seatCounts(batches.map((b) => b._id));
  const out = [];
  for (const b of batches) out.push(await batchOut(b, taken[sid(b)], true));
  return out;
}

/** Media assets for the ids, in the order given (ids whose asset no longer exists are skipped). */
async function mediaInOrder(ids) {
  if (!ids?.length) return [];
  const found = await MediaAsset.find({ _id: { $in: ids } });
  const byId = new Map(found.map((m) => [sid(m), m]));
  return ids.map((id) => byId.get(sid(id))).filter(Boolean);
}

/** A post card; `full` adds the body and its ordered photo gallery. */
export async function postOut(p, full = false) {
  const data = {
    id: sid(p),
    title: p.title,
    slug: p.slug,
    category: p.category,
    summary: p.summary ?? null,
    cover_image_url: p.cover_image_url ?? null,
    video_url: p.video_url ?? null,
    is_featured: p.is_featured,
    publish_from: p.publish_from ?? null,
  };
  if (full) {
    data.body = p.body ?? null;
    data.images = (await mediaInOrder(p.image_ids)).map((m) => ({
      url: m.storage_url,
      thumbnail_url: m.thumbnail_url ?? null,
      caption: m.caption ?? null,
      alt_text: m.alt_text ?? null,
      media_type: m.media_type,
    }));
  }
  return data;
}

const ALBUM_ITEM_FIELDS = ["media_type", "storage_url", "thumbnail_url", "caption", "alt_text", "width", "height"];

/**
 * An album card. The cover is the chosen cover media, else the first active image. `items` lists every active
 * item in album order; `preview` lists only the first N.
 */
export async function albumOut(a, { items = false, preview = 0 } = {}) {
  const cover = a.cover_media_id ? await MediaAsset.findById(a.cover_media_id) : null;
  const all = await mediaInOrder(a.media_ids);
  const data = {
    id: sid(a),
    title: a.title,
    slug: a.slug,
    description: a.description ?? null,
    cover_url: cover ? cover.thumbnail_url || cover.storage_url : null,
    count: all.length,
  };
  const media = all.filter((m) => m.status === "active");
  if (!data.cover_url) {
    const firstImage = media.find((m) => m.media_type === "image");
    data.cover_url = firstImage ? firstImage.thumbnail_url || firstImage.storage_url : null;
  }
  if (items || preview) {
    const chosen = items ? media : media.slice(0, preview);
    data.items = chosen.map((m) => ({ id: sid(m), ...Object.fromEntries(ALBUM_ITEM_FIELDS.map((k) => [k, m[k] ?? null])) }));
  }
  return data;
}

async function publishedAlbums(academyId) {
  return GalleryAlbum.find({ academy_id: academyId, status: "published" }).sort({ display_order: 1, _id: -1 });
}

async function publishedPrograms(academyId) {
  return Program.find({ academy_id: academyId, status: "published" }).sort({ display_order: 1, title: 1 });
}

async function publishedTestimonials(academyId, limit = 0) {
  return Testimonial.find({ academy_id: academyId, status: "published" }).sort({ display_order: 1, _id: -1 }).limit(limit);
}

async function publishedFaqs(academyId, limit = 0) {
  return Faq.find({ academy_id: academyId, status: "published" }).sort({ display_order: 1, _id: 1 }).limit(limit);
}

/** Slugs / ids of everything public, for the sitemap. */
export async function sitemapData(academyId) {
  const at = now();
  const slugs = async (Model, filter) => (await Model.find({ academy_id: academyId, ...filter }).sort({ _id: 1 }).select("slug")).map((x) => x.slug);
  return {
    programs: await slugs(Program, { status: "published" }),
    posts: await slugs(Post, liveFilter(at)),
    albums: await slugs(GalleryAlbum, { status: "published" }),
    events: await slugs(Event, { status: "published" }),
    batches: (
      await Batch.find({ academy_id: academyId, is_public: true, status: { $in: PUBLIC_BATCH_STATUSES } })
        .sort({ _id: 1 })
        .select("_id")
    ).map((b) => sid(b)),
  };
}

router.get(
  "/public/site",
  read(async (req) => ({ ...siteInfo(req.academy), announcements: await announcementsFor(req.academy._id, ["public"]) })),
);

router.get(
  "/public/home",
  read(async (req) => {
    const academyId = req.academy._id;
    const at = now();
    const [announcements, programs, posts, testimonials, faqs, events, albums, batches, coaches, venues] = await Promise.all([
      announcementsFor(academyId, ["public"]),
      publishedPrograms(academyId),
      Post.find({ academy_id: academyId, ...liveFilter(at) })
        .sort({ is_featured: -1, publish_from: -1, _id: -1 })
        .limit(6),
      publishedTestimonials(academyId, 9),
      publishedFaqs(academyId, 8),
      Event.find({ academy_id: academyId, status: "published", event_date: { $gte: today() } })
        .sort({ event_date: 1 })
        .limit(4),
      publishedAlbums(academyId),
      publicBatches(academyId, {}, 9),
      publicCoaches(academyId),
      publicVenues(academyId),
    ]);
    // Reels: active videos that sit in any published album, newest first.
    const albumMediaIds = albums.flatMap((a) => a.media_ids);
    const videos = albumMediaIds.length
      ? await MediaAsset.find({ _id: { $in: albumMediaIds }, academy_id: academyId, media_type: "video", status: "active" })
          .sort({ _id: -1 })
          .limit(6)
      : [];
    const albumCards = [];
    for (const a of albums.slice(0, 4)) albumCards.push(await albumOut(a, { preview: 6 }));
    const postCards = [];
    for (const p of posts) postCards.push(await postOut(p));
    return {
      ...siteInfo(req.academy),
      announcements,
      programs: toJSON(programs),
      batches,
      coaches,
      venues,
      posts: postCards,
      albums: albumCards,
      videos: toJSON(videos),
      testimonials: toJSON(testimonials),
      faqs: toJSON(faqs),
      events: toJSON(events),
    };
  }),
);

router.get(
  "/public/programs",
  read(async (req) => toJSON(await publishedPrograms(req.academy._id))),
);

router.get(
  "/public/programs/:slug",
  read(async (req) => {
    const p = await Program.findOne({ academy_id: req.academy._id, slug: req.params.slug, status: "published" });
    if (!p) throw new NotFoundError("Program not found");
    return { ...toJSON(p), batches: await publicBatches(req.academy._id, { programId: p._id }) };
  }),
);

const BatchesQuery = z.object({
  program_id: zId.optional(),
  venue_id: zId.optional(),
  skill_level: z.string().optional(),
});

router.get(
  "/public/batches",
  read(async (req) => {
    const q = parseQuery(BatchesQuery, req);
    return publicBatches(req.academy._id, { programId: q.program_id, venueId: q.venue_id, skillLevel: q.skill_level });
  }),
);

router.get(
  "/public/batches/:batch_id",
  read(async (req) => {
    const id = req.params.batch_id;
    const b = isObjectId(id) ? await Batch.findById(id) : null;
    if (!b || !sameId(b.academy_id, req.academy._id) || !b.is_public) throw new NotFoundError("Batch not found");
    return batchOut(b, null, true);
  }),
);

const FEE_PLAN_FIELDS = ["name", "description", "plan_type", "number_of_sessions", "base_fee", "validity_days"];

router.get(
  "/public/fee-plans",
  read(async (req) => {
    const rows = await FeePlan.find({ academy_id: req.academy._id, status: "active", is_public: true }).sort({ base_fee: 1 });
    return rows.map((f) => ({ id: sid(f), ...Object.fromEntries(FEE_PLAN_FIELDS.map((k) => [k, f[k] ?? null])) }));
  }),
);

router.get(
  "/public/coaches",
  read(async (req) => publicCoaches(req.academy._id)),
);

router.get(
  "/public/venues",
  read(async (req) => publicVenues(req.academy._id)),
);

const PostsQuery = z.object({
  category: z.string().optional(),
  page: qInt.default(1),
  page_size: qInt.default(12),
});

router.get(
  "/public/posts",
  read(async (req) => {
    const q = parseQuery(PostsQuery, req);
    const pageSize = Math.min(Math.max(q.page_size, 1), 50);
    const filter = { academy_id: req.academy._id, ...liveFilter(now()) };
    if (q.category) filter.category = q.category;
    const rows = await Post.find(filter)
      .sort({ publish_from: -1, _id: -1 })
      .skip((Math.max(q.page, 1) - 1) * pageSize)
      .limit(pageSize + 1);
    const items = [];
    for (const p of rows.slice(0, pageSize)) items.push(await postOut(p));
    return { items, has_more: rows.length > pageSize, page: q.page };
  }),
);

router.get(
  "/public/posts/:slug",
  read(async (req) => {
    const p = await Post.findOne({ academy_id: req.academy._id, slug: req.params.slug, ...liveFilter(now()) });
    if (!p) throw new NotFoundError("Post not found");
    return postOut(p, true);
  }),
);

router.get(
  "/public/gallery",
  read(async (req) => {
    const out = [];
    for (const a of await publishedAlbums(req.academy._id)) out.push(await albumOut(a, { preview: 4 }));
    return out;
  }),
);

router.get(
  "/public/gallery/:slug",
  read(async (req) => {
    const a = await GalleryAlbum.findOne({ academy_id: req.academy._id, slug: req.params.slug, status: "published" });
    if (!a) throw new NotFoundError("Album not found");
    return albumOut(a, { items: true });
  }),
);

const EventsQuery = z.object({ include_past: qBool.default(false) });

router.get(
  "/public/events",
  read(async (req) => {
    const q = parseQuery(EventsQuery, req);
    const filter = { academy_id: req.academy._id, status: "published" };
    if (!q.include_past) {
      const t = today();
      filter.$or = [{ event_date: { $gte: t } }, { end_date: { $gte: t } }];
    }
    return toJSON(await Event.find(filter).sort({ event_date: 1 }));
  }),
);

router.get(
  "/public/events/:slug",
  read(async (req) => {
    const e = await Event.findOne({ academy_id: req.academy._id, slug: req.params.slug, status: "published" });
    if (!e) throw new NotFoundError("Event not found");
    const venue = e.venue_id ? await Venue.findById(e.venue_id) : null;
    return {
      ...toJSON(e),
      venue: venue ? { name: venue.name, address: venue.address ?? null, map_url: venue.map_url ?? null } : null,
    };
  }),
);

router.get(
  "/public/testimonials",
  read(async (req) => toJSON(await publishedTestimonials(req.academy._id))),
);

router.get(
  "/public/faqs",
  read(async (req) => toJSON(await publishedFaqs(req.academy._id))),
);

const EnquiryIn = z.object({
  name: z.string().min(2).max(200),
  mobile: opt(z.string().max(20)),
  email: opt(zEmailStr),
  message: z.string().min(5).max(3000),
});

router.post(
  "/public/enquiries",
  // Validate and rate-limit before the transaction starts, so a retried transaction never counts twice.
  (req, res, next) => {
    res.locals.body = parseBody(EnquiryIn, req);
    if (!authRateLimiter.allow(`enquiry:${clientIp(req)}`, 5, 3600)) {
      throw new BusinessRuleError("Too many messages. Please try again later.", 429);
    }
    next();
  },
  write(async (req, res) => {
    const body = res.locals.body;
    if (!body.mobile && !body.email) throw badRequest("Share a mobile number or email so we can reply");
    await Enquiry.create({
      academy_id: req.academy._id,
      name: body.name,
      mobile: body.mobile ?? null,
      email: body.email ?? null,
      message: body.message,
    });
    res.status(201);
    return { ok: true };
  }),
);

router.get(
  "/public/sitemap",
  read(async (req) => sitemapData(req.academy._id)),
);

export default router;
