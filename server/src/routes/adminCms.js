/** Admin: website & marketing content (CMS), media library, homepage sections and business settings. */
import express from "express";
import multer from "multer";

import { config } from "../config.js";
import { withTransaction } from "../db.js";
import { adminOnly } from "../middleware/auth.js";
import {
  Announcement,
  Batch,
  Enquiry,
  Event,
  Faq,
  GalleryAlbum,
  MediaAsset,
  Post,
  Program,
  sid,
  Testimonial,
  toJSON,
} from "../models/index.js";
import { diff, snapshot } from "../services/audit.js";
import * as media from "../services/media.js";
import { BusinessRules, businessRules, SiteContent, siteContent } from "../services/rules.js";
import { BusinessRuleError } from "../utils/errors.js";
import { read, write } from "../utils/http.js";
import { opt, parseBody, parseQuery, ValidationError, z, zDate, zDateTime, zEmailStr, zId } from "../utils/validate.js";
import { applyUpdates, getOr404, log, pageOut, pageParams } from "./common.js";
import { bool, crudRouter, nul, num, pattern, sortedPage, str } from "./crud.js";

const router = express.Router();

const STATUS = /^(draft|published|archived)$/;

/** Videos are stored as external https links to the supported hosts only (FR-027). */
function checkVideo(data) {
  if (data.video_url) data.video_url = media.validateVideoUrl(data.video_url);
}

/** Media assets for the ids, in the order given (ids whose asset no longer exists are skipped). */
async function mediaInOrder(ids) {
  if (!ids?.length) return [];
  const found = await MediaAsset.find({ _id: { $in: ids } });
  const byId = new Map(found.map((m) => [sid(m), m]));
  return ids.map((id) => byId.get(sid(id))).filter(Boolean);
}

/** Validate media ids of this academy (404 "MediaAsset not found"), de-duplicated in their given order. */
async function mediaIds(ids, academyId) {
  const out = [];
  for (const id of [...new Set(ids.map(String))]) out.push((await getOr404(MediaAsset, id, academyId))._id);
  return out;
}

// --- Programs ------------------------------------------------------------------------------------------------

const ProgramIn = z.object({
  title: str({ min: 2, max: 200 }),
  slug: nul(str({ max: 200 })),
  summary: nul(str({ max: 500 })),
  description: nul(str({ max: 10000 })),
  skill_level: nul(str({ max: 30 })),
  age_group: nul(str({ max: 60 })),
  image_url: nul(str({ max: 500 })),
  display_order: num({ int: true }).default(0),
  status: pattern(STATUS).default("draft"),
});

const ProgramPatch = z.object({
  title: opt(str({ min: 2, max: 200 })),
  slug: opt(str({ max: 200 })),
  summary: opt(str({ max: 500 })),
  description: opt(str({ max: 10000 })),
  skill_level: opt(str({ max: 30 })),
  age_group: opt(str({ max: 60 })),
  image_url: opt(str({ max: 500 })),
  display_order: opt(num({ int: true })),
  status: opt(pattern(STATUS)),
});

// --- Posts / campaigns ---------------------------------------------------------------------------------------

const CATEGORY = /^(achievement|tournament|event|academy_update)$/;

const PostIn = z.object({
  title: str({ min: 2, max: 200 }),
  slug: nul(str({ max: 200 })),
  category: pattern(CATEGORY),
  summary: nul(str({ max: 500 })),
  body: nul(str({ max: 20000 })),
  cover_image_url: nul(str({ max: 500 })),
  video_url: nul(str({ max: 500 })),
  is_featured: bool().default(false),
  publish_from: nul(zDateTime),
  publish_to: nul(zDateTime),
  status: pattern(STATUS).default("draft"),
  image_ids: z.array(zId).default([]),
});

const PostPatch = z.object({
  title: opt(str({ min: 2, max: 200 })),
  slug: opt(str({ max: 200 })),
  category: opt(pattern(CATEGORY)),
  summary: opt(str({ max: 500 })),
  body: opt(str({ max: 20000 })),
  cover_image_url: opt(str({ max: 500 })),
  video_url: opt(str({ max: 500 })),
  is_featured: opt(bool()),
  publish_from: opt(zDateTime),
  publish_to: opt(zDateTime),
  status: opt(pattern(STATUS)),
  image_ids: opt(z.array(zId)),
});

