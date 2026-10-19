import { SessionList } from "@/components/portal/session-list";
import { Card, CardHeader, ErrorNote, Loading, Notice, PageHeader, Stat } from "@/components/ui";
import { useApi } from "@/lib/api";
import { inr, num } from "@/lib/format";

export default function CoachDashboard() {
  const { data, error } = useApi<any>("/coach/dashboard");
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <PageHeader title="Today" subtitle="Open a session to mark attendance and record your hours." />
      {data.needs_attendance.length > 0 && (
        <div className="mb-4"><Notice tone="warn">{data.needs_attendance.length} past session(s) still need attendance.</Notice></div>
      )}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Sessions today" value={data.today.length} />
        <Stat label={`Sessions in ${data.month.label}`} value={data.month.sessions} />
        <Stat label="Hours this month" value={num(data.month.hours)} />
        <Stat label="Earnings this month" value={inr(data.month.payable)} hint="Hours × your rate" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card><CardHeader title="Today's sessions" /><SessionList sessions={data.today} hrefBase="/coach/sessions" empty="No sessions today." /></Card>
          {data.needs_attendance.length > 0 && (
            <Card><CardHeader title="Needs attendance" /><SessionList sessions={data.needs_attendance} hrefBase="/coach/sessions" /></Card>
          )}
        </div>
        <div className="space-y-6">
          <Card><CardHeader title="Next 7 days" /><SessionList sessions={data.upcoming} hrefBase="/coach/sessions" empty="Nothing scheduled this week." /></Card>
          <Card>
            <CardHeader title="Announcements" />
            {data.announcements.length ? (
              <ul className="divide-y divide-line">{data.announcements.map((a: any) => <li key={a.id} className="px-5 py-3 text-sm"><p className="font-semibold">{a.title}</p><p className="text-muted">{a.message}</p></li>)}</ul>
            ) : <p className="px-5 py-4 text-sm text-muted">No announcements.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
