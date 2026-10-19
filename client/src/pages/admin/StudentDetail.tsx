import { useState } from "react";
import { Link, useParams } from "react-router";

import { EntityForm, FormFields, initialValues, toPayload, type FieldDef } from "@/components/admin/crud";
import { STUDENT_FIELDS } from "@/components/admin/fields";
import { SimpleForm } from "@/components/admin/forms";
import { LedgerTable, PlanUsage } from "@/components/portal/finance";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, Loading, PageHeader, Select, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { ConfirmButton, Modal, Tabs, useAction } from "@/components/ui-client";
import { api, useApi } from "@/lib/api";
import { fmtDate, fmtDay, inr, titleCase, todayISO } from "@/lib/format";

type Tab = "overview" | "plans" | "payments" | "ledger" | "attendance" | "makeups";

export default function StudentDetail() {
  const { id } = useParams();
  const { data: s, error, mutate } = useApi<any>(`/admin/students/${id}`);
  const [tab, setTab] = useState<Tab>("overview");
  const [modal, setModal] = useState<null | "edit" | "enroll" | "plan" | "payment" | "adjust" | "refund" | "password">(null);
  const [editPlan, setEditPlan] = useState<any>(null);
  const { busy, run } = useAction();
  if (error) return <ErrorNote error={error} />;
  if (!s) return <Loading />;
  const reload = () => mutate();
  const act = (path: string, body?: unknown, msg?: string) => run(async () => { await api(path, { method: "POST", body }); reload(); }, msg ?? "Done");

  return (
    <>
      <PageHeader
        title={s.name}
        subtitle={`${s.mobile}${s.email ? ` · ${s.email}` : ""} · ${titleCase(s.profile.skill_level)} · joined ${fmtDate(s.joined_date)}`}
        back={{ href: "/admin/students", label: "Students" }}
        actions={
          <>
            <Button variant="secondary" onClick={() => setModal("edit")}>Edit profile</Button>
            <Button variant="secondary" onClick={() => setModal("password")}>{s.has_login ? "Reset password" : "Enable login"}</Button>
            <Button onClick={() => setModal("enroll")}>Enroll in batch</Button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={s.balance < 0 ? "Outstanding" : "Credit"} value={inr(Math.abs(s.balance))} tone={s.balance < 0 ? "bad" : "good"} />
        <Stat label="Sessions remaining" value={s.plans.filter((p: any) => p.status === "active").reduce((n: number, p: any) => n + p.usage.remaining, 0)} />
        <Stat label="Open make-ups" value={s.makeups.filter((m: any) => ["available", "booked", "pending_approval"].includes(m.status)).length} />
        <Stat label="Profile" value={<StatusBadge status={s.profile.status} />} hint={s.profile.source === "walk_in" ? "Added as walk-in" : `Source: ${s.profile.source}`} />
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "overview", label: "Batches" },
          { value: "plans", label: `Packages (${s.plans.length})` },
          { value: "payments", label: `Payments (${s.payments.length})` },
          { value: "ledger", label: "Ledger" },
          { value: "attendance", label: "Attendance" },
          { value: "makeups", label: `Make-ups (${s.makeups.length})` },
        ]}
      />

      {tab === "overview" && (
        <Card>
          <CardHeader title="Enrollments" />
          {s.enrollments.length ? (
            <Table>
              <thead><tr><Th>Batch</Th><Th>Period</Th><Th>Joined</Th><Th>Left</Th><Th>Status</Th><Th right>Actions</Th></tr></thead>
              <tbody>
                {s.enrollments.map((e: any) => (
                  <tr key={e.id}>
                    <Td><Link className="font-medium text-court-700 hover:underline" to={`/admin/batches/${e.batch_id}`}>{e.batch_name}</Link>{e.capacity_override && <Badge tone="amber" className="ml-2">Over capacity</Badge>}</Td>
                    <Td>{e.period_label}</Td>
                    <Td>{fmtDate(e.joined_on)}</Td>
                    <Td>{fmtDate(e.left_on)}</Td>
                    <Td><StatusBadge status={e.status} /></Td>
                    <Td right>
                      <div className="flex justify-end gap-1">
                        {e.status === "pending" && <Button size="sm" disabled={busy} onClick={() => act(`/admin/enrollments/${e.id}/approve`, undefined, "Enrollment confirmed")}>Confirm</Button>}
                        {e.status === "pending" && <ConfirmButton variant="danger" confirm="Reject this enrollment? Its pending package is cancelled and the seat is released." onConfirm={() => act(`/admin/enrollments/${e.id}/end`, { status: "rejected" }, "Rejected")}>Reject</ConfirmButton>}
                        {e.status === "active" && <ConfirmButton confirm="Mark the student as having left this batch from today? Past attendance is kept." onConfirm={() => act(`/admin/enrollments/${e.id}/end`, { status: "left" }, "Marked as left")}>Mark left</ConfirmButton>}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <div className="p-5"><EmptyState title="Not enrolled in any batch" action={<Button onClick={() => setModal("enroll")}>Enroll</Button>} /></div>}
        </Card>
      )}

      {tab === "plans" && (
        <Card>
          <CardHeader title="Packages & fee plans" subtitle="Student-specific price, discount and session usage. Per-session value = fee ÷ sessions." action={<Button size="sm" onClick={() => setModal("plan")}>New package</Button>} />
          <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
            {s.plans.length ? s.plans.map((p: any) => (
              <div key={p.id} className="space-y-2">
                <PlanUsage plan={p} />
                <div className="flex flex-wrap gap-1">
                  <span className="mr-auto self-center text-xs text-muted">Per session {inr(p.per_session_value, true)}</span>
                  {p.status === "pending" && <Button size="sm" onClick={() => act(`/admin/plans/${p.id}/activate`, undefined, "Package activated and billed")}>Activate</Button>}
                  {p.status !== "cancelled" && <Button size="sm" variant="secondary" onClick={() => setEditPlan(p)}>Edit</Button>}
                  {p.status === "active" && (
                    <>
                      <ConfirmButton confirm={`Close this package and carry forward ${Math.max(p.usage.remaining, 0)} unused session(s) as account credit (${inr(Math.max(p.usage.remaining, 0) * p.per_session_value)})?`} onConfirm={() => act(`/admin/plans/${p.id}/close`, { action: "carry_forward" }, "Closed with carry-forward")}>Close · carry forward</ConfirmButton>
                      <ConfirmButton confirm="Close this package and forfeit unused sessions?" onConfirm={() => act(`/admin/plans/${p.id}/close`, { action: "forfeit" }, "Closed")}>Close · forfeit</ConfirmButton>
                    </>
                  )}
                  {["pending", "active"].includes(p.status) && <ConfirmButton variant="danger" confirm="Cancel this package? Its charge is reversed in the ledger." onConfirm={() => act(`/admin/plans/${p.id}/cancel`, undefined, "Package cancelled")}>Cancel</ConfirmButton>}
                </div>
              </div>
            )) : <EmptyState title="No packages" />}
          </div>
        </Card>
      )}

      {tab === "payments" && (
        <Card>
          <CardHeader title="Payments" action={<Button size="sm" onClick={() => setModal("payment")}>Record payment</Button>} />
          {s.payments.length ? (
            <Table>
              <thead><tr><Th>Date</Th><Th>For</Th><Th>Method</Th><Th>Reference</Th><Th>Status</Th><Th right>Amount</Th><Th right>Actions</Th></tr></thead>
              <tbody>
                {s.payments.map((p: any) => (
                  <tr key={p.id}>
                    <Td>{fmtDate(p.payment_date)}</Td>
                    <Td>{p.plan_name ?? "Account"}</Td>
                    <Td>{p.method.toUpperCase()}</Td>
                    <Td className="font-mono text-xs">{p.reference_no ?? "—"}{p.proof_url && <a href={p.proof_url} target="_blank" rel="noopener noreferrer" className="ml-2 font-sans text-court-700 underline">proof</a>}</Td>
                    <Td><StatusBadge status={p.status} /></Td>
                    <Td right>{inr(p.amount)}</Td>
                    <Td right>
                      <div className="flex justify-end gap-1">
                        {p.status === "pending" && <Button size="sm" onClick={() => act(`/admin/payments/${p.id}/verify`, undefined, "Payment verified")}>Verify</Button>}
                        {p.status !== "rejected" && <RejectPayment id={p.id} onDone={reload} />}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <p className="p-5 text-sm text-muted">No payments.</p>}
        </Card>
      )}

      {tab === "ledger" && (
        <Card>
          <CardHeader
            title="Ledger"
            subtitle="Append-only: corrections are posted as new entries."
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setModal("adjust")}>Adjustment</Button>
                <Button size="sm" variant="secondary" onClick={() => setModal("refund")}>Record refund</Button>
              </div>
            }
          />
          <LedgerTable ledger={s.ledger} />
        </Card>
      )}

      {tab === "attendance" && (
        <Card>
          <CardHeader title="Recent attendance" subtitle="Last 60 records" />
          {s.attendance.length ? (
            <Table>
              <thead><tr><Th>Date</Th><Th>Batch</Th><Th>Status</Th><Th>Type</Th><Th>Billing</Th><Th right>Actions</Th></tr></thead>
              <tbody>
                {s.attendance.map((a: any) => (
                  <tr key={a.id}>
                    <Td><Link to={`/admin/sessions/${a.session.id}`} className="text-court-700 hover:underline">{fmtDay(a.session.session_date)}</Link></Td>
                    <Td>{a.session.batch_name}{a.is_makeup && a.original_batch_name && <span className="block text-xs text-muted">for {a.original_batch_name}</span>}</Td>
                    <Td><StatusBadge status={a.attendance_status} /></Td>
                    <Td>{titleCase(a.attendee_type)}</Td>
                    <Td>{titleCase(a.billing_mode)}{!a.student_fee_plan_id && ["package", "refunded"].includes(a.billing_mode) && <Badge tone="red" className="ml-1">No package</Badge>}</Td>
                    <Td right>
                      {a.attendance_status === "absent" && a.attendee_type === "regular" && !s.makeups.some((m: any) => m.missed_attendance_id === a.id && !["rejected", "cancelled", "expired"].includes(m.status)) && (
                        <Button size="sm" variant="secondary" onClick={() => act(`/admin/attendance/${a.id}/grant-makeup`, undefined, "Make-up granted")}>Grant make-up</Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <p className="p-5 text-sm text-muted">No attendance yet.</p>}
        </Card>
      )}

      {tab === "makeups" && (
        <Card>
          <CardHeader title="Make-ups" action={<Link to={`/admin/makeups?student=${s.id}`} className="text-sm font-semibold text-court-700">Manage</Link>} />
          {s.makeups.length ? (
            <Table>
              <thead><tr><Th>Missed</Th><Th>Original batch</Th><Th>Status</Th><Th>Expires</Th><Th>Booked / used</Th></tr></thead>
              <tbody>
                {s.makeups.map((m: any) => (
                  <tr key={m.id}>
                    <Td>{fmtDay(m.missed_session_date)}</Td>
                    <Td>{m.original_batch_name}</Td>
                    <Td><StatusBadge status={m.status} /></Td>
                    <Td>{fmtDate(m.expires_on)}</Td>
                    <Td>{(m.used_session ?? m.booked_session) ? `${(m.used_session ?? m.booked_session).batch_name}, ${fmtDay((m.used_session ?? m.booked_session).session_date)}` : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <p className="p-5 text-sm text-muted">No make-ups.</p>}
        </Card>
      )}

      {modal === "edit" && (
        <EntityForm
          title="Edit student"
          fields={[...STUDENT_FIELDS.filter((f) => !["password", "opening_balance"].includes(f.name)), { name: "profile_status", label: "Student status", type: "select", required: true, options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive (hidden from attendance)" }] }]}
          row={{ ...s, ...s.profile, id: s.id, profile_status: s.profile.status, status: s.status }}
          endpoint="/admin/students"
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); reload(); }}
        />
      )}
      {modal === "enroll" && <EnrollModal studentId={s.id} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {(modal === "plan" || editPlan) && (
        <PlanModal studentId={s.id} plan={editPlan} enrollments={s.enrollments} onClose={() => { setModal(null); setEditPlan(null); }} onDone={() => { setModal(null); setEditPlan(null); reload(); }} />
      )}
      {modal === "payment" && <PaymentModal studentId={s.id} plans={s.plans.filter((p: any) => p.status !== "cancelled")} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === "adjust" && (
        <SimpleForm
          title="Ledger adjustment"
          fields={[
            { name: "amount", label: "Amount (₹)", type: "number", required: true, hint: "Positive = credit to the student, negative = amount owed" },
            { name: "txn_date", label: "Date", type: "date", default: todayISO(), required: true },
            { name: "kind", label: "Type", type: "select", required: true, default: "adjustment", options: [{ value: "adjustment", label: "Adjustment" }, { value: "opening_balance", label: "Opening balance (migration)" }] },
            { name: "description", label: "Reason", required: true, full: true },
          ]}
          endpoint={`/admin/students/${s.id}/adjustments`}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); reload(); }}
        />
      )}
      {modal === "refund" && (
        <SimpleForm
          title="Record refund paid to student"
          fields={[
            { name: "amount", label: "Amount (₹)", type: "number", required: true },
            { name: "refund_date", label: "Date", type: "date", default: todayISO(), required: true },
            { name: "method", label: "Method", type: "select", required: true, default: "upi", options: ["upi", "cash", "bank_transfer", "other"].map((v) => ({ value: v, label: titleCase(v) })) },
            { name: "reference_no", label: "Reference" },
            { name: "description", label: "Note", full: true },
          ]}
          endpoint={`/admin/students/${s.id}/refunds`}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); reload(); }}
        />
      )}
      {modal === "password" && (
        <SimpleForm
          title={s.has_login ? "Reset password" : "Enable login"}
          fields={[{ name: "new_password", label: "New password", required: true, hint: "At least 8 characters. Share it with the student securely." }]}
          endpoint={`/admin/users/${s.id}/password`}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); reload(); }}
        />
      )}
    </>
  );
}

function RejectPayment({ id, onDone }: { id: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>Reject</Button>
      {open && (
        <SimpleForm title="Reject payment" fields={[{ name: "reason", label: "Reason", required: true, full: true, placeholder: "e.g. UTR not found in bank statement" }]}
          endpoint={`/admin/payments/${id}/reject`} submitLabel="Reject payment" onClose={() => setOpen(false)} onDone={() => { setOpen(false); onDone(); }} />
      )}
    </>
  );
}

function EnrollModal({ studentId, onClose, onDone }: { studentId: string; onClose: () => void; onDone: () => void }) {
  const { data: batches } = useApi<any[]>("/admin/batches");
  const { data: plans } = useApi<any>("/admin/fee-plans?status=active");
  const [batchId, setBatchId] = useState("");
  const { busy, run } = useAction();
  const open = (batches ?? []).filter((b) => ["upcoming", "active"].includes(b.status));
  const batch = open.find((b) => b.id === batchId);
  return (
    <Modal open onClose={onClose} title="Enroll in a batch" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="enroll-form" disabled={busy || !batchId}>Enroll</Button></>}>
      {!batches ? <Loading /> : (
        <form
          id="enroll-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              await api(`/admin/batches/${batchId}/enrollments`, {
                body: {
                  student_id: studentId,
                  fee_plan_id: f.get("fee_plan_id") || null,
                  discount_type: f.get("discount_type"),
                  discount_value: Number(f.get("discount_value") || 0),
                  start_date: f.get("start_date") || null,
                  override_capacity: f.get("override") === "on",
                  activate: f.get("activate") === "on",
                },
              });
              onDone();
            }, "Enrolled");
          }}
        >
          <Field label="Batch" required>
            <Select value={batchId} onChange={(e) => setBatchId(e.target.value)} required>
              <option value="">Choose…</option>
              {open.map((b) => <option key={b.id} value={b.id}>{b.name} {b.period_label && `(${b.period_label})`} — {b.seats_left} seats left</option>)}
            </Select>
          </Field>
          {batch && batch.seats_left <= 0 && (
            <label className="flex items-center gap-2 text-sm text-amber-800"><input type="checkbox" name="override" /> Batch is full — enroll anyway (capacity override)</label>
          )}
          <Field label="Fee plan" hint="Defaults to the batch's linked plan">
            <Select name="fee_plan_id" defaultValue="">
              <option value="">{batch?.fee_plan ? `Batch default: ${batch.fee_plan.name}` : "Batch default"}</option>
              {plans?.items?.map((p: any) => <option key={p.id} value={p.id}>{p.name} — {inr(p.base_fee)}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Discount">
              <Select name="discount_type" defaultValue="none"><option value="none">None</option><option value="percent">Percentage</option><option value="fixed">Fixed amount</option></Select>
            </Field>
            <Field label="Discount value"><Input name="discount_value" type="number" min={0} defaultValue={0} /></Field>
          </div>
          <Field label="Start date" hint="Defaults to batch start or today"><Input name="start_date" type="date" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="activate" defaultChecked /> Confirm now (bill the package immediately)</label>
        </form>
      )}
    </Modal>
  );
}

function PlanModal({ studentId, plan, enrollments, onClose, onDone }: { studentId: string; plan: any; enrollments: any[]; onClose: () => void; onDone: () => void }) {
  const { data: templates } = useApi<any>("/admin/fee-plans?status=active");
  const fields: FieldDef[] = [
    ...(plan ? [] : [{ name: "fee_plan_id", label: "Start from fee plan", type: "select" as const, options: (templates?.items ?? []).map((t: any) => ({ value: t.id, label: `${t.name} — ${inr(t.base_fee)} / ${t.number_of_sessions}` })), hint: "Or leave empty and enter the price below" }]),
    { name: "name", label: "Package name", hint: plan ? undefined : "Defaults to the fee plan name" },
    { name: "base_fee", label: "Base fee (₹)", type: "number" },
    { name: "sessions_included", label: "Sessions included", type: "number" },
    { name: "discount_type", label: "Discount type", type: "select", required: true, default: "none", options: [{ value: "none", label: "None" }, { value: "percent", label: "Percentage" }, { value: "fixed", label: "Fixed amount" }] },
    { name: "discount_value", label: "Discount value", type: "number", default: 0 },
    { name: "start_date", label: "Start date", type: "date", required: true, default: todayISO() },
    { name: "end_date", label: "End date", type: "date" },
    { name: "batch_id", label: "For batch", type: "select", options: enrollments.map((e) => ({ value: e.batch_id, label: e.batch_name })), hint: "Attendance in this batch draws from this package" },
    ...(plan ? [] : [{ name: "activate", label: "Activate now (posts the charge to the ledger)", type: "checkbox" as const, default: true, full: true }]),
    { name: "notes", label: "Notes", type: "textarea" },
  ];
  const [values, setValues] = useState(() => initialValues(fields, plan ? { ...plan, batch_id: plan.batch_id ?? "" } : undefined));
  const { busy, run } = useAction();
  return (
    <Modal open onClose={onClose} title={plan ? "Edit package" : "New package"} wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="plan-form" disabled={busy}>Save</Button></>}>
      {plan?.status === "active" && <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Changing the fee posts a correction to the ledger for the difference.</p>}
      <form
        id="plan-form"
        onSubmit={(e) => {
          e.preventDefault();
          const body = toPayload(fields, values);
          if (body.discount_value === null) body.discount_value = 0;
          for (const k of Object.keys(body)) if (body[k] === null && plan === null && ["name", "base_fee", "sessions_included"].includes(k)) delete body[k];
          run(async () => { await api(plan ? `/admin/plans/${plan.id}` : `/admin/students/${studentId}/plans`, { method: plan ? "PATCH" : "POST", body }); onDone(); }, "Package saved");
        }}
      >
        <FormFields fields={fields} values={values} setValues={setValues} />
      </form>
    </Modal>
  );
}

function PaymentModal({ studentId, plans, onClose, onDone }: { studentId: string; plans: any[]; onClose: () => void; onDone: () => void }) {
  const fields: FieldDef[] = [
    { name: "amount", label: "Amount (₹)", type: "number", required: true },
    { name: "payment_date", label: "Date", type: "date", required: true, default: todayISO() },
    { name: "method", label: "Method", type: "select", required: true, default: "cash", options: ["cash", "upi", "bank_transfer", "other"].map((v) => ({ value: v, label: titleCase(v) })) },
    { name: "reference_no", label: "Reference / UTR" },
    { name: "student_fee_plan_id", label: "Against package", type: "select", options: plans.map((p) => ({ value: p.id, label: `${p.name} (${inr(p.final_fee)})` })) },
    { name: "verified", label: "Mark as verified (posts to ledger)", type: "checkbox", default: true },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
  return (
    <SimpleForm
      title="Record payment"
      fields={fields}
      transform={(b) => ({ ...b, student_id: studentId, student_fee_plan_id: b.student_fee_plan_id || null })}
      endpoint="/admin/payments"
      onClose={onClose}
      onDone={onDone}
    />
  );
}
