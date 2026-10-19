import { Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { SimpleForm } from "@/components/admin/forms";
import { Button, Card, EmptyState, ErrorNote, Field, Input, Loading, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { qs, useApi } from "@/lib/api";
import { fmtDay, inr, timeRange, todayISO } from "@/lib/format";

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Sessions() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const past = params.get("past") === "1";
  const [f, setF] = useState({
    start: past ? addDays(todayISO(), -90) : addDays(todayISO(), -7),
    end: past ? addDays(todayISO(), -1) : addDays(todayISO(), 21),
    batch_id: params.get("batch") ?? "",
    venue_id: "",
    coach_id: "",
    status: params.get("status") ?? "",
  });
  const [creating, setCreating] = useState(false);
  const batches = useApi<any[]>("/admin/batches");
  const venues = useApi<any[]>("/admin/venues");
  const coaches = useApi<any[]>("/admin/coaches");
  const { data, error, mutate } = useApi<any>(`/admin/sessions${qs({ ...f, page_size: 300 })}`);
  return (
    <>
      <PageHeader title="Sessions & attendance" subtitle="Record or correct attendance, cancel sessions and review court and coach charges." actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> One-off session</Button>} />
      <Card className="mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="From"><Input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label="To"><Input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
        <Field label="Batch"><Select value={f.batch_id} onChange={(e) => setF({ ...f, batch_id: e.target.value })}><option value="">All</option>{batches.data?.map((b) => <option key={b.id} value={b.id}>{b.name} {b.period_label}</option>)}</Select></Field>
        <Field label="Venue"><Select value={f.venue_id} onChange={(e) => setF({ ...f, venue_id: e.target.value })}><option value="">All</option>{venues.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></Field>
        <Field label="Coach"><Select value={f.coach_id} onChange={(e) => setF({ ...f, coach_id: e.target.value })}><option value="">All</option>{coaches.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Status"><Select value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); if (past) navigate("/admin/sessions", { replace: true }); }}><option value="">All</option><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></Select></Field>
      </Card>
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.items.length === 0 ? <EmptyState title="No sessions in this range" /> : (
        <Card>
          <Table>
            <thead><tr><Th>Date</Th><Th>Batch</Th><Th>Venue</Th><Th>Coach(es)</Th><Th right>Attendance</Th><Th right>Court payable</Th><Th>Status</Th></tr></thead>
            <tbody>
              {data.items.map((s: any) => {
                const overdue = s.status === "scheduled" && s.session_date < todayISO();
                return (
                  <tr key={s.id} className={overdue ? "bg-amber-50/60" : "hover:bg-stone-50/70"}>
                    <Td><Link to={`/admin/sessions/${s.id}`} className="font-medium text-court-700 hover:underline">{fmtDay(s.session_date)}</Link><span className="block text-xs text-muted">{timeRange(s.start_time, s.end_time)}</span></Td>
                    <Td>{s.batch_name}</Td>
                    <Td>{s.venue_name} <span className="text-xs text-muted">· {s.courts_booked}c</span></Td>
                    <Td className="text-xs">{s.coaches.map((c: any) => c.name).join(", ")}</Td>
                    <Td right>{s.status === "completed" ? `${s.present_count}/${s.present_count + s.absent_count}` : `${s.expected_count} exp.`}</Td>
                    <Td right>{s.court_payable != null ? inr(s.court_payable) : "—"}</Td>
                    <Td><StatusBadge status={s.status} label={overdue ? "Not recorded" : undefined} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <p className="px-4 py-3 text-sm text-muted">{data.total} sessions</p>
        </Card>
      )}
      {creating && (
        <SimpleForm
          title="Add a one-off session"
          intro={<p className="text-sm text-muted">For extra classes or rescheduled sessions outside the weekly pattern. Coaches default to the batch coaches.</p>}
          fields={[
            { name: "batch_id", label: "Batch", type: "select", required: true, options: (batches.data ?? []).filter((b) => ["upcoming", "active"].includes(b.status)).map((b) => ({ value: b.id, label: `${b.name} ${b.period_label}` })) },
            { name: "venue_id", label: "Venue", type: "select", required: true, options: (venues.data ?? []).map((v) => ({ value: v.id, label: v.name })) },
            { name: "session_date", label: "Date", type: "date", required: true, default: todayISO() },
            { name: "courts_booked", label: "Courts", type: "number", default: 1, required: true },
            { name: "start_time", label: "Start", type: "time", required: true, default: "17:00" },
            { name: "end_time", label: "End", type: "time", required: true, default: "18:00" },
            { name: "remarks", label: "Remarks", type: "textarea" },
          ]}
          endpoint="/admin/sessions"
          onClose={() => setCreating(false)}
          onDone={(s) => { setCreating(false); mutate(); navigate(`/admin/sessions/${s.id}`); }}
        />
      )}
    </>
  );
}
