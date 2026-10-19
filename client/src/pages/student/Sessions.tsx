import { Badge, Card, EmptyState, ErrorNote, Loading, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDay, timeRange } from "@/lib/format";

export default function StudentSessions() {
  const { data, error } = useApi<any[]>("/student/sessions?days=60");
  return (
    <>
      <PageHeader title="My sessions" subtitle="Upcoming sessions for the next 60 days, including booked make-ups." />
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.length === 0 ? <EmptyState title="No upcoming sessions" /> : (
        <Card>
          <Table>
            <thead><tr><Th>Date</Th><Th>Time</Th><Th>Batch</Th><Th>Venue</Th><Th>Coach</Th><Th>Status</Th></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={`${s.kind}-${s.id}`}>
                  <Td className="font-medium">{fmtDay(s.session_date)}</Td>
                  <Td>{timeRange(s.start_time, s.end_time)}</Td>
                  <Td>{s.batch_name} {s.kind === "makeup" && <Badge tone="lime" className="ml-1">Make-up</Badge>}</Td>
                  <Td>{s.venue_map_url ? <a className="underline" href={s.venue_map_url} target="_blank" rel="noopener noreferrer">{s.venue_name}</a> : s.venue_name}</Td>
                  <Td>{s.coaches.map((c: any) => c.name).join(", ")}</Td>
                  <Td><StatusBadge status={s.status} label={s.status === "cancelled" ? `Cancelled${s.cancellation_reason ? `: ${s.cancellation_reason}` : ""}` : undefined} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
