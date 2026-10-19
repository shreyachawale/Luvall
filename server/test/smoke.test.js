import request from "supertest";
import { expect, test } from "vitest";

import { createApp } from "../src/app.js";
import { withTransaction } from "../src/db.js";
import { Academy } from "../src/models/index.js";
import { z, zBool } from "../src/utils/validate.js";

test("health and academy guard", async () => {
  const app = createApp();
  expect((await request(app).get("/api/health")).status).toBe(200);
  expect((await request(app).get("/api/v1/public/site")).status).toBe(503);
  await withTransaction(() => Academy.create({ code: "LUVALL", name: "LuvAll Sports" }));
  expect((await request(app).get("/api/v1/nope")).status).toBe(404);
});

test("logout works before the academy exists", async () => {
  const res = await request(createApp()).post("/api/v1/auth/logout");
  expect(res.status).toBe(204);
  expect(String(res.headers["set-cookie"])).toMatch(/luvall|Expires=Thu, 01 Jan 1970/i);
});

test("client errors from Express and body parsing are 4xx, not 500", async () => {
  const app = createApp();
  await withTransaction(() => Academy.create({ code: "LUVALL", name: "LuvAll Sports" }));
  const bad = await request(app).get("/api/v1/public/programs/%E0%A4%A");
  expect(bad.status).toBe(400);
  expect(bad.body.detail).toEqual(expect.any(String));
  const json = await request(app)
    .post("/api/v1/public/enquiries")
    .set("Content-Type", "application/json")
    .send('{"name": ');
  expect(json.status).toBe(400);
  expect(json.body).toEqual({ detail: "Malformed JSON body" });
});

test("zBool accepts Pydantic's spellings and rejects anything else", () => {
  const s = z.object({ flag: zBool.default(false) });
  for (const v of ["true", "1", "yes", "on", "T", " y ", true]) expect(s.parse({ flag: v }).flag).toBe(true);
  for (const v of ["false", "0", "no", "off", "F", "n", false]) expect(s.parse({ flag: v }).flag).toBe(false);
  expect(s.parse({}).flag).toBe(false);
  for (const v of ["maybe", "", "2"]) expect(s.safeParse({ flag: v }).success).toBe(false);
});
