import fs from "node:fs";

import cookieParser from "cookie-parser";
import express from "express";
import mongoose from "mongoose";

import { config } from "./config.js";
import { withAcademy } from "./middleware/auth.js";
import { errorHandler, methodNotAllowed, notFoundApi } from "./middleware/errors.js";
import { originCheck, requestLogger, securityHeaders } from "./middleware/security.js";
import adminCms from "./routes/adminCms.js";
import adminFinance from "./routes/adminFinance.js";
import adminOps from "./routes/adminOps.js";
import adminPeople from "./routes/adminPeople.js";
import adminReports from "./routes/adminReports.js";
import auth from "./routes/auth.js";
import coach from "./routes/coach.js";
import publicRoutes from "./routes/public.js";
import student from "./routes/student.js";
import { mountClient } from "./seo.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(requestLogger);
  app.use(securityHeaders);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(originCheck);

  app.get("/api/health", async (_req, res) => {
    await mongoose.connection.db.admin().ping();
    res.json({ status: "ok" });
  });

  fs.mkdirSync(config.mediaRoot, { recursive: true });
  app.use(config.mediaUrlPrefix, express.static(config.mediaRoot, { maxAge: "30d", immutable: true, fallthrough: false }));

  const api = express.Router();
  api.use(withAcademy);
  for (const router of [auth, publicRoutes, student, coach, adminPeople, adminOps, adminFinance, adminReports, adminCms]) {
    api.use(router);
  }
  api.use(methodNotAllowed(api));
  app.use("/api/v1", api);
  app.use("/api", notFoundApi);

  // Built React app + SEO meta tags, sitemap.xml and robots.txt (production).
  mountClient(app);

  app.use(errorHandler);
  return app;
}
