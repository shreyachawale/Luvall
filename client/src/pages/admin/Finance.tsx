import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { CrudPage } from "@/components/admin/crud";
import { PAY_METHODS } from "@/components/admin/fields";
import { SimpleForm } from "@/components/admin/forms";
import { MonthPicker } from "@/components/portal/month-picker";
import { Button, Card, CardHeader, EmptyState, ErrorNote, Loading, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { ConfirmButton, Tabs, useAction } from "@/components/ui-client";
import { api, qs, useApi } from "@/lib/api";
import { fmtDate, fmtDay, inr, monthISO, num, titleCase, todayISO } from "@/lib/format";

type Tab = "verify" | "payments" | "plans" | "coaches" | "venues" | "expenses";

export default function FinancePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tab = (params.get("tab") as Tab) ?? "verify";
  const setTab = (t: Tab) => navigate(`/admin/finance?tab=${t}`, { replace: true });
  return (
    <>
      {tab !== "expenses" && <PageHeader title="Finance & ledger" subtitle="Payment verification, collections, package closing, coach and venue payouts, and operating expenses." />}
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "verify", label: "Verify payments" },
          { value: "payments", label: "All payments" },
          { value: "plans", label: "Packages to close" },
          { value: "coaches", label: "Coach payouts" },
          { value: "venues", label: "Venue payouts" },
          { value: "expenses", label: "Expenses" },
        ]}
      />
      {tab === "verify" && <Verify />}
      {tab === "payments" && <Payments />}
      {tab === "plans" && <PlansToClose />}
      {tab === "coaches" && <Payouts kind="coaches" />}
      {tab === "venues" && <Payouts kind="venues" />}
      {tab === "expenses" && <Expenses />}
    </>
  );
}

function PaymentRows({ items, reload, showActions = true }: { items: any[]; reload: () => void; showActions?: boolean }) {
  const { busy, run } = useAction();
  const [rejecting, setRejecting] = useState<any>(null);
  return (
    <>
      <Table>
        <thead><tr><Th>Date</Th><Th>Student</Th><Th>For</Th><Th>Method</Th><Th>UTR / reference</Th><Th>Status</Th><Th right>Amount</Th>{showActions && <Th right>Actions</Th>}</tr></thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id}>
              <Td>{fmtDate(p.payment_date)}</Td>
              <Td><Link to={`/admin/students/${p.student_id}`} className="font-medium text-court-700 hover:underline">{p.student_name}</Link><span className="block text-xs text-muted">{p.student_mobile}</span></Td>
              <Td className="text-xs">{p.plan_name ?? "Account"}{p.batch_name && <span className="block text-muted">{p.batch_name}</span>}{p.plan_final_fee != null && Number(p.plan_final_fee) !== Number(p.amount) && <span className="block text-amber-700">Fee {inr(p.plan_final_fee)}</span>}</Td>
              <Td>{p.method.toUpperCase()}</Td>
              <Td className="font-mono text-xs">{p.reference_no ?? "—"}{p.proof_url && <a className="ml-2 font-sans text-court-700 underline" href={p.proof_url} target="_blank" rel="noopener noreferrer">screenshot</a>}</Td>
              <Td><StatusBadge status={p.status} />{p.rejection_reason && <span className="block text-xs text-red-700">{p.rejection_reason}</span>}</Td>
              <Td right className="font-semibold">{inr(p.amount)}</Td>
              {showActions && (
                <Td right>
                  <div className="flex justify-end gap-1">
                    {p.status === "pending" && <Button size="sm" disabled={busy} onClick={() => run(async () => { await api(`/admin/payments/${p.id}/verify`, { method: "POST" }); reload(); }, "Payment verified")}>Verify</Button>}
                    {p.status !== "rejected" && <Button size="sm" variant="danger" onClick={() => setRejecting(p)}>Reject</Button>}
                  </div>
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
      {rejecting && (
        <SimpleForm title={`Reject ${inr(rejecting.amount)} from ${rejecting.student_name}`} fields={[{ name: "reason", label: "Reason", required: true, full: true }]}
          intro={rejecting.status === "verified" ? <p className="text-sm text-amber-800">This payment was verified; rejecting it reverses the ledger entry.</p> : undefined}
          endpoint={`/admin/payments/${rejecting.id}/reject`} submitLabel="Reject" onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); reload(); }} />
      )}
    </>
  );
}

