import { Card, CardHeader, EmptyState, ErrorNote, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate, scheduleSummary } from "@/lib/format";

export default function CoachBatches() {
  const { data, error } = useApi<any[]>("/coach/batches");
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <PageHeader title="My batches" subtitle="Batches you are assigned to and their current students." />
      {data.length === 0 ? <EmptyState title="No batches assigned" /> : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {data.map((b) => (
            <Card key={b.id}>
              <CardHeader title={b.name} subtitle={`${scheduleSummary(b.schedules)} · ${[...new Set(b.schedules.map((s: any) => s.venue_name))].join(", ")}`} action={<StatusBadge status={b.display_status} />} />
              <div className="px-5 py-3 text-sm text-muted">{b.seats_taken}/{b.max_players} players · {fmtDate(b.start_date)} – {fmtDate(b.end_date)}</div>
              {b.students.length ? (
                <ul className="divide-y divide-line border-t border-line">
                  {b.students.map((s: any) => (
                    <li key={s.id} className="flex justify-between px-5 py-2.5 text-sm">
                      <span className="font-medium">{s.name}</span>
                      <a href={`tel:${s.mobile}`} className="text-muted underline">{s.mobile}</a>
                    </li>
                  ))}
                </ul>
              ) : <p className="border-t border-line px-5 py-3 text-sm text-muted">No active students yet.</p>}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
