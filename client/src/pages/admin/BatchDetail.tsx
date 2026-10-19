import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { BatchEditModal, ScheduleCoachesModal } from "@/components/admin/batch-forms";
import { SimpleForm } from "@/components/admin/forms";
import { SessionList } from "@/components/portal/session-list";
import { Badge, Button, Card, CardHeader, ErrorNote, Field, Input, Loading, PageHeader, Select, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { ConfirmButton, Modal, useAction, useToast } from "@/components/ui-client";
import { api, useApi } from "@/lib/api";
import { WEEKDAYS, fmtDate, inr, shiftMonth, timeRange, titleCase } from "@/lib/format";

export default function BatchDetail() {
  const { id } = useParams();
  const { data: b, error, mutate } = useApi<any>(`/admin/batches/${id}`);
  const [modal, setModal] = useState<null | "edit" | "schedule" | "generate" | "duplicate" | "add">(null);
  const { busy, run } = useAction();
  const navigate = useNavigate();
  const toast = useToast();
  if (error) return <ErrorNote error={error} />;
  if (!b) return <Loading />;
  const act = (path: string, body?: unknown, msg = "Done") => run(async () => { await api(path, { method: "POST", body }); mutate(); }, msg);
  const nextPeriod = /^\d{4}-\d{2}$/.test(b.period_label) ? shiftMonth(b.period_label, 1) : "";
  const nextStart = b.end_date ? new Date(new Date(`${b.end_date}T00:00:00`).getTime() + 86400000) : null;
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return (
    <>
      <PageHeader
        title={b.name}
        subtitle={`${b.code}${b.period_label ? ` · ${b.period_label}` : ""} · ${fmtDate(b.start_date)} – ${fmtDate(b.end_date)}`}
        back={{ href: "/admin/batches", label: "Batches" }}
        actions={
          <>
            <Button variant="secondary" onClick={() => setModal("edit")}>Edit</Button>
            <Button variant="secondary" onClick={() => setModal("duplicate")}>Roll over to next period</Button>
            <Button onClick={() => setModal("generate")}>Generate sessions</Button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Seats taken" value={`${b.seats_taken} / ${b.max_players}`} hint={`Min ${b.min_players} · ${b.seats_left} left`} tone={b.seats_left === 0 ? "warn" : undefined} />
        <Stat label="Status" value={<StatusBadge status={b.display_status} />} hint={b.is_public ? "Listed on website" : "Hidden from website"} />
        <Stat label="Sessions" value={`${b.session_counts.completed ?? 0} done`} hint={`${b.session_counts.scheduled ?? 0} scheduled · ${b.session_counts.cancelled ?? 0} cancelled`} />
        <Stat label="Fee" value={inr(b.display_price)} hint={b.fee_plan ? `${b.fee_plan.name}` : "Batch price"} />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader title="Schedule & coaches" action={<Button size="sm" variant="secondary" onClick={() => setModal("schedule")}>Edit</Button>} />
          <ul className="divide-y divide-line text-sm">
            {b.schedules.map((s: any) => (
              <li key={s.id} className="flex flex-wrap justify-between gap-2 px-5 py-3">
                <span className="font-medium">{WEEKDAYS[s.weekday]} · {timeRange(s.start_time, s.end_time)}</span>
                <span className="text-muted">{s.venue_name} · {s.courts} court{s.courts === 1 ? "" : "s"}</span>
              </li>
            ))}
            {b.schedules.length === 0 && <li className="px-5 py-3 text-muted">No schedule yet.</li>}
          </ul>
          <div className="border-t border-line px-5 py-3 text-sm">
            {b.coaches.length ? b.coaches.map((c: any) => <Badge key={c.coach_id} tone="green" className="mr-1">{c.name} · {c.role}</Badge>) : <span className="text-muted">No coach assigned</span>}
          </div>
          {b.last_session_date && <p className="border-t border-line px-5 py-3 text-xs text-muted">Sessions generated up to {fmtDate(b.last_session_date)}</p>}
        </Card>
        <Card>
          <CardHeader title={`Students (${b.enrollments.length})`} action={<Button size="sm" onClick={() => setModal("add")}>Add student</Button>} />
          {b.enrollments.length ? (
            <Table>
              <thead><tr><Th>Student</Th><Th>Package</Th><Th>Joined</Th><Th>Status</Th><Th right>Actions</Th></tr></thead>
              <tbody>
                {b.enrollments.map((e: any) => (
                  <tr key={e.id}>
                    <Td><Link to={`/admin/students/${e.student_id}`} className="font-medium text-court-700 hover:underline">{e.student_name}</Link><span className="block text-xs text-muted">{e.student_mobile}</span></Td>
                    <Td className="text-xs">{e.plan ? <>{e.plan.name} · {inr(e.plan.final_fee)} <StatusBadge status={e.plan.status} /></> : "—"}{e.pending_payment && <span className="block text-amber-700">UPI {inr(e.pending_payment.amount)} · {e.pending_payment.reference_no}</span>}</Td>
                    <Td>{fmtDate(e.joined_on)}{e.left_on && <span className="block text-xs text-muted">left {fmtDate(e.left_on)}</span>}</Td>
                    <Td><StatusBadge status={e.status} />{e.capacity_override && <Badge tone="amber" className="ml-1">override</Badge>}</Td>
                    <Td right>
                      <div className="flex justify-end gap-1">
                        {e.pending_payment && <Button size="sm" disabled={busy} onClick={() => act(`/admin/payments/${e.pending_payment.id}/verify`, undefined, "Payment verified — enrollment active")}>Verify payment</Button>}
                        {e.status === "pending" && !e.pending_payment && <Button size="sm" disabled={busy} onClick={() => act(`/admin/enrollments/${e.id}/approve`, undefined, "Enrollment confirmed")}>Confirm</Button>}
                        {e.status === "pending" && <ConfirmButton variant="danger" confirm="Reject this enrollment and release the seat?" onConfirm={() => act(`/admin/enrollments/${e.id}/end`, { status: "rejected" })}>Reject</ConfirmButton>}
                        {e.status === "active" && <ConfirmButton confirm="Mark as left from today?" onConfirm={() => act(`/admin/enrollments/${e.id}/end`, { status: "left" })}>Left</ConfirmButton>}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <p className="p-5 text-sm text-muted">No students yet.</p>}
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Sessions" subtitle="Last 30 days and upcoming" action={<Link className="text-sm font-semibold text-court-700" to={`/admin/sessions?batch=${b.id}`}>All sessions</Link>} />
        <SessionList sessions={b.sessions} hrefBase="/admin/sessions" empty="No sessions generated yet." />
      </Card>

      {modal === "edit" && <BatchEditModal batch={b} onClose={() => setModal(null)} onDone={() => { setModal(null); mutate(); }} />}
      {modal === "schedule" && <ScheduleCoachesModal batch={b} onClose={() => setModal(null)} onDone={() => { setModal(null); mutate(); }} />}
      {modal === "generate" && (
        <SimpleForm
          title="Generate sessions"
          intro={<p className="text-sm text-muted">Creates sessions from the weekly schedule. Dates that already have a session are skipped, so it is safe to run again.</p>}
          fields={[
            { name: "start", label: "From", type: "date", default: b.start_date ?? "" },
            { name: "end", label: "To", type: "date", default: b.end_date ?? "" },
          ]}
          endpoint={`/admin/batches/${b.id}/generate-sessions`}
          submitLabel="Generate"
          onClose={() => setModal(null)}
          onDone={(r) => { setModal(null); mutate(); toast(`${r.created} session(s) created`); }}
        />
      )}
      {modal === "duplicate" && (
        <SimpleForm
          title="Roll over to next period"
          intro={<p className="text-sm text-muted">Creates the same batch for the next period with the same schedule, coaches and pricing. Current students are re-enrolled as pending until they pay.</p>}
          fields={[
            { name: "period_label", label: "New period", required: true, default: nextPeriod },
            { name: "start_date", label: "Start date", type: "date", required: true, default: nextStart ? iso(nextStart) : "" },
            { name: "end_date", label: "End date", type: "date", default: nextStart ? iso(new Date(nextStart.getFullYear(), nextStart.getMonth() + 1, 0)) : "" },
            { name: "copy_students", label: "Re-enroll current students (pending)", type: "checkbox", default: true },
            { name: "generate_sessions", label: "Generate sessions", type: "checkbox", default: true },
          ]}
          endpoint={`/admin/batches/${b.id}/duplicate`}
          submitLabel="Create next batch"
          onClose={() => setModal(null)}
          onDone={(r) => { setModal(null); navigate(`/admin/batches/${r.id}`); }}
        />
      )}
      {modal === "add" && <AddStudent batch={b} onClose={() => setModal(null)} onDone={() => { setModal(null); mutate(); }} />}
    </>
  );
}

function AddStudent({ batch, onClose, onDone }: { batch: any; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<any>(null);
  const { data } = useApi<any>(q.length >= 2 ? `/admin/students?q=${encodeURIComponent(q)}&page_size=10` : null);
  const { data: plans } = useApi<any>("/admin/fee-plans?status=active");
  const { busy, run } = useAction();
  return (
    <Modal open onClose={onClose} title={`Add student to ${batch.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="add-student" disabled={busy || !picked}>Enroll</Button></>}>
      <form
        id="add-student"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(async () => {
            await api(`/admin/batches/${batch.id}/enrollments`, {
              body: {
                student_id: picked.id,
                fee_plan_id: f.get("fee_plan_id") || null,
                discount_type: f.get("discount_type"),
                discount_value: Number(f.get("discount_value") || 0),
                start_date: f.get("start_date") || null,
                override_capacity: f.get("override") === "on",
                activate: f.get("activate") === "on",
              },
            });
            onDone();
          }, "Student enrolled");
        }}
      >
        {picked ? (
          <div className="flex items-center justify-between rounded-xl bg-court-50 px-4 py-3 text-sm">
            <span><strong>{picked.name}</strong> · {picked.mobile}</span>
            <button type="button" className="underline" onClick={() => setPicked(null)}>Change</button>
          </div>
        ) : (
          <Field label="Find student">
            <Input autoFocus placeholder="Name or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
            {data?.items?.length > 0 && (
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {data.items.map((s: any) => (
                  <li key={s.id}><button type="button" className="w-full px-4 py-2 text-left text-sm hover:bg-court-50" onClick={() => setPicked(s)}>{s.name} <span className="text-muted">· {s.mobile}</span></button></li>
                ))}
              </ul>
            )}
          </Field>
        )}
        {batch.seats_left <= 0 && <label className="flex items-center gap-2 text-sm text-amber-800"><input type="checkbox" name="override" /> Batch is full — override capacity</label>}
        <Field label="Fee plan">
          <Select name="fee_plan_id" defaultValue="">
            <option value="">{batch.fee_plan ? `Batch default: ${batch.fee_plan.name}` : "Batch default"}</option>
            {plans?.items?.map((p: any) => <option key={p.id} value={p.id}>{p.name} — {inr(p.base_fee)}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Discount"><Select name="discount_type" defaultValue="none"><option value="none">None</option><option value="percent">Percentage</option><option value="fixed">Fixed</option></Select></Field>
          <Field label="Discount value"><Input name="discount_value" type="number" min={0} defaultValue={0} /></Field>
        </div>
        <Field label="Start date"><Input name="start_date" type="date" defaultValue={batch.start_date ?? ""} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="activate" defaultChecked /> Confirm now and bill the package</label>
        <p className="text-xs text-muted">{titleCase(batch.skill_level)} batch · {batch.seats_left} seat(s) left</p>
      </form>
    </Modal>
  );
}
