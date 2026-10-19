/** Behaviour the parity review against the Python app found missing (regression tests). */
import request from "supertest";
import { expect, test } from "vitest";

import { createApp } from "../src/app.js";
import { isDate } from "../src/utils/dates.js";
import { createWorld, login } from "./world.js";

const app = createApp();
const API = "/api/v1";

test("only real calendar dates are accepted", async () => {
  for (const v of ["2026-02-28", "2028-02-29", "2026-12-31", "0001-01-01"]) expect(isDate(v), v).toBe(true);
  for (const v of ["2026-02-29", "2026-02-30", "2026-11-31", "2026-13-01", "2026-00-10", "0000-01-01", "2026-1-01"]) {
    expect(isDate(v), v).toBe(false);
  }
  await createWorld();
  const admin = await login(request.agent(app), "9000000001", "Admin@12345");
  const bad = await admin
    .post(`${API}/admin/expenses`)
    .send({ category: "equipment", description: "Balls", amount: 500, expense_date: "2026-02-30" });
  expect(bad.status).toBe(422);
  expect(bad.body.detail[0].loc).toEqual(["body", "expense_date"]);
  const ok = await admin
    .post(`${API}/admin/expenses`)
    .send({ category: "equipment", description: "Balls", amount: 500, expense_date: "2026-02-28" });
  expect(ok.status).toBe(201);
});

test("page and page_size are integers clamped like the Python paginate()", async () => {
  await createWorld();
  const admin = await login(request.agent(app), "9000000001", "Admin@12345");
  for (const d of ["2026-10-01", "2026-10-02"]) {
    await admin.post(`${API}/admin/expenses`).send({ category: "equipment", description: "Balls", amount: 100, expense_date: d });
  }
  const one = await admin.get(`${API}/admin/expenses?page_size=0`);
  expect(one.status).toBe(200);
  expect(one.body).toMatchObject({ page: 1, page_size: 1, total: 2 });
  expect(one.body.items).toHaveLength(1);
  expect((await admin.get(`${API}/admin/expenses?page=0&page_size=500`)).body).toMatchObject({ page: 1, page_size: 200 });
  const junk = await admin.get(`${API}/admin/audit?page=abc`);
  expect(junk.status).toBe(422);
  expect(junk.body.detail[0]).toMatchObject({ loc: ["query", "page"], type: "int_parsing" });
  expect((await admin.get(`${API}/admin/expenses?page_size=2.5`)).status).toBe(422);
});

test("pages send the spec's Referrer-Policy so video embeds work", async () => {
  await createWorld();
  const r = await request(app).get(`${API}/public/site`);
  expect(r.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
});

test("business-rule numbers reject blank values instead of saving 0", async () => {
  await createWorld();
  const admin = await login(request.agent(app), "9000000001", "Admin@12345");
  const rules = (await admin.get(`${API}/admin/settings`)).body;
  for (const patch of [{ drop_in_fee: "" }, { drop_in_fee: null }, { attendance_edit_window_days: null }]) {
    const r = await admin.put(`${API}/admin/settings`).send({ ...rules, ...patch });
    expect(r.status, JSON.stringify(patch)).toBe(422);
  }
  const blankCutoff = await admin.put(`${API}/admin/settings`).send({ ...rules, makeup: { ...rules.makeup, booking_cutoff_hours: "" } });
  expect(blankCutoff.status).toBe(422);
  const ok = await admin
    .put(`${API}/admin/settings`)
    .send({ ...rules, drop_in_fee: "650", makeup: { ...rules.makeup, expiry_days: null } });
  expect(ok.status).toBe(200);
  expect(ok.body.drop_in_fee).toBe(650);
  expect(ok.body.makeup.expiry_days).toBeNull();
});

test("the academy contact email keeps the case of its local part", async () => {
  await createWorld();
  const admin = await login(request.agent(app), "9000000001", "Admin@12345");
  const r = await admin.patch(`${API}/admin/academy`).send({ email: " Ravi.Kumar@Gmail.COM " });
  expect(r.status).toBe(200);
  expect(r.body.email).toBe("Ravi.Kumar@gmail.com");
  expect((await admin.patch(`${API}/admin/academy`).send({ email: "not-an-email" })).status).toBe(422);
});

test("a known path with an unsupported method is 405, an unknown path 404", async () => {
  await createWorld();
  const del = await request(app).delete(`${API}/public/site`);
  expect(del.status).toBe(405);
  expect(del.body).toEqual({ detail: "Method Not Allowed" });
  expect(del.headers.allow).toMatch(/GET/);
  expect((await request(app).get(`${API}/auth/login`)).status).toBe(405);
  expect((await request(app).post(`${API}/public/batches/0123456789abcdef01234567`)).status).toBe(405);
  expect((await request(app).get(`${API}/nonexistent`)).status).toBe(404);
  expect((await request(app).get(`${API}/public/site`)).status).toBe(200);
  const admin = await login(request.agent(app), "9000000001", "Admin@12345");
  expect((await admin.put(`${API}/admin/expenses`)).status).toBe(405);
  expect((await admin.get(`${API}/admin/expenses`)).status).toBe(200);
});

test("portal money fields reject null, blank and boolean values", async () => {
  const world = await createWorld();
  await world.student({ password: "Student@123" });
  const student = await login(request.agent(app), "9000000101", "Student@123");
  for (const amount of [true, null, "", [5]]) {
    const r = await student.post(`${API}/student/payments`).send({ amount, reference_no: "ABCD1234" });
    expect(r.status, JSON.stringify(amount)).toBe(422);
    expect(r.body.detail[0].loc).toEqual(["body", "amount"]);
  }
  expect((await student.post(`${API}/student/payments`).send({ amount: "1500", reference_no: "ABCD1234" })).status).toBe(201);
});
