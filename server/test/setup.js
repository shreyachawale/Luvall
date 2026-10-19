import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach } from "vitest";

process.env.NODE_ENV = "test";
process.env.MEDIA_ROOT ??= fs.mkdtempSync(path.join(os.tmpdir(), "luvall-media-"));

const { connect, disconnect, ensureIndexes } = await import("../src/db.js");
await import("../src/models/index.js");
const { freeze } = await import("../src/utils/clock.js");
const { authRateLimiter } = await import("../src/services/security.js");

/** A Thursday. Every test runs with this as the academy's "today". */
export const TODAY = "2026-10-15";

beforeAll(async () => {
  await connect(process.env.TEST_MONGODB_URI);
  await ensureIndexes();
});

beforeEach(async () => {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
  authRateLimiter.reset();
  freeze(TODAY);
});

afterAll(async () => {
  freeze(null);
  await disconnect();
});
