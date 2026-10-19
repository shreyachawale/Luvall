import useSWR, { type SWRConfiguration } from "swr";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function detailMessage(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    // FastAPI validation errors
    return detail
      .map((d: { loc?: (string | number)[]; msg?: string }) => {
        const field = d.loc?.filter((x) => x !== "body").join(" → ");
        return field ? `${field}: ${d.msg}` : d.msg;
      })
      .join("; ");
  }
  return "Request failed";
}

export async function api<T = any>(
  path: string,
  options: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const { method = options.body || options.form ? "POST" : "GET", body, form } = options;
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: form ? undefined : body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    if (res.status === 401 && typeof document !== "undefined") {
      document.cookie = `${SIGNED_IN_HINT_COOKIE}=; Max-Age=0; path=/`;
    }
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    throw new ApiError(res.status, detailMessage(data?.detail));
  }
  return data as T;
}

const fetcher = (path: string) => api(path);

/** Set by the server next to the httpOnly session cookie (and cleared on sign-out); holds no credentials. */
const SIGNED_IN_HINT_COOKIE = "luvall_signed_in";

/** Whether a session may exist, so pages open to visitors can skip the /auth/me request for them. */
export function maybeSignedIn(): boolean {
  return typeof document !== "undefined" && document.cookie.split("; ").some((c) => c.startsWith(`${SIGNED_IN_HINT_COOKIE}=`));
}

/** SWR hook for GET endpoints under /api/v1. Pass null to skip. */
export function useApi<T = any>(path: string | null, config?: SWRConfiguration) {
  return useSWR<T>(path, fetcher, { revalidateOnFocus: false, ...config });
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function uploadImage(file: File, endpoint = "/admin/uploads/image"): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", file);
  return api(endpoint, { form });
}