function validatePost(data, doc) {
  checkVideo(data);
  const start = "publish_from" in data ? data.publish_from : doc ? doc.publish_from : null;
  const end = "publish_to" in data ? data.publish_to : doc ? doc.publish_to : null;
  if (start && end && end <= start) throw new BusinessRuleError("Expiry must be after the publication date", 400);
}

/** The post's ordered photo gallery (PostMedia); omitted or null image_ids leaves it unchanged. */
async function postMedia(post, extra) {
  if (extra.image_ids === undefined || extra.image_ids === null) return;
  post.image_ids = await mediaIds(extra.image_ids, post.academy_id);
}

async function postOut(p) {
  return { ...toJSON(p), images: (await mediaInOrder(p.image_ids)).map((m) => toJSON(m)) };
}

// --- Gallery albums ------------------------------------------------------------------------------------------

const AlbumIn = z.object({
  title: str({ min: 2, max: 200 }),
  slug: nul(str({ max: 200 })),
  description: nul(str({ max: 3000 })),
  cover_media_id: nul(zId),
  display_order: num({ int: true }).default(0),
  status: pattern(STATUS).default("draft"),
});

const AlbumPatch = z.object({
  title: opt(str({ min: 2, max: 200 })),
  slug: opt(str({ max: 200 })),
  description: opt(str({ max: 3000 })),
  cover_media_id: opt(zId),
  display_order: opt(num({ int: true })),
  status: opt(pattern(STATUS)),
});

/** An album with its ordered items and cover as media-asset JSON. */
async function albumOut(a) {
  const cover = a.cover_media_id ? await MediaAsset.findById(a.cover_media_id) : null;
  return {
    ...toJSON(a),
    items: (await mediaInOrder(a.media_ids)).map((m) => toJSON(m)),
    cover: cover ? toJSON(cover) : null,
  };
}

// --- Events, testimonials, FAQs, announcements ---------------------------------------------------------------

const EventIn = z.object({
  title: str({ min: 2, max: 200 }),
  slug: nul(str({ max: 200 })),
  description: nul(str({ max: 10000 })),
  event_date: zDate,
  end_date: nul(zDate),
  location_text: nul(str({ max: 300 })),
  venue_id: nul(zId),
  cover_image_url: nul(str({ max: 500 })),
  registration_url: nul(str({ max: 500 })),
  status: pattern(STATUS).default("draft"),
});

const EventPatch = z.object({
  title: opt(str({ min: 2, max: 200 })),
  slug: opt(str({ max: 200 })),
  description: opt(str({ max: 10000 })),
  event_date: opt(zDate),
  end_date: opt(zDate),
  location_text: opt(str({ max: 300 })),
  venue_id: opt(zId),
  cover_image_url: opt(str({ max: 500 })),
  registration_url: opt(str({ max: 500 })),
  status: opt(pattern(STATUS)),
});

const TestimonialIn = z.object({
  author_name: str({ min: 2, max: 200 }),
  author_title: nul(str({ max: 200 })),
  quote: str({ min: 5, max: 3000 }),
  rating: nul(num({ int: true, ge: 1, le: 5 })),
  photo_url: nul(str({ max: 500 })),
  display_order: num({ int: true }).default(0),
  status: pattern(STATUS).default("draft"),
});

const TestimonialPatch = z.object({
  author_name: opt(str({ min: 2, max: 200 })),
  author_title: opt(str({ max: 200 })),
  quote: opt(str({ min: 5, max: 3000 })),
  rating: opt(num({ int: true, ge: 1, le: 5 })),
  photo_url: opt(str({ max: 500 })),
  display_order: opt(num({ int: true })),
  status: opt(pattern(STATUS)),
});

const FaqIn = z.object({
  question: str({ min: 3, max: 300 }),
  answer: str({ min: 2, max: 5000 }),
  display_order: num({ int: true }).default(0),
  status: pattern(STATUS).default("published"),
});

const FaqPatch = z.object({
  question: opt(str({ min: 3, max: 300 })),
  answer: opt(str({ min: 2, max: 5000 })),
  display_order: opt(num({ int: true })),
  status: opt(pattern(STATUS)),
});

const AUDIENCE = /^(public|students|coaches|members)$/;

const AnnouncementIn = z.object({
  title: str({ min: 2, max: 200 }),
  message: str({ min: 2, max: 5000 }),
  audience: pattern(AUDIENCE).default("public"),
  link_url: nul(str({ max: 500 })),
  is_pinned: bool().default(false),
  publish_from: nul(zDateTime),
  publish_to: nul(zDateTime),
  status: pattern(STATUS).default("draft"),
});

