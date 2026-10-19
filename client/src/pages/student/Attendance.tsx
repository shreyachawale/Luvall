import { Badge, Card, EmptyState, ErrorNote, Loading, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDay, timeRange, titleCase } from "@/lib/format";

const BILLING: Record<string, string> = {
  package: "Counted from package",
  makeup: "Make-up credit",
  drop_in: "Drop-in fee",
  complimentary: "Complimentary",
  carried_forward: "Carried forward",
  refunded: "Refunded",
  none: "—",
};

export default function StudentAttendance() {
  const { data, error } = useApi<any[]>("/student/attendance");
  return (
    <>
      <PageHeader title="Attendance history" subtitle="Every session you were expected at, including make-ups and cancelled sessions." />
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.length === 0 ? <EmptyState title="No attendance recorded yet" /> : (
        <Card>
          <Table>
            <thead><tr><Th>Date</Th><Th>Batch attended</Th><Th>Status</Th><Th>Type</Th><Th>Package effect</Th></tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <Td className="font-medium">{fmtDay(a.session.session_date)} <span className="text-muted">{timeRange(a.session.start_time, a.session.end_time)}</span></Td>
                  <Td>{a.session.batch_name}{a.is_makeup && a.original_batch_name && <span className="block text-xs text-muted">Make-up for {a.original_batch_name}</span>}</Td>
                  <Td><StatusBadge status={a.attendance_status} label={a.attendance_status === "session_cancelled" ? "Session cancelled" : undefined} /></Td>
                  <Td>{a.is_makeup ? <Badge tone="lime">Make-up</Badge> : titleCase(a.attendee_type)}</Td>
                  <Td className="text-muted">{BILLING[a.billing_mode] ?? a.billing_mode}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
