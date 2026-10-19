import { Link } from "react-router";
import type { ComponentProps, ReactNode } from "react";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "ball" | "outline-light" | "light" | "glass" | "hard";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-court text-white hover:bg-court-700 shadow-sm",
  secondary: "bg-white text-ink border border-line hover:border-court-600/40 hover:bg-court-50",
  ghost: "text-court-700 hover:bg-court-50",
  danger: "bg-white text-red-700 border border-red-200 hover:bg-red-50",
  ball: "bg-ball text-court-950 hover:bg-ball-600 shadow-sm",
  "outline-light": "border border-white/40 text-white hover:bg-white/10",
  light: "bg-white text-ink shadow-sm hover:bg-ball-100",
  glass: "glass text-white hover:bg-white/25",
  hard: "bg-hard text-white hover:bg-hard-700 shadow-sm",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-7 text-base gap-2",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center rounded-full font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
    variants[variant],
    sizes[size],
    extra,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Card({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div className={cx("rounded-2xl border border-line bg-card shadow-[var(--shadow-card)]", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, action, subtitle }: { title: ReactNode; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0 flex-1 basis-56">
        <h3 className="text-base font-semibold">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const tones = {
  green: "bg-court-50 text-court-700 ring-court-600/20",
  lime: "bg-ball-100 text-court-900 ring-ball-600/30",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  blue: "bg-sky-50 text-sky-800 ring-sky-600/20",
  gray: "bg-stone-100 text-stone-700 ring-stone-500/20",
  purple: "bg-violet-50 text-violet-700 ring-violet-600/20",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "gray", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const statusTones: Record<string, Tone> = {
  active: "green",
  published: "green",
  verified: "green",
  completed: "blue",
  present: "green",
  available: "green",
  used: "blue",
  paid: "green",
  upcoming: "lime",
  scheduled: "lime",
  booked: "lime",
  pending: "amber",
  pending_approval: "amber",
  partial: "amber",
  draft: "gray",
  new: "amber",
  contacted: "blue",
  full: "red",
  absent: "red",
  rejected: "red",
  cancelled: "gray",
  session_cancelled: "gray",
  expired: "gray",
  left: "gray",
  archived: "gray",
  inactive: "gray",
  closed: "gray",
  nothing_due: "gray",
};

export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  if (!status) return <Badge>—</Badge>;
  const text = label ?? status.replace(/_/g, " ");
  return <Badge tone={statusTones[status] ?? "gray"}>{text.charAt(0).toUpperCase() + text.slice(1)}</Badge>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link to={back.href} className="mb-1 inline-block text-sm text-muted hover:text-court-700">
            ← {back.label}
          </Link>
        )}
        <h1 className="font-display text-3xl uppercase leading-none sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "good" | "bad" | "warn";
}) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div
        className={cx(
          "num mt-2 font-display text-3xl leading-none",
          tone === "good" && "text-court-700",
          tone === "bad" && "text-red-700",
          tone === "warn" && "text-amber-700",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-ball shadow-sm" aria-hidden>
        <span className="grid grid-cols-3 gap-0.5">
          {Array.from({ length: 9 }).map((_, i) => (
            <span key={i} className="h-1 w-1 rounded-full bg-court-950/30" />
          ))}
        </span>
      </div>
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx("inline-block h-5 w-5 animate-spin rounded-full border-2 border-court-600 border-t-transparent", className)}
      role="status"
      aria-label="Loading"
    />
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-sm text-muted">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{message}</div>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "success"; children: ReactNode }) {
  const t = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    success: "border-court-100 bg-court-50 text-court-900",
  }[tone];
  return <div className={cx("rounded-xl border px-4 py-3 text-sm", t)}>{children}</div>;
}

export const inputClass =
  "w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-stone-400 focus:border-court-600 focus:outline-none focus:ring-2 focus:ring-court-600/15 disabled:bg-stone-50";

export function Field({
  label,
  hint,
  error,
  children,
  className,
  required,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-sm font-medium text-ink">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-700">{error}</span>}
    </label>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cx(inputClass, "pr-8", props.className)} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea rows={4} {...props} className={cx(inputClass, props.className)} />;
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full min-w-max text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className, right }: { children?: ReactNode; className?: string; right?: boolean }) {
  return (
    <th
      className={cx(
        "border-b border-line bg-paper/70 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted",
        right && "text-right",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  right,
  ...props
}: ComponentProps<"td"> & { right?: boolean }) {
  return (
    <td className={cx("border-b border-line/70 px-4 py-2.5 align-middle", right && "num text-right", className)} {...props}>
      {children}
    </td>
  );
}
