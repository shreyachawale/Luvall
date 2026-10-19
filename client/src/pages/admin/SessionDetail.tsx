import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import { SimpleForm } from "@/components/admin/forms";
import { AttendanceEditor } from "@/components/portal/attendance-editor";
import { Button, Card, CardHeader, ErrorNote, Input, Loading, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { ConfirmButton, Modal, useAction } from "@/components/ui-client";
import { api, useApi } from "@/lib/api";
import { inr, num, titleCase } from "@/lib/format";

export default function AdminSession() {
  const { id } = useParams();
  const { data: s, error, mutate } = useApi<any>(`/sessions/${id}`);
  const { data: settings } = useApi<any>("/admin/settings");
  const coaches = useApi<any[]>("/admin/coaches");
  const [modal, setModal] = useState<null | "cancel" | "edit" | "coaches">(null);
  const [key, setKey] = useState(0);
  const { run } = useAction();
  const navigate = useNavigate();
  if (error) return <ErrorNote error={error} />;
  if (!s) return <Loading />;
  const refresh = () => { mutate(); setKey((k) => k + 1); };
  const post = (path: string, msg: string) => run(async () => { await api(path, { method: "POST" }); refresh(); }, msg);
  return (
    <>
      <PageHeader
        title={`${s.batch_name}`}
        back={{ href: "/admin/sessions", label: "Sessions" }}
        actions={
          <>
            <Button variant="secondary" onClick={() => setModal("edit")}>Edit details</Button>
            <Button variant="secondary" onClick={() => setModal("coaches")}>Coaches & rates</Button>
            {s.status !== "scheduled" && <Button variant="secondary" onClick={() => post(`/admin/sessions/${s.id}/refresh-rates`, "Rates re-applied")}>Re-apply rates</Button>}
            {s.status === "cancelled" ? (
              <ConfirmButton size="md" confirm="Reinstate this session? Cancellation credits are reversed." onConfirm={() => post(`/admin/sessions/${s.id}/reinstate`, "Session reinstated")}>Reinstate</ConfirmButton>
            ) : s.status === "scheduled" ? (
              <Button variant="danger" onClick={() => setModal("cancel")}>Cancel session</Button>
            ) : null}
            {s.status === "scheduled" && (
              <ConfirmButton size="md" variant="danger" confirm="Delete this session entirely? Use cancel instead if students were expected." onConfirm={() => run(async () => { await api(`/admin/sessions/${s.id}`, { method: "DELETE" }); navigate("/admin/sessions"); }, "Session deleted")}>Delete</ConfirmButton>
            )}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <AttendanceEditor key={key} sessionId={s.id} admin onSaved={() => mutate()} />
        <div className="space-y-6">
          <Card>
            <CardHeader title="Charges" subtitle="Snapshotted when recorded" />
            <dl className="space-y-2 p-5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Rate slot</dt><dd>{s.day_type ? `${titleCase(s.day_type)} ${s.time_slot}` : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Venue rate</dt><dd>{s.venue_rate_applied != null ? `${inr(s.venue_rate_applied)}/court/h` : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Courts × hours</dt><dd>{s.courts_booked} × {num(s.duration_minutes / 60, 2)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Venue charged</dt><dd>{s.venue_charge_applies ? "Yes" : "No"}</dd></div>
              <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>Court payable</dt><dd>{s.court_payable != null ? inr(s.court_payable) : "—"}</dd></div>
            </dl>
            <Table>
              <thead><tr><Th>Coach</Th><Th right>Hours</Th><Th right>Rate</Th><Th right>Payable</Th></tr></thead>
              <tbody>
                {s.coaches.map((c: any) => (
                  <tr key={c.id}><Td>{c.name}</Td><Td right>{c.hours_coached ?? "—"}</Td><Td right>{c.rate_applied != null ? inr(c.rate_applied) : "—"}</Td><Td right>{c.payable_amount != null ? inr(c.payable_amount) : "—"}</Td></tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      </div>
      {modal === "cancel" && (
        <SimpleForm
          title="Cancel session"
          intro={<p className="text-sm text-muted">A cancellation is recorded for every enrolled student — it is never treated as an absence and does not create a make-up.</p>}
          fields={[
            { name: "reason", label: "Reason", required: true, full: true, placeholder: "Rain / court unavailable / coach unwell" },
            { name: "adjustment", label: "Student adjustment", type: "select", required: true, default: settings?.default_cancellation_adjustment ?? "carry_forward", full: true, options: [
              { value: "carry_forward", label: "Carry forward — session stays in the package" },
              { value: "refund", label: "Refund — credit the per-session value" },
              { value: "no_adjustment", label: "No adjustment — counts as used" },
            ] },
            { name: "venue_charge_applies", label: "Venue still charges for this booking", type: "checkbox", default: false, full: true },
          ]}
          endpoint={`/admin/sessions/${s.id}/cancel`}
          submitLabel="Cancel session"
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); refresh(); }}
        />
      )}
      {modal === "edit" && (
        <SimpleForm
          title="Edit session"
          initial={{ ...s, start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5) }}
          fields={[
            { name: "session_date", label: "Date", type: "date", required: true, hint: s.status !== "scheduled" ? "Only scheduled sessions can move date" : undefined },
            { name: "courts_booked", label: "Courts", type: "number", required: true },
            { name: "start_time", label: "Start", type: "time", required: true },
            { name: "end_time", label: "End", type: "time", required: true },
            { name: "venue_charge_applies", label: "Venue charges for this session", type: "checkbox", full: true },
            { name: "remarks", label: "Remarks", type: "textarea" },
          ]}
          method="PATCH"
          endpoint={`/admin/sessions/${s.id}`}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); refresh(); }}
        />
      )}
      {modal === "coaches" && coaches.data && (
        <CoachesForm session={s} allCoaches={coaches.data} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />
      )}
    </>
  );
}

