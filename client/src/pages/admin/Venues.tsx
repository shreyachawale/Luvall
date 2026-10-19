import { Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { VENUE_FIELDS } from "@/components/admin/fields";
import { SimpleForm } from "@/components/admin/forms";
import { Badge, Button, Card, EmptyState, ErrorNote, Loading, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { useApi } from "@/lib/api";
import { inr } from "@/lib/format";

export default function VenuesPage() {
  const { data, error, mutate } = useApi<any[]>("/admin/venues");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const rate = (v: any) => (v == null ? <Badge tone="red">Not set</Badge> : inr(v));
  return (
    <>
      <PageHeader title="Venues & court rates" subtitle="Court payable = duration (hours) × courts used × the venue rate for the day type and time slot." actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> Add venue</Button>} />
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.length === 0 ? <EmptyState title="No venues yet" /> : (
        <Card>
          <Table>
            <thead><tr><Th>Venue</Th><Th right>Courts</Th><Th right>Weekday AM</Th><Th right>Weekday PM</Th><Th right>Weekend AM</Th><Th right>Weekend PM</Th><Th>Status</Th></tr></thead>
            <tbody>
              {data.map((v) => (
                <tr key={v.id} className="hover:bg-stone-50/70">
                  <Td><Link to={`/admin/venues/${v.id}`} className="font-medium text-court-700 hover:underline">{v.name}</Link><span className="block text-xs text-muted">{v.code} · {v.city}</span></Td>
                  <Td right>{v.courts_available}</Td>
                  <Td right>{rate(v.current_rates.weekday_morning)}</Td>
                  <Td right>{rate(v.current_rates.weekday_evening)}</Td>
                  <Td right>{rate(v.current_rates.weekend_morning)}</Td>
                  <Td right>{rate(v.current_rates.weekend_evening)}</Td>
                  <Td><StatusBadge status={v.status} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {creating && <SimpleForm title="Add venue" wide fields={VENUE_FIELDS} endpoint="/admin/venues" onClose={() => setCreating(false)} onDone={(v) => { setCreating(false); mutate(); navigate(`/admin/venues/${v.id}`); }} />}
    </>
  );
}