function Verify() {
  const { data, error, mutate } = useApi<any>("/admin/finance/pending");
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return (
    <Card>
      <CardHeader title="UPI payments awaiting verification" subtitle="Check each UTR against the bank/UPI statement. Verifying confirms the student's package and enrollment." />
      {data.payments.length ? <PaymentRows items={data.payments} reload={mutate} /> : <div className="p-5"><EmptyState title="Nothing to verify">All submitted payments have been processed.</EmptyState></div>}
    </Card>
  );
}

function Payments() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [recording, setRecording] = useState(false);
  const { data, error, mutate } = useApi<any>(`/admin/payments${qs({ status, page })}`);
  const students = useApi<any>(recording ? "/admin/students?page_size=200" : null);
  return (
    <Card>
      <CardHeader
        title="Payments"
        action={
          <div className="flex gap-2">
            <select className="rounded-full border border-line px-3 py-1.5 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
              <option value="">All</option><option value="pending">Pending</option><option value="verified">Verified</option><option value="rejected">Rejected</option>
            </select>
            <Button size="sm" onClick={() => setRecording(true)}>Record payment</Button>
          </div>
        }
      />
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.items.length ? <PaymentRows items={data.items} reload={mutate} /> : <p className="p-5 text-sm text-muted">No payments.</p>}
      {data && data.total > data.page_size && (
        <div className="flex justify-end gap-2 p-3">
          <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button size="sm" variant="secondary" disabled={page * data.page_size >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
      {recording && students.data && (
        <SimpleForm
          title="Record a payment"
          intro={<p className="text-sm text-muted">To link the payment to a specific package, record it from the student&apos;s page.</p>}
          fields={[
            { name: "student_id", label: "Student", type: "select", required: true, full: true, options: students.data.items.map((s: any) => ({ value: String(s.id), label: `${s.name} · ${s.mobile}` })) },
            { name: "amount", label: "Amount (₹)", type: "number", required: true },
            { name: "payment_date", label: "Date", type: "date", required: true, default: todayISO() },
            { name: "method", label: "Method", type: "select", required: true, default: "cash", options: PAY_METHODS },
            { name: "reference_no", label: "Reference" },
            { name: "verified", label: "Verified (posts to ledger)", type: "checkbox", default: true },
          ]}
          endpoint="/admin/payments"
          onClose={() => setRecording(false)}
          onDone={() => { setRecording(false); mutate(); }}
        />
      )}
    </Card>
  );
}

function PlansToClose() {
  const { data, error, mutate } = useApi<any>("/admin/finance/pending");
  const { run } = useAction();
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return (
    <Card>
      <CardHeader title="Packages past their end date" subtitle="Close each one: unused sessions are carried forward as account credit (per-session value × remaining) or forfeited." />
      {data.plans_to_close.length ? (
        <Table>
          <thead><tr><Th>Student</Th><Th>Package</Th><Th>Ended</Th><Th right>Used / included</Th><Th right>Remaining value</Th><Th right>Actions</Th></tr></thead>
          <tbody>
            {data.plans_to_close.map((p: any) => (
              <tr key={p.id}>
                <Td><Link to={`/admin/students/${p.student_id}`} className="font-medium text-court-700 hover:underline">{p.student_name}</Link></Td>
                <Td>{p.name}<span className="block text-xs text-muted">{p.batch_name}</span></Td>
                <Td>{fmtDate(p.end_date)}</Td>
                <Td right>{p.usage.used + p.usage.refunded} / {p.usage.sessions_included}</Td>
                <Td right>{inr(Math.max(p.usage.remaining, 0) * p.per_session_value)}</Td>
                <Td right>
                  <div className="flex justify-end gap-1">
                    <ConfirmButton variant="primary" confirm={`Carry forward ${Math.max(p.usage.remaining, 0)} session(s) as credit?`} onConfirm={() => run(async () => { await api(`/admin/plans/${p.id}/close`, { body: { action: "carry_forward" } }); mutate(); }, "Closed")}>Carry forward</ConfirmButton>
                    <ConfirmButton confirm="Close and forfeit unused sessions?" onConfirm={() => run(async () => { await api(`/admin/plans/${p.id}/close`, { body: { action: "forfeit" } }); mutate(); }, "Closed")}>Forfeit</ConfirmButton>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <div className="p-5"><EmptyState title="No packages to close" /></div>}
    </Card>
  );
}

function Payouts({ kind }: { kind: "coaches" | "venues" }) {
  const [month, setMonth] = useState(monthISO());
  const { data, error, mutate } = useApi<any>(`/admin/payouts/${kind}?month=${month}`);
  const [paying, setPaying] = useState<any>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const { run } = useAction();
  const idKey = kind === "coaches" ? "coach_id" : "venue_id";
  const nameKey = kind === "coaches" ? "coach" : "venue";
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const totals = data.summary.reduce((t: any, r: any) => ({ payable: t.payable + Number(r.payable), paid: t.paid + Number(r.paid) }), { payable: 0, paid: 0 });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <MonthPicker value={month} onChange={setMonth} />
        <p className="text-sm text-muted">{kind === "coaches" ? "Payable = Σ actual hours × rate applied + adjustments" : "Payable = Σ duration × courts × venue rate"}</p>
      </div>
      <div className="mb-4 grid grid-cols-3 gap-4">
        <Stat label="Payable" value={inr(totals.payable)} />
        <Stat label="Paid" value={inr(totals.paid)} tone="good" />
        <Stat label="Balance" value={inr(totals.payable - totals.paid)} tone={totals.payable - totals.paid > 0 ? "warn" : undefined} />
      </div>
      <Card className="mb-6">
        {data.summary.length ? (
          <Table>
            <thead>
              <tr>
                <Th>{kind === "coaches" ? "Coach" : "Venue"}</Th><Th right>Sessions</Th>
                {kind === "coaches" ? <Th right>Hours</Th> : <><Th right>Hours booked</Th><Th right>Court-hours</Th></>}
                <Th right>Payable</Th><Th right>Paid</Th><Th right>Balance</Th><Th>Status</Th><Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {data.summary.map((r: any) => (
                <tr key={r[idKey]}>
                  <Td className="font-medium">{r[nameKey]}</Td>
                  <Td right>{r.sessions}</Td>
                  {kind === "coaches" ? <Td right>{num(r.hours, 2)}</Td> : <><Td right>{num(r.hours_booked, 2)}</Td><Td right>{num(r.court_hours, 2)}</Td></>}
                  <Td right>{inr(r.payable)}</Td>
                  <Td right>{inr(r.paid)}</Td>
                  <Td right className="font-semibold">{inr(r.balance)}</Td>
                  <Td><StatusBadge status={r.status} label={r.status === "nothing_due" ? "Nothing due" : undefined} /></Td>
                  <Td right>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setDetail(detail === r[idKey] ? null : r[idKey])}>{detail === r[idKey] ? "Hide" : "Breakdown"}</Button>
                      {Number(r.balance) > 0 && <Button size="sm" onClick={() => setPaying(r)}>Mark paid</Button>}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <div className="p-5"><EmptyState title="No recorded sessions this month" /></div>}
      </Card>
      {detail !== null && (
        <Card className="mb-6">
          <CardHeader title={`Breakdown — ${data.summary.find((r: any) => r[idKey] === detail)?.[nameKey]}`} />
          <Table>
            <thead>
              <tr><Th>Date</Th><Th>Batch</Th>{kind === "coaches" ? <><Th>Venue</Th><Th right>Hours</Th><Th right>Rate</Th><Th right>Adj.</Th></> : <><Th>Slot</Th><Th right>Hours</Th><Th right>Courts</Th><Th right>Rate</Th></>}<Th>Status</Th><Th right>Payable</Th></tr>
            </thead>
            <tbody>
              {data.detail.filter((d: any) => d[idKey] === detail).map((d: any) => (
                <tr key={`${d.session_id}-${d[idKey]}`}>
                  <Td><Link className="text-court-700 hover:underline" to={`/admin/sessions/${d.session_id}`}>{fmtDay(d.date)}</Link></Td>
                  <Td>{d.batch}</Td>
                  {kind === "coaches" ? (
                    <><Td>{d.venue}</Td><Td right>{num(d.hours_coached, 2)}</Td><Td right>{inr(d.rate_applied)}</Td><Td right title={d.adjustment_note ?? ""}>{Number(d.adjustment) ? inr(d.adjustment) : "—"}</Td></>
                  ) : (
                    <><Td>{titleCase(d.day_type)} {d.time_slot}</Td><Td right>{num(d.duration_hours, 2)}</Td><Td right>{d.courts}</Td><Td right>{inr(d.rate_applied)}</Td></>
                  )}
                  <Td><StatusBadge status={d.status} /></Td>
                  <Td right>{inr(d.payable)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      <Card>
        <CardHeader title="Payments recorded for this month" />
        {data.payments.length ? (
          <Table>
            <thead><tr><Th>{kind === "coaches" ? "Coach" : "Venue"}</Th><Th>Paid on</Th><Th>Method</Th><Th>Reference</Th><Th right>Amount</Th><Th /></tr></thead>
            <tbody>
              {data.payments.map((p: any) => (
                <tr key={p.id}>
                  <Td>{p[nameKey]}</Td><Td>{fmtDate(p.paid_on)}</Td><Td>{titleCase(p.method)}</Td><Td>{p.reference_no ?? "—"}</Td><Td right>{inr(p.amount)}</Td>
                  <Td right><ConfirmButton variant="ghost" confirm="Delete this payout record?" onConfirm={() => run(async () => { await api(`/admin/payouts/${kind}/${p.id}`, { method: "DELETE" }); mutate(); }, "Deleted")}>Delete</ConfirmButton></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <p className="p-5 text-sm text-muted">None yet.</p>}
      </Card>
      {paying && (
        <SimpleForm
          title={`Pay ${paying[nameKey]} for ${month}`}
          fields={[
            { name: "amount", label: "Amount (₹)", type: "number", required: true, default: paying.balance },
            { name: "paid_on", label: "Paid on", type: "date", required: true, default: todayISO() },
            { name: "method", label: "Method", type: "select", required: true, default: "bank_transfer", options: PAY_METHODS },
            { name: "reference_no", label: "Reference" },
            { name: "notes", label: "Notes", type: "textarea" },
          ]}
          transform={(b) => ({ ...b, month, [idKey]: paying[idKey] })}
          endpoint={`/admin/payouts/${kind}`}
          onClose={() => setPaying(null)}
          onDone={() => { setPaying(null); mutate(); }}
        />
      )}
    </>
  );
}

function Expenses() {
  const venues = useApi<any[]>("/admin/venues");
  const batches = useApi<any[]>("/admin/batches");
  const categories = ["equipment", "marketing", "staff", "rent", "utilities", "travel", "tournament", "maintenance", "software", "other"].map((v) => ({ value: v, label: titleCase(v) }));
  return (
    <CrudPage
      title="Operating expenses"
      subtitle="Other manually recorded expenses. Coach and court costs are calculated from sessions — don't enter them here."
      endpoint="/admin/expenses"
      singular="expense"
      filters={[{ name: "category", label: "Category", options: categories }, { name: "is_paid", label: "Paid", options: [{ value: "true", label: "Paid" }, { value: "false", label: "Unpaid" }] }]}
      fields={[
        { name: "description", label: "Description", required: true, full: true },
        { name: "category", label: "Category", type: "select", required: true, default: "equipment", options: categories },
        { name: "amount", label: "Amount (₹)", type: "number", required: true },
        { name: "expense_date", label: "Expense date", type: "date", required: true, default: todayISO() },
        { name: "vendor", label: "Vendor" },
        { name: "is_paid", label: "Paid", type: "checkbox", default: true },
        { name: "paid_on", label: "Paid on", type: "date" },
        { name: "reference_no", label: "Reference" },
        { name: "venue_id", label: "Venue (optional)", type: "select", options: (venues.data ?? []).map((v) => ({ value: String(v.id), label: v.name })) },
        { name: "batch_id", label: "Batch (optional)", type: "select", options: (batches.data ?? []).map((b) => ({ value: String(b.id), label: `${b.name} ${b.period_label}` })) },
      ]}
      columns={[
        { key: "expense_date", label: "Date", render: (r) => fmtDate(r.expense_date) },
        { key: "description", label: "Description", render: (r) => <><span className="font-medium">{r.description}</span>{r.vendor && <span className="block text-xs text-muted">{r.vendor}</span>}</> },
        { key: "category", label: "Category", render: (r) => titleCase(r.category) },
        { key: "venue_name", label: "Venue / batch", render: (r) => r.venue_name ?? r.batch_name ?? "—" },
        { key: "is_paid", label: "Status", render: (r) => <StatusBadge status={r.is_paid ? "paid" : "pending"} label={r.is_paid ? "Paid" : "Unpaid"} /> },
        { key: "amount", label: "Amount", right: true, render: (r) => inr(r.amount) },
      ]}
    />
  );
}
