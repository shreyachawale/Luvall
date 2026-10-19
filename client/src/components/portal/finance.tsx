import { StatusBadge, Table, Td, Th } from "@/components/ui";
import { fmtDate, inr, titleCase } from "@/lib/format";

export function PlanUsage({ plan }: { plan: any }) {
  const u = plan.usage;
  const pct = Math.min(100, Math.round(((u.used + u.refunded) / Math.max(u.sessions_included, 1)) * 100));
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{plan.name}</p>
          <p className="text-xs text-muted">{plan.batch_name ?? "Any batch"} · {fmtDate(plan.start_date)} – {fmtDate(plan.end_date)}</p>
        </div>
        <StatusBadge status={plan.status} />
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-court-600" style={{ width: `${pct}%` }} /></div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-muted">Included</dt><dd className="num font-semibold">{u.sessions_included}</dd></div>
        <div><dt className="text-xs text-muted">Used</dt><dd className="num font-semibold">{u.used}</dd></div>
        <div><dt className="text-xs text-muted">Remaining</dt><dd className="num font-semibold text-court-700">{u.remaining}</dd></div>
        <div><dt className="text-xs text-muted">Package value</dt><dd className="num font-semibold">{inr(plan.final_fee)}</dd></div>
      </dl>
      {(u.makeups_attended > 0 || u.carried_forward > 0 || u.refunded > 0) && (
        <p className="mt-2 text-xs text-muted">
          {u.makeups_attended > 0 && `${u.makeups_attended} make-up(s) attended · `}
          {u.carried_forward > 0 && `${u.carried_forward} cancelled session(s) carried forward · `}
          {u.refunded > 0 && `${u.refunded} cancelled session(s) refunded`}
        </p>
      )}
      {plan.discount_type !== "none" && (
        <p className="mt-1 text-xs text-muted">Base fee {inr(plan.base_fee)} with {plan.discount_type === "percent" ? `${plan.discount_value}%` : inr(plan.discount_value)} discount</p>
      )}
    </div>
  );
}

export function LedgerTable({ ledger }: { ledger: any }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 border-b border-line p-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Opening", ledger.opening_balance],
          ["Charges", -ledger.charges],
          ["Payments", ledger.payments],
          ["Credits", ledger.credits],
          ["Refunds paid", -ledger.refunds],
          ["Closing", ledger.closing_balance],
        ].map(([label, v]) => (
          <div key={label as string}>
            <p className="text-xs text-muted">{label}</p>
            <p className={`num font-semibold ${Number(v) < 0 ? "text-red-700" : ""}`}>{inr(v as number)}</p>
          </div>
        ))}
      </div>
      {ledger.entries.length ? (
        <Table>
          <thead><tr><Th>Date</Th><Th>Description</Th><Th>Type</Th><Th right>Amount</Th></tr></thead>
          <tbody>
            {ledger.entries.map((e: any) => (
              <tr key={e.id}>
                <Td>{fmtDate(e.txn_date)}</Td>
                <Td>{e.description}</Td>
                <Td className="text-muted">{titleCase(e.txn_type)}</Td>
                <Td right className={e.amount < 0 ? "text-red-700" : "text-court-700"}>{e.amount > 0 ? "+" : ""}{inr(e.amount, true)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <p className="p-4 text-sm text-muted">No transactions yet.</p>}
    </>
  );
}
