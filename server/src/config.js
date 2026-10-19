import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function list(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* comma separated */
  }
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

const env = process.env;

export const config = {
  environment: env.NODE_ENV ?? "development",
  port: Number(env.PORT ?? 4000),
  mongoUri: env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/luvall?replicaSet=rs0",
  // Secrets must come from the environment in production (FR-029).
  jwtSecret: env.JWT_SECRET ?? "dev-only-change-me",
  accessTokenMinutes: Number(env.ACCESS_TOKEN_MINUTES ?? 60 * 24 * 7),
  cookieName: env.COOKIE_NAME ?? "luvall_session",
  cookieSecure: env.COOKIE_SECURE === "true",
  // Origins allowed to make state-changing cookie-authenticated requests.
  allowedOrigins: list(env.ALLOWED_ORIGINS, ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4000"]),
  defaultAcademyCode: env.DEFAULT_ACADEMY_CODE ?? "LUVALL",
  timezone: env.TZ_ACADEMY ?? "Asia/Kolkata",
  mediaRoot: env.MEDIA_ROOT ?? path.resolve(here, "..", "media"),
  mediaUrlPrefix: "/media",
  maxUploadMb: Number(env.MAX_UPLOAD_MB ?? 10),
  loginRateLimit: Number(env.LOGIN_RATE_LIMIT ?? 10),
  loginRateWindowSeconds: Number(env.LOGIN_RATE_WINDOW_SECONDS ?? 300),
  // Built React app served by Express in production.
  clientDist: env.CLIENT_DIST ?? path.resolve(here, "..", "..", "client", "dist"),
  siteUrl: env.SITE_URL ?? "http://localhost:4000",
  get isProduction() {
    return this.environment === "production";
  },
};

export function assertProductionConfig() {
  if (config.isProduction && config.jwtSecret === "dev-only-change-me") {
    throw new Error("JWT_SECRET must be set in production");
  }
}
