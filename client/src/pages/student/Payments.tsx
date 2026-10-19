import { useState } from "react";

import { UpiPanel } from "@/components/portal/upi";
import { Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, Loading, PageHeader, Select, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { Modal, useAction } from "@/components/ui-client";
import { LedgerTable, PlanUsage } from "@/components/portal/finance";
import { api, uploadImage, useApi } from "@/lib/api";
import { fmtDate, inr, todayISO } from "@/lib/format";

export default function StudentPayments() {
  const plans = useApi<any[]>("/student/plans");
  const payments = useApi<any[]>("/student/payments");
  const ledger = useApi<any>("/student/ledger");
  const site = useApi<any>("/public/site");
  const [open, setOpen] = useState(false);
  if (plans.error || payments.error || ledger.error) return <ErrorNote error={plans.error ?? payments.error ?? ledger.error} />;
  if (!plans.data || !payments.data || !ledger.data) return <Loading />;
  const bal = ledger.data.closing_balance;
  const active = plans.data.filter((p) => ["active", "pending"].includes(p.status));
  return (
    <>
      <PageHeader title="Package & payments" subtitle="Your packages, sessions remaining, payments and full account statement." actions={<Button onClick={() => setOpen(true)}>Report a UPI payment</Button>} />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label={bal < 0 ? "Outstanding balance" : "Account credit"} value={inr(Math.abs(bal))} tone={bal < 0 ? "bad" : "good"} hint={bal < 0 ? "Please pay to keep your seat confirmed" : "Applied to your next package"} />
        <Stat label="Sessions remaining" value={active.filter((p) => p.status === "active").reduce((s, p) => s + p.usage.remaining, 0)} />
        <Stat label="Pending verification" value={payments.data.filter((p) => p.status === "pending").length} hint="Payments waiting for the academy to verify" />
      </div>
      <Card className="mb-6">
        <CardHeader title="Packages" />
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
          {plans.data.length ? plans.data.map((p) => <PlanUsage key={p.id} plan={p} />) : <EmptyState title="No packages yet" />}
        </div>
      </Card>
      <Card className="mb-6">
        <CardHeader title="Payment history" />
        {payments.data.length ? (
          <Table>
            <thead><tr><Th>Date</Th><Th>For</Th><Th>Method</Th><Th>Reference</Th><Th>Status</Th><Th right>Amount</Th></tr></thead>
            <tbody>
              {payments.data.map((p) => (
                <tr key={p.id}>
                  <Td>{fmtDate(p.payment_date)}</Td>
                  <Td>{p.plan_name ?? "Account"}</Td>
                  <Td>{p.method.toUpperCase()}</Td>
                  <Td className="font-mono text-xs">{p.reference_no ?? "—"}</Td>
                  <Td><StatusBadge status={p.status} />{p.rejection_reason && <span className="block text-xs text-red-700">{p.rejection_reason}</span>}</Td>
                  <Td right>{inr(p.amount)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <p className="p-5 text-sm text-muted">No payments yet.</p>}
      </Card>
      <Card>
        <CardHeader title="Account statement" subtitle="Charges, credits, refunds and carry-forwards" />
        <LedgerTable ledger={ledger.data} />
      </Card>
      {open && site.data && (
        <ReportPayment plans={active} payment={site.data.payment} dueAmount={bal < 0 ? -bal : null} onClose={() => setOpen(false)} onDone={() => { setOpen(false); payments.mutate(); }} />
      )}
    </>
  );
}

function ReportPayment({ plans, payment, dueAmount, onClose, onDone }: { plans: any[]; payment: any; dueAmount: number | null; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [proof, setProof] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title="Report a UPI payment">
      <form
        id="pay-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(async () => {
            await api("/student/payments", {
              body: {
                amount: Number(f.get("amount")),
                reference_no: f.get("reference_no"),
                payment_date: f.get("payment_date"),
                student_fee_plan_id: f.get("plan") || null,
                proof_url: proof,
              },
            });
            onDone();
          }, "Payment submitted for verification");
        }}
      >
        <UpiPanel payment={payment} amount={dueAmount} />
        {plans.length > 0 && (
          <Field label="Paying for">
            <Select name="plan" defaultValue={plans[0]?.id}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({inr(p.final_fee)})</option>)}
              <option value="">Outstanding balance / other</option>
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Amount (₹)" required><Input name="amount" type="number" min={1} step="0.01" required defaultValue={dueAmount ?? ""} /></Field>
          <Field label="Date" required><Input name="payment_date" type="date" required defaultValue={todayISO()} max={todayISO()} /></Field>
        </div>
        <Field label="UTR / reference" required><Input name="reference_no" required minLength={4} /></Field>
        <Field label="Screenshot (optional)">
          <Input type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setProof((await uploadImage(file, "/student/payment-proof")).url); }} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>Submit</Button>
        </div>
      </form>
    </Modal>
  );
}
