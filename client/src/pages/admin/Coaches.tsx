import { Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { COACH_FIELDS } from "@/components/admin/fields";
import { SimpleForm } from "@/components/admin/forms";
import { Badge, Button, Card, EmptyState, ErrorNote, Loading, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { useApi } from "@/lib/api";
import { inr, num, todayISO } from "@/lib/format";

export default function CoachesPage() {
  const [all, setAll] = useState(false);
  const { data, error, mutate } = useApi<any[]>(`/admin/coaches?include_inactive=${all}`);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Coaches" subtitle="Profiles, hourly rates, assignments, hours and monthly payments." actions={
        <>
          <Button variant="secondary" onClick={() => setAll(!all)}>{all ? "Hide inactive" : "Show inactive"}</Button>
          <Button onClick={() => setCreating(true)}><Plus size={16} /> Add coach</Button>
        </>
      } />
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.length === 0 ? <EmptyState title="No coaches yet" /> : (
        <Card>
          <Table>
            <thead><tr><Th>Coach</Th><Th>Mobile</Th><Th right>Current rate</Th><Th right>Active batches</Th><Th right>Hours this month</Th><Th right>Payable this month</Th><Th>Status</Th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="hover:bg-stone-50/70">
                  <Td><Link to={`/admin/coaches/${c.id}`} className="font-medium text-court-700 hover:underline">{c.name}</Link>{c.title && <span className="block text-xs text-muted">{c.title}</span>}</Td>
                  <Td>{c.mobile}</Td>
                  <Td right>{c.current_rate != null ? `${inr(c.current_rate)}/h` : <Badge tone="red">No rate</Badge>}</Td>
                  <Td right>{c.batches}</Td>
                  <Td right>{num(c.month_hours)}</Td>
                  <Td right>{inr(c.month_payable)}</Td>
                  <Td><StatusBadge status={c.profile_status} />{!c.is_public && <Badge className="ml-1">Hidden</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {creating && (
        <SimpleForm
          title="Add coach"
          wide
          fields={[
            ...COACH_FIELDS.slice(0, 3),
            { name: "password", label: "Login password", hint: "At least 8 characters" },
            { name: "hourly_rate", label: "Hourly rate (₹)", type: "number", required: true },
            { name: "rate_effective_from", label: "Rate effective from", type: "date", default: todayISO() },
            ...COACH_FIELDS.slice(3),
          ]}
          endpoint="/admin/coaches"
          onClose={() => setCreating(false)}
          onDone={(r) => { setCreating(false); mutate(); navigate(`/admin/coaches/${r.id}`); }}
        />
      )}
    </>
  );
}
