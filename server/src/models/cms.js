import mongoose from "mongoose";

import { ObjectId, TIMESTAMPS, schema } from "./plugins.js";

export const CONTENT_STATUSES = ["draft", "published", "archived"];
export const POST_CATEGORIES = ["achievement", "tournament", "event", "academy_update"];
export const ANNOUNCEMENT_AUDIENCES = ["public", "students", "coaches", "members"];

function slugIndex(s) {
  s.index({ academy_id: 1, slug: 1 }, { unique: true });
  return s;
}

const academyRef = { type: ObjectId, ref: "Academy", required: true, index: true };
const status = (dflt) => ({ type: String, enum: CONTENT_STATUSES, default: dflt });

export const Program = mongoose.model(
  "Program",
  slugIndex(
    schema(
      {
        academy_id: academyRef,
        title: { type: String, required: true },
        slug: { type: String, required: true },
        summary: { type: String, default: null },
        description: { type: String, default: null },
        skill_level: { type: String, default: null },
        age_group: { type: String, default: null },
        image_url: { type: String, default: null },
        display_order: { type: Number, default: 0 },
        status: status("draft"),
      },
      { timestamps: TIMESTAMPS },
    ),
  ),
  "programs",
);

/** image = uploaded file; video = external URL (YouTube / Instagram reel / Vimeo), never stored here (FR-027). */
export const MediaAsset = mongoose.model(
  "MediaAsset",
  schema(
    {
      academy_id: academyRef,
      media_type: { type: String, enum: ["image", "video"], required: true },
      storage_url: { type: String, required: true },
      thumbnail_url: { type: String, default: null },
      caption: { type: String, default: null },
      alt_text: { type: String, default: null },
      width: { type: Number, default: null },
      height: { type: Number, default: null },
      size_bytes: { type: Number, default: null },
      uploaded_by_id: { type: ObjectId, ref: "User", default: null },
      status: { type: String, default: "active" },
    },
    { timestamps: TIMESTAMPS },
  ),
  "media_assets",
);

/** Marketing post / campaign: achievements, tournaments, events and academy updates. */
export const Post = mongoose.model(
  "Post",
  slugIndex(
    schema(
      {
        academy_id: academyRef,
        title: { type: String, required: true },
        slug: { type: String, required: true },
        category: { type: String, enum: POST_CATEGORIES, required: true, index: true },
        summary: { type: String, default: null },
        body: { type: String, default: null },
        cover_image_url: { type: String, default: null },
        video_url: { type: String, default: null },
        // Ordered photo gallery (PostMedia in the BRD model).
        image_ids: { type: [{ type: ObjectId, ref: "MediaAsset" }], default: [] },
        is_featured: { type: Boolean, default: false },
        publish_from: { type: Date, default: null },
        publish_to: { type: Date, default: null },
        status: status("draft"),
      },
      { timestamps: TIMESTAMPS },
    ),
  ),
  "posts",
);

export const GalleryAlbum = mongoose.model(
  "GalleryAlbum",
  slugIndex(
    schema(
      {
        academy_id: academyRef,
        title: { type: String, required: true },
        slug: { type: String, required: true },
        description: { type: String, default: null },
        cover_media_id: { type: ObjectId, ref: "MediaAsset", default: null },
        // Ordered album contents (GalleryAlbumMedia in the BRD model).
        media_ids: { type: [{ type: ObjectId, ref: "MediaAsset" }], default: [] },
        display_order: { type: Number, default: 0 },
        status: status("draft"),
      },
      { timestamps: TIMESTAMPS },
    ),
  ),
  "gallery_albums",
);

export const Event = mongoose.model(
  "Event",
  slugIndex(
    schema(
      {
        academy_id: academyRef,
        title: { type: String, required: true },
        slug: { type: String, required: true },
        description: { type: String, default: null },
        event_date: { type: String, required: true },
        end_date: { type: String, default: null },
        location_text: { type: String, default: null },
        venue_id: { type: ObjectId, ref: "Venue", default: null },
        cover_image_url: { type: String, default: null },
        registration_url: { type: String, default: null },
        status: status("draft"),
      },
      { timestamps: TIMESTAMPS },
    ),
  ),
  "events",
);

export const Testimonial = mongoose.model(
  "Testimonial",
  schema(
    {
      academy_id: academyRef,
      user_id: { type: ObjectId, ref: "User", default: null },
      author_name: { type: String, required: true },
      author_title: { type: String, default: null },
      quote: { type: String, required: true },
      rating: { type: Number, default: null },
      photo_url: { type: String, default: null },
      display_order: { type: Number, default: 0 },
      status: status("draft"),
    },
    { timestamps: TIMESTAMPS },
  ),
  "testimonials",
);

export const Faq = mongoose.model(
  "Faq",
  schema(
    {
      academy_id: academyRef,
      question: { type: String, required: true },
      answer: { type: String, required: true },
      display_order: { type: Number, default: 0 },
      status: status("published"),
    },
    { timestamps: TIMESTAMPS },
  ),
  "faqs",
);

export const Announcement = mongoose.model(
  "Announcement",
  schema(
    {
      academy_id: academyRef,
      title: { type: String, required: true },
      message: { type: String, required: true },
      // public = website + portals, students / coaches = that portal only, members = both portals
      audience: { type: String, enum: ANNOUNCEMENT_AUDIENCES, default: "public" },
      link_url: { type: String, default: null },
      is_pinned: { type: Boolean, default: false },
      publish_from: { type: Date, default: null },
      publish_to: { type: Date, default: null },
      status: status("draft"),
    },
    { timestamps: TIMESTAMPS },
  ),
  "announcements",
);

/** Contact-form enquiries from the public website. */
export const Enquiry = mongoose.model(
  "Enquiry",
  schema(
    {
      academy_id: academyRef,
      name: { type: String, required: true },
      mobile: { type: String, default: null },
      email: { type: String, default: null },
      message: { type: String, required: true },
      status: { type: String, enum: ["new", "contacted", "closed"], default: "new" },
    },
    { timestamps: TIMESTAMPS },
  ),
  "enquiries",
);
