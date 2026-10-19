import { Bell, CalendarDays, Clock, MapPin } from "lucide-react";
import { Link } from "react-router";

import { Badge, Card, CardHeader, EmptyState, ErrorNote, LinkButton, Loading, Notice, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDay, inr, scheduleSummary, timeRange } from "@/lib/format";

export default function StudentDashboard() {
  const { data, error } = useApi<any>("/student/dashboard");
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const next = data.next_session;
  const remaining = data.plans.filter((p: any) => p.status === "active").reduce((s: number, p: any) => s + p.usage.remaining, 0);
  const pendingBatches = data.batches.filter((b: any) => b.status === "pending");
  return (
    <>
      <PageHeader title={`Hi, ${data.student.name.split(" ")[0]}`} subtitle="Here's what's coming up on court." actions={<LinkButton to="/batches" variant="secondary">Join another batch</LinkButton>} />
      {data.reminder && <div className="mb-4"><Notice tone="success"><Bell size={14} className="mr-1 inline" />{data.reminder}</Notice></div>}
      {pendingBatches.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn">
            {pendingBatches.length === 1 ? "Your enrollment in " : "Your enrollments in "}
            <strong>{pendingBatches.map((b: any) => b.batch.name).join(", ")}</strong> {pendingBatches.length === 1 ? "is" : "are"} awaiting confirmation.
            {data.pending_payments > 0 ? " We're verifying your payment." : " Submit your UPI payment reference from Package & payments."}
          </Notice>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <div className="court-lines bg-court p-6 text-white">
            <p className="text-sm font-semibold uppercase tracking-wide text-ball">Next session</p>
            {next ? (
              <>
                <h2 className="mt-2 text-2xl font-bold">{next.batch_name}</h2>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/85">
                  <span className="flex items-center gap-1.5"><CalendarDays size={16} />{fmtDay(next.session_date)}</span>
                  <span className="flex items-center gap-1.5"><Clock size={16} />{timeRange(next.start_time, next.end_time)}</span>
                  <span className="flex items-center gap-1.5"><MapPin size={16} />{next.venue_name}</span>
                </div>
                <p className="mt-2 text-sm text-white/70">Coach: {next.coaches.map((c: any) => c.name).join(" & ") || "TBA"}</p>
                {next.kind === "makeup" && <Badge tone="lime" className="mt-3">Make-up session</Badge>}
                {next.venue_map_url && <a href={next.venue_map_url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-sm font-semibold text-ball underline">Directions</a>}
              </>
            ) : (
              <p className="mt-2 text-white/80">No sessions scheduled. <Link to="/batches" className="font-semibold text-ball underline">Find a batch</Link></p>
            )}
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Sessions remaining" value={remaining} hint="Across active packages" />
          <Stat label={data.balance < 0 ? "Amount due" : "Account credit"} value={inr(Math.abs(data.balance))} tone={data.balance < 0 ? "bad" : "good"} hint={<Link to="/student/payments" className="underline">View ledger</Link>} />
          <Stat label="Make-ups available" value={data.makeups.available ?? 0} hint={<Link to="/student/makeups" className="underline">Book a make-up</Link>} />
          <Stat label="Attended" value={data.attendance.present + data.attendance.makeups_attended} hint={`${data.attendance.absent} missed · ${data.attendance.cancelled} cancelled`} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming sessions" action={<Link to="/student/sessions" className="text-sm font-semibold text-court-700">All</Link>} />
          {data.upcoming_sessions.length ? (
            <ul className="divide-y divide-line">
              {data.upcoming_sessions.slice(0, 6).map((s: any) => (
                <li key={`${s.kind}-${s.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium">{fmtDay(s.session_date)} · {timeRange(s.start_time, s.end_time)}</p>
                    <p className="text-muted">{s.batch_name} · {s.venue_name}</p>
                  </div>
                  {s.status === "cancelled" ? <StatusBadge status="cancelled" /> : s.kind === "makeup" ? <Badge tone="lime">Make-up</Badge> : null}
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-5"><EmptyState title="Nothing scheduled">Join a batch to see your sessions here.</EmptyState></div>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="My batches" />
            {data.batches.length ? (
              <ul className="divide-y divide-line">
                {data.batches.map((e: any) => (
                  <li key={e.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{e.batch.name}</p>
                      <StatusBadge status={e.status} />
                    </div>
                    <p className="text-muted">{scheduleSummary(e.batch.schedules)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-5"><EmptyState title="No batches yet" action={<LinkButton to="/batches">Browse batches</LinkButton>} /></div>
            )}
          </Card>
          <Card>
            <CardHeader title="Announcements" />
            {data.announcements.length ? (
              <ul className="divide-y divide-line">
                {data.announcements.map((a: any) => (
                  <li key={a.id} className="px-5 py-3 text-sm">
                    <p className="font-semibold">{a.title}</p>
                    <p className="text-muted">{a.message}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-muted">No announcements right now.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