const AnnouncementPatch = z.object({
  title: opt(str({ min: 2, max: 200 })),
  message: opt(str({ min: 2, max: 5000 })),
  audience: opt(pattern(AUDIENCE)),
  link_url: opt(str({ max: 500 })),
  is_pinned: opt(bool()),
  publish_from: opt(zDateTime),
  publish_to: opt(zDateTime),
  status: opt(pattern(STATUS)),
});

const EnquiryPatch = z.object({ status: pattern(/^(new|contacted|closed)$/) });

/** Batches keep running when their program is deleted (FK ON DELETE SET NULL). */
async function unlinkProgram(program) {
  await Batch.updateMany({ program_id: program._id }, { $set: { program_id: null } });
}

const cmsRouters = [
  crudRouter({
    path: "/admin/programs",
    Model: Program,
    createSchema: ProgramIn,
    updateSchema: ProgramPatch,
    entity: "program",
    sort: [["display_order", 1], ["title", 1], ["_id", 1]],
    searchFields: ["title"],
    filterFields: ["status"],
    slugSource: "title",
    onDelete: unlinkProgram,
  }),
  crudRouter({
    path: "/admin/posts",
    Model: Post,
    createSchema: PostIn,
    updateSchema: PostPatch,
    entity: "post",
    sort: [["created_at", -1], ["_id", -1]],
    searchFields: ["title"],
    filterFields: ["status", "category"],
    slugSource: "title",
    validate: validatePost,
    serialize: postOut,
    afterSave: postMedia,
    extraFields: ["image_ids"],
  }),
  crudRouter({
    path: "/admin/albums",
    Model: GalleryAlbum,
    createSchema: AlbumIn,
    updateSchema: AlbumPatch,
    entity: "gallery_album",
    sort: [["display_order", 1], ["_id", -1]],
    searchFields: ["title"],
    filterFields: ["status"],
    slugSource: "title",
    serialize: albumOut,
  }),
  crudRouter({
    path: "/admin/events",
    Model: Event,
    createSchema: EventIn,
    updateSchema: EventPatch,
    entity: "event",
    sort: [["event_date", -1], ["_id", -1]],
    searchFields: ["title"],
    filterFields: ["status"],
    slugSource: "title",
  }),
  crudRouter({
    path: "/admin/testimonials",
    Model: Testimonial,
    createSchema: TestimonialIn,
    updateSchema: TestimonialPatch,
    entity: "testimonial",
    sort: [["display_order", 1], ["_id", -1]],
    searchFields: ["author_name", "quote"],
    filterFields: ["status"],
  }),
  crudRouter({
    path: "/admin/faqs",
    Model: Faq,
    createSchema: FaqIn,
    updateSchema: FaqPatch,
    entity: "faq",
    sort: [["display_order", 1], ["_id", 1]],
    searchFields: ["question"],
    filterFields: ["status"],
  }),
  crudRouter({
    path: "/admin/announcements",
    Model: Announcement,
    createSchema: AnnouncementIn,
    updateSchema: AnnouncementPatch,
    entity: "announcement",
    sort: [["is_pinned", -1], ["created_at", -1], ["_id", -1]],
    searchFields: ["title"],
    filterFields: ["status", "audience"],
  }),
  crudRouter({
    path: "/admin/enquiries",
    Model: Enquiry,
    createSchema: z.object({}),
    updateSchema: EnquiryPatch,
    entity: "enquiry",
    // New enquiries first, then newest.
    sort: [[{ $ne: ["$status", "new"] }, 1], ["created_at", -1], ["_id", -1]],
    searchFields: ["name", "message"],
    filterFields: ["status"],
    allowCreate: false,
  }),
];

const AlbumItems = z.array(zId);

/** Replace an album's contents with the given media, in that order. */
router.put(
  "/admin/albums/:album_id/items",
  adminOnly,
  write(async (req) => {
    const ids = parseBody(AlbumItems, req);
    const album = await getOr404(GalleryAlbum, req.params.album_id, req.academy._id);
    album.media_ids = await mediaIds(ids, req.academy._id);
    await album.save();
    await log(req, "gallery_album", album._id, "set_items", `${ids.length} items in ${album.title}`);
    return albumOut(album);
  }),
);