function CoachesForm({ session, allCoaches, onClose, onDone }: { session: any; allCoaches: any[]; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState(session.coaches.map((c: any) => ({ coach_id: c.coach_id, hours_coached: c.hours_coached ?? "", rate_applied: c.rate_applied ?? "", adjustment_amount: c.adjustment_amount ?? 0, adjustment_note: c.adjustment_note ?? "" })));
  const { busy, run } = useAction();
  return (
    <Modal open onClose={onClose} title="Coaches, hours & rates" wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => run(async () => {
      await api(`/admin/sessions/${session.id}/coaches`, { method: "PUT", body: rows.filter((r: any) => r.coach_id).map((r: any) => ({
        coach_id: r.coach_id, hours_coached: r.hours_coached === "" ? null : Number(r.hours_coached), rate_applied: r.rate_applied === "" ? null : Number(r.rate_applied),
        adjustment_amount: Number(r.adjustment_amount || 0), adjustment_note: r.adjustment_note || null,
      })) });
      onDone();
    }, "Coaches updated")}>Save</Button></>}>
      <p className="mb-3 text-sm text-muted">Swap or add a coach for this session, or override the applied rate. Payable = hours × rate + adjustment.</p>
      <div className="space-y-2">
        {rows.map((r: any, i: number) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-line p-2 sm:grid-cols-[1fr_90px_100px_100px_1fr_32px]">
            <Select aria-label="Coach" value={r.coach_id} onChange={(e) => setRows(rows.map((x: any, j: number) => (j === i ? { ...x, coach_id: e.target.value } : x)))}>
              <option value="">Coach…</option>{allCoaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Input aria-label="Hours" type="number" step="0.25" placeholder="Hours" value={r.hours_coached} onChange={(e) => setRows(rows.map((x: any, j: number) => (j === i ? { ...x, hours_coached: e.target.value } : x)))} />
            <Input aria-label="Rate" type="number" placeholder="Rate" value={r.rate_applied} onChange={(e) => setRows(rows.map((x: any, j: number) => (j === i ? { ...x, rate_applied: e.target.value } : x)))} />
            <Input aria-label="Adjustment" type="number" placeholder="Adj." value={r.adjustment_amount} onChange={(e) => setRows(rows.map((x: any, j: number) => (j === i ? { ...x, adjustment_amount: e.target.value } : x)))} />
            <Input aria-label="Note" placeholder="Note" value={r.adjustment_note} onChange={(e) => setRows(rows.map((x: any, j: number) => (j === i ? { ...x, adjustment_note: e.target.value } : x)))} />
            <button type="button" className="text-muted hover:text-red-700" aria-label="Remove" onClick={() => setRows(rows.filter((_: any, j: number) => j !== i))}>×</button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setRows([...rows, { coach_id: "", hours_coached: "", rate_applied: "", adjustment_amount: 0, adjustment_note: "" }])}>Add coach</Button>
      </div>
    </Modal>
  );
}
