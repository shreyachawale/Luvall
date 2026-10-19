import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { BatchCreateModal } from "@/components/admin/batch-forms";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Loading, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { qs, useApi } from "@/lib/api";
import { fmtDate, inr, scheduleSummary } from "@/lib/format";

export default function BatchesPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { data, error, mutate } = useApi<any[]>(`/admin/batches${qs({ q, status })}`);
  return (
    <>
      <PageHeader title="Batches" subtitle="Capacity, schedules, coaches, enrollment and session generation." actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> New batch</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={16} className="absolute left-3 top-2.5 text-muted" />
          <Input className="pl-9" placeholder="Name or code" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {["upcoming", "active", "completed", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.length === 0 ? <EmptyState title="No batches" /> : (
        <Card>
          <Table>
            <thead><tr><Th>Batch</Th><Th>Schedule</Th><Th>Coaches</Th><Th>Dates</Th><Th right>Seats</Th><Th right>Fee</Th><Th>Status</Th></tr></thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.id} className="hover:bg-stone-50/70">
                  <Td>
                    <Link to={`/admin/batches/${b.id}`} className="font-medium text-court-700 hover:underline">{b.name}</Link>
                    <span className="block text-xs text-muted">{b.code}{b.period_label && ` · ${b.period_label}`}{!b.is_public && " · hidden"}</span>
                  </Td>
                  <Td className="max-w-64 whitespace-normal text-xs">{scheduleSummary(b.schedules)}</Td>
                  <Td className="text-xs">{b.coaches.map((c: any) => c.name).join(", ") || "—"}</Td>
                  <Td className="text-xs">{fmtDate(b.start_date)} – {fmtDate(b.end_date)}</Td>
                  <Td right>{b.seats_taken}/{b.max_players}{b.pending_enrollments > 0 && <Badge tone="amber" className="ml-1">{b.pending_enrollments} pending</Badge>}</Td>
                  <Td right>{inr(b.display_price)}</Td>
                  <Td><StatusBadge status={b.display_status} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {creating && <BatchCreateModal onClose={() => setCreating(false)} onDone={(b) => { setCreating(false); mutate(); navigate(`/admin/batches/${b.id}`); }} />}
    </>
  );
}
