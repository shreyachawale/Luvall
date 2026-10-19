/**
 * Image upload, validation and thumbnailing behind a small storage abstraction.
 *
 * Files go to local disk now; swap `LocalStorage` for an S3/R2/Azure Blob implementation later without touching
 * callers (BRD section 13 "Media"). Videos and reels are stored as external URLs only (FR-027).
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { config } from "../config.js";
import { BusinessRuleError } from "../utils/errors.js";

export const MAX_DIMENSION = 1920;
export const THUMB_DIMENSION = 480;
export const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "gif"]);

/** Storage interface: save(key, data) -> public URL, delete(key). */
export class LocalStorage {
  constructor(root, urlPrefix) {
    this.root = root;
    this.urlPrefix = urlPrefix.replace(/\/+$/, "");
  }

  async save(key, data) {
    const file = path.join(this.root, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
    return `${this.urlPrefix}/${key}`;
  }

  async delete(key) {
    await fs.rm(path.join(this.root, key), { force: true });
  }
}

export function getStorage() {
  return new LocalStorage(config.mediaRoot, config.mediaUrlPrefix);
}

function notAnImage() {
  return new BusinessRuleError("The file is not a supported image", 400);
}

/** Auto-rotate from EXIF, fit inside `size` px (never enlarge) and encode as WebP. */
async function encode(data, size) {
  return sharp(data, { animated: false })
    .rotate()
    .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer({ resolveWithObject: true });
}

/**
 * Validate an uploaded image (by content, not extension), store a <=1920px WebP and a 480px thumbnail.
 * Returns { url, thumbnail_url, width, height, size_bytes }.
 */
export async function storeImage(data, folder = "uploads") {
  if (data.length > config.maxUploadMb * 1024 * 1024) {
    throw new BusinessRuleError(`Image is larger than ${config.maxUploadMb} MB`, 413);
  }
  let meta;
  try {
    meta = await sharp(data).metadata();
  } catch {
    throw notAnImage();
  }
  if (!ALLOWED_FORMATS.has(meta.format)) throw new BusinessRuleError("Upload a JPEG, PNG, WebP or GIF image", 400);

  let full;
  let thumb;
  try {
    full = await encode(data, MAX_DIMENSION);
    thumb = await encode(data, THUMB_DIMENSION);
  } catch {
    throw notAnImage();
  }

  const key = `${folder}/${crypto.randomUUID().replaceAll("-", "")}`;
  const storage = getStorage();
  const url = await storage.save(`${key}.webp`, full.data);
  const thumbnailUrl = await storage.save(`${key}_thumb.webp`, thumb.data);
  return { url, thumbnail_url: thumbnailUrl, width: full.info.width, height: full.info.height, size_bytes: full.data.length };
}

/** Delete a file previously stored by storeImage (ignores external URLs). */
export async function deleteStored(url) {
  const prefix = `${config.mediaUrlPrefix.replace(/\/+$/, "")}/`;
  if (url && url.startsWith(prefix)) {
    const key = url.slice(prefix.length);
    if (!key.includes("..")) await getStorage().delete(key);
  }
}

export const VIDEO_HOSTS = ["youtube.com", "youtu.be", "instagram.com", "vimeo.com", "facebook.com", "fb.watch"];

/** Only https links to the supported video hosts (or their subdomains) are accepted. */
export function validateVideoUrl(url) {
  const value = String(url ?? "").trim();
  let parsed = null;
  try {
    parsed = /^https:\/\//i.test(value) ? new URL(value) : null;
  } catch {
    parsed = null;
  }
  const host = (parsed?.hostname ?? "").toLowerCase();
  if (!parsed || parsed.protocol !== "https:" || !VIDEO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new BusinessRuleError("Use an https YouTube, Instagram, Vimeo or Facebook video link", 400);
  }
  return value;
}

export function slugify(text) {
  const slug = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 180) || crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}