// --- Media library -------------------------------------------------------------------------------------------

const MediaQuery = z.object({ media_type: opt(z.string()) });

router.get(
  "/admin/media",
  adminOnly,
  read(async (req) => {
    const { media_type: mediaType } = parseQuery(MediaQuery, req);
    const match = { academy_id: req.academy._id, status: "active" };
    if (mediaType) match.media_type = mediaType;
    const total = await MediaAsset.countDocuments(match);
    const { page, pageSize, skip } = pageParams(req.query, 48);
    const items = await sortedPage(MediaAsset, match, [["_id", -1]], skip, pageSize);
    return pageOut(items.map((m) => toJSON(m)), total, page, pageSize);
  }),
);

/** Append an asset to an album (upload "into" an album). */
async function addToAlbum(academyId, albumId, asset) {
  if (!albumId) return;
  const album = await getOr404(GalleryAlbum, albumId, academyId);
  album.media_ids.push(asset._id);
  await album.save();
}

// Browsers send file names as raw UTF-8 in the part header.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
  defParamCharset: "utf8",
});

const fileRequired = () => new ValidationError([{ path: ["file"], message: "Field required", code: "missing" }]);

/** Parse the multipart "file" field; oversize files get the same 413 message as media.storeImage. */
function singleFile(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      next(new BusinessRuleError(`Image is larger than ${config.maxUploadMb} MB`, 413));
      return;
    }
    if (err instanceof multer.MulterError && err.code === "LIMIT_UNEXPECTED_FILE") {
      next(fileRequired());
      return;
    }
    next(err);
  });
}

/** Form fields arrive as strings; an empty form value counts as not sent (FastAPI Form semantics). */
const formValue = (s) => z.preprocess((v) => (v === "" ? undefined : v), s);

const UploadForm = z.object({
  caption: formValue(opt(str())),
  alt_text: formValue(opt(str())),
  album_id: formValue(opt(zId)),
});

/**
 * Validate the form, then store the image before the database transaction starts (a transaction may be
 * retried, a file write must not be repeated).
 */
function storeUpload(Form) {
  return async (req, _res, next) => {
    req.form = Form ? parseBody(Form, req) : {};
    if (!req.file) throw fileRequired();
    req.stored = await media.storeImage(req.file.buffer, "cms");
    next();
  };
}

router.post(
  "/admin/media/upload",
  adminOnly,
  singleFile,
  storeUpload(UploadForm),
  write(async (req, res) => {
    const { stored, form } = req;
    const asset = await MediaAsset.create({
      academy_id: req.academy._id,
      media_type: "image",
      storage_url: stored.url,
      thumbnail_url: stored.thumbnail_url,
      caption: form.caption ?? null,
      alt_text: form.alt_text || form.caption || null,
      width: stored.width,
      height: stored.height,
      size_bytes: stored.size_bytes,
      uploaded_by_id: req.principal.user._id,
    });
    await addToAlbum(req.academy._id, form.album_id, asset);
    await log(req, "media_asset", asset._id, "upload", `Uploaded ${req.file.originalname}`);
    res.status(201);
    return toJSON(asset);
  }),
);

const VideoIn = z.object({
  url: str({ max: 500 }),
  caption: nul(str({ max: 300 })),
  thumbnail_url: nul(str({ max: 500 })),
  album_id: nul(zId),
});

router.post(
  "/admin/media/video",
  adminOnly,
  write(async (req, res) => {
    const body = parseBody(VideoIn, req);
    const url = media.validateVideoUrl(body.url);
    const asset = await MediaAsset.create({
      academy_id: req.academy._id,
      media_type: "video",
      storage_url: url,
      thumbnail_url: body.thumbnail_url,
      caption: body.caption,
      alt_text: body.caption,
      uploaded_by_id: req.principal.user._id,
    });
    await addToAlbum(req.academy._id, body.album_id, asset);
    await log(req, "media_asset", asset._id, "add_video", url);
    res.status(201);
    return toJSON(asset);
  }),
);

const MediaPatch = z.object({ caption: opt(str({ max: 300 })), alt_text: opt(str({ max: 300 })) });

router.patch(
  "/admin/media/:media_id",
  adminOnly,
  write(async (req) => {
    const data = parseBody(MediaPatch, req);
    const asset = await getOr404(MediaAsset, req.params.media_id, req.academy._id);
    const [old, neu] = applyUpdates(asset, data);
    await asset.save();
    await log(req, "media_asset", asset._id, "update", "Updated media", old, neu);
    return toJSON(asset);
  }),
);

