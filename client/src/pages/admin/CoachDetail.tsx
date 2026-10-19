import { useState } from "react";
import { Link, useParams } from "react-router";

import { EntityForm } from "@/components/admin/crud";
import { COACH_FIELDS } from "@/components/admin/fields";
import { SimpleForm } from "@/components/admin/forms";
import { Button, Card, CardHeader, ErrorNote, Loading, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { ConfirmButton, useAction } from "@/components/ui-client";
import { api, useApi } from "@/lib/api";
import { fmtDate, inr, num, todayISO } from "@/lib/format";

export default function CoachDetail() {
  const { id } = useParams();
  const { data: c, error, mutate } = useApi<any>(`/admin/coaches/${id}`);
  const [modal, setModal] = useState<null | "edit" | "rate" | "password">(null);
  const { run } = useAction();
  if (error) return <ErrorNote error={error} />;
  if (!c) return <Loading />;
  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={`${c.title ?? "Coach"} · ${c.mobile}`}
        back={{ href: "/admin/coaches", label: "Coaches" }}
        actions={
          <>
            <Button variant="secondary" onClick={() => setModal("password")}>{c.has_login ? "Reset password" : "Enable login"}</Button>
            <Button variant="secondary" onClick={() => setModal("edit")}>Edit profile</Button>
            <Button onClick={() => setModal("rate")}>Change rate</Button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Current rate" value={c.current_rate != null ? `${inr(c.current_rate)}/h` : "Not set"} tone={c.current_rate == null ? "bad" : undefined} />
        <Stat label="Hours this month" value={num(c.month_hours)} />
        <Stat label="Payable this month" value={inr(c.month_payable)} hint={<Link className="underline" to="/admin/finance?tab=coaches">Payouts</Link>} />
        <Stat label="Status" value={<StatusBadge status={c.profile_status} />} hint={c.is_public ? "Shown on website" : "Hidden from website"} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Rate history" subtitle="Each session keeps the rate in force on its date, so changes never rewrite past pay." />
          <Table>
            <thead><tr><Th>From</Th><Th>To</Th><Th right>Hourly rate</Th><Th /></tr></thead>
            <tbody>
              {c.rates.map((r: any) => (
                <tr key={r.id}>
                  <Td>{fmtDate(r.effective_from)}</Td>
                  <Td>{r.effective_to ? fmtDate(r.effective_to) : "Current"}</Td>
                  <Td right>{inr(r.hourly_rate)}</Td>
                  <Td right><ConfirmButton variant="ghost" confirm="Delete this rate row? Sessions already recorded keep their rate." onConfirm={() => run(async () => { await api(`/admin/coaches/${c.id}/rates/${r.id}`, { method: "DELETE" }); mutate(); })}>Delete</ConfirmButton></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Assigned batches" />
          {c.assigned_batches.length ? (
            <ul className="divide-y divide-line">
              {c.assigned_batches.map((b: any) => (
                <li key={b.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <Link to={`/admin/batches/${b.id}`} className="font-medium text-court-700 hover:underline">{b.name} {b.period_label && <span className="text-muted">({b.period_label})</span>}</Link>
                  <StatusBadge status={b.status} />
                </li>
              ))}
            </ul>
          ) : <p className="p-5 text-sm text-muted">No batches assigned.</p>}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Payments made" />
          {c.payouts.length ? (
            <Table>
              <thead><tr><Th>For month</Th><Th>Paid on</Th><Th>Method</Th><Th>Reference</Th><Th right>Amount</Th></tr></thead>
              <tbody>
                {c.payouts.map((p: any) => (
                  <tr key={p.id}><Td>{fmtDate(p.period_month, { day: undefined })}</Td><Td>{fmtDate(p.paid_on)}</Td><Td>{p.method}</Td><Td>{p.reference_no ?? "—"}</Td><Td right>{inr(p.amount)}</Td></tr>
                ))}
              </tbody>
            </Table>
          ) : <p className="p-5 text-sm text-muted">No payments recorded.</p>}
        </Card>
      </div>
      {modal === "edit" && (
        <EntityForm title="Edit coach" fields={[...COACH_FIELDS, { name: "profile_status", label: "Coach status", type: "select", required: true, options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] }]}
          row={c} endpoint="/admin/coaches" onClose={() => setModal(null)} onSaved={() => { setModal(null); mutate(); }} />
      )}
      {modal === "rate" && (
        <SimpleForm title="Set hourly rate" fields={[
          { name: "hourly_rate", label: "Hourly rate (₹)", type: "number", required: true },
          { name: "effective_from", label: "Effective from", type: "date", required: true, default: todayISO(), hint: "The previous rate ends the day before" },
        ]} endpoint={`/admin/coaches/${c.id}/rates`} onClose={() => setModal(null)} onDone={() => { setModal(null); mutate(); }} />
      )}
      {modal === "password" && (
        <SimpleForm title="Set password" fields={[{ name: "new_password", label: "New password", required: true }]} endpoint={`/admin/users/${c.id}/password`}
          onClose={() => setModal(null)} onDone={() => { setModal(null); mutate(); }} />
      )}
    </>
  );
}
