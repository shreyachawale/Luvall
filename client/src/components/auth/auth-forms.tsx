import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { mutate } from "swr";

import { Img } from "@/components/public/cards";
import { Button, ErrorNote, Field, Input, Select } from "@/components/ui";
import { api, useApi } from "@/lib/api";

/**
 * Sign-in / sign-up layout: a court photo panel with a condensed headline beside the form panel
 * (a short banner above the form on phones).
 */
export function AuthShell({
  title,
  intro,
  panelTitle,
  panelText,
  children,
}: {
  title: string;
  intro: string;
  panelTitle: string;
  panelText: string;
  children: ReactNode;
}) {
  const { data: site } = useApi<{ content: { hero_image_url?: string } }>("/public/site");
  return (
    <div className="container-page py-4 sm:py-8">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-5">
        <div className="relative isolate flex min-h-52 flex-col justify-end overflow-hidden rounded-[2rem] bg-court-950 p-6 text-white sm:min-h-64 lg:min-h-[38rem] lg:p-10">
          <Img src={site?.content?.hero_image_url} alt="" className="absolute inset-0 -z-10 h-full w-full" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-court-950/95 via-court-950/45 to-court-950/10" />
          <h2 className="mega max-w-[12ch] text-[clamp(2.5rem,5.6vw,5.2rem)]">{panelTitle}</h2>
          <p className="mt-3 max-w-md text-white/80 lg:mt-5 lg:text-lg">{panelText}</p>
        </div>
        <div className="flex items-center">
          <div className="w-full rounded-[2rem] bg-white p-6 shadow-[var(--shadow-card)] sm:p-10">
            <h1 className="font-display text-4xl uppercase leading-none text-court-950">{title}</h1>
            <p className="mb-7 mt-2 text-muted">{intro}</p>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function homeFor(roles: string[]): string {
  if (roles.includes("admin")) return "/admin";
  if (roles.includes("coach")) return "/coach";
  return "/student";
}

function safeNext(next: string | undefined): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

export function LoginForm({ next }: { next?: string }) {
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        try {
          const me = await api<{ roles: string[] }>("/auth/login", {
            body: { identifier: f.get("identifier"), password: f.get("password") },
          });
          // The login response is the /auth/me payload: seed the cache so headers and portal shells see the new session.
          await mutate("/auth/me", me);
          navigate(safeNext(next) ?? homeFor(me.roles), { replace: true });
        } catch (err) {
          setError(err);
          setBusy(false);
        }
      }}
    >
      <Field label="Mobile number or email" required>
        <Input name="identifier" required autoComplete="username" placeholder="98xxxxxxxx" />
      </Field>
      <Field label="Password" required>
        <Input name="password" type="password" required autoComplete="current-password" />
      </Field>
      <ErrorNote error={error} />
      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted">
        New here?{" "}
        <Link to={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-court-700 underline">
          Create a student account
        </Link>
      </p>
      <p className="text-center text-xs text-muted">Forgot your password? Ask the academy admin to reset it.</p>
    </form>
  );
}

export function RegisterForm({ next }: { next?: string }) {
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (f.get("password") !== f.get("confirm")) {
          setError(new Error("Passwords do not match"));
          return;
        }
        setBusy(true);
        setError(null);
        try {
          const me = await api("/auth/register", {
            body: {
              name: f.get("name"),
              mobile: f.get("mobile"),
              email: f.get("email") || null,
              password: f.get("password"),
              skill_level: f.get("skill_level") || null,
              dob: f.get("dob") || null,
              guardian_name: f.get("guardian_name") || null,
            },
          });
          await mutate("/auth/me", me);
          navigate(safeNext(next) ?? "/student", { replace: true });
        } catch (err) {
          setError(err);
          setBusy(false);
        }
      }}
    >
      <Field label="Full name" required>
        <Input name="name" required minLength={2} autoComplete="name" />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Mobile number" required hint="Used to sign in">
          <Input name="mobile" type="tel" inputMode="tel" required autoComplete="tel" />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Playing level">
          <Select name="skill_level" defaultValue="beginner">
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </Select>
        </Field>
        <Field label="Date of birth">
          <Input name="dob" type="date" />
        </Field>
      </div>
      <Field label="Parent / guardian name" hint="For players under 18">
        <Input name="guardian_name" />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Password" required hint="At least 8 characters">
          <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
        </Field>
        <Field label="Confirm password" required>
          <Input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
        </Field>
      </div>
      <ErrorNote error={error} />
      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted">
        Already registered?{" "}
        <Link to={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-court-700 underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