/**
 * Delete an asset; it disappears from every post and album using it (FK ON DELETE CASCADE / SET NULL).
 * Stored files are removed only after the database change has committed.
 */
router.delete("/admin/media/:media_id", adminOnly, async (req, res) => {
  const files = await withTransaction(async () => {
    const asset = await getOr404(MediaAsset, req.params.media_id, req.academy._id);
    const old = snapshot(asset);
    await Post.updateMany({ image_ids: asset._id }, { $pull: { image_ids: asset._id } });
    await GalleryAlbum.updateMany({ media_ids: asset._id }, { $pull: { media_ids: asset._id } });
    await GalleryAlbum.updateMany({ cover_media_id: asset._id }, { $set: { cover_media_id: null } });
    await asset.deleteOne();
    await log(req, "media_asset", asset._id, "delete", "Deleted media", old);
    return asset.media_type === "image" ? [asset.storage_url, asset.thumbnail_url] : [];
  });
  for (const url of files) await media.deleteStored(url);
  res.status(204).end();
});

/** Upload an image for a profile/cover field; also added to the media library. */
router.post(
  "/admin/uploads/image",
  adminOnly,
  singleFile,
  storeUpload(null),
  write(async (req, res) => {
    const { stored } = req;
    const asset = await MediaAsset.create({
      academy_id: req.academy._id,
      media_type: "image",
      storage_url: stored.url,
      thumbnail_url: stored.thumbnail_url,
      width: stored.width,
      height: stored.height,
      size_bytes: stored.size_bytes,
      uploaded_by_id: req.principal.user._id,
      caption: req.file.originalname,
    });
    await log(req, "media_asset", asset._id, "upload", `Uploaded ${req.file.originalname}`);
    res.status(201);
    return { url: stored.url, thumbnail_url: stored.thumbnail_url, id: sid(asset) };
  }),
);

// --- Homepage content, business rules, academy profile --------------------------------------------------------

router.get(
  "/admin/site-content",
  adminOnly,
  read(async (req) => siteContent(req.academy)),
);

router.put(
  "/admin/site-content",
  adminOnly,
  write(async (req) => {
    const body = parseBody(SiteContent, req);
    const academy = req.academy;
    const old = academy.site_content || {};
    academy.site_content = body;
    academy.markModified("site_content");
    const [oldD, newD] = diff(old, body);
    await academy.save();
    await log(req, "site_content", academy._id, "update", "Updated homepage content", oldD, newD);
    return body;
  }),
);

router.get(
  "/admin/settings",
  adminOnly,
  read(async (req) => businessRules(req.academy)),
);

router.put(
  "/admin/settings",
  adminOnly,
  write(async (req) => {
    const body = parseBody(BusinessRules, req);
    if (body.default_min_players > body.default_max_players) {
      throw new BusinessRuleError("Default minimum players cannot exceed maximum", 400);
    }
    const academy = req.academy;
    const old = academy.settings || {};
    academy.settings = body;
    academy.markModified("settings");
    const [oldD, newD] = diff(old, body);
    await academy.save();
    await log(req, "settings", academy._id, "update", "Updated business rules", oldD, newD);
    return body;
  }),
);

const AcademyPatch = z.object({
  name: opt(str({ min: 2, max: 200 })),
  description: opt(str({ max: 3000 })),
  location: opt(str({ max: 300 })),
  owner_name: opt(str({ max: 200 })),
  contact_no: opt(str({ max: 20 })),
  email: opt(zEmailStr),
  logo_url: opt(str({ max: 500 })),
});

/** The academy profile without the settings / homepage blobs. */
function academyOut(academy) {
  const out = toJSON(academy);
  delete out.settings;
  delete out.site_content;
  return out;
}

router.get(
  "/admin/academy",
  adminOnly,
  read(async (req) => academyOut(req.academy)),
);

router.patch(
  "/admin/academy",
  adminOnly,
  write(async (req) => {
    const data = parseBody(AcademyPatch, req);
    const [old, neu] = applyUpdates(req.academy, data);
    await req.academy.save();
    await log(req, "academy", req.academy._id, "update", "Updated academy profile", old, neu);
    return academyOut(req.academy);
  }),
);

for (const r of cmsRouters) router.use(r);

export default router;
