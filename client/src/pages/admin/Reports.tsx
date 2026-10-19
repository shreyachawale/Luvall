import { Download } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { FinanceChart, HBarChart } from "@/components/admin/charts";
import { MonthPicker } from "@/components/portal/month-picker";
import { Card, CardHeader, ErrorNote, Field, Input, Loading, PageHeader, Select, Stat, StatusBadge, Table, Td, Th, buttonClass } from "@/components/ui";
import { Tabs } from "@/components/ui-client";
import { qs, useApi } from "@/lib/api";
import { inr, monthISO, num } from "@/lib/format";

type Kind = "batches" | "coaches" | "venues" | "students" | "monthly";

export default function ReportsPage() {
  const [mode, setMode] = useState<"month" | "range">("month");
  const [month, setMonth] = useState(monthISO());
  const [range, setRange] = useState({ start: "", end: "" });
  const [filters, setFilters] = useState({ coach_id: "", venue_id: "", batch_id: "" });
  const [kind, setKind] = useState<Kind>("batches");
  const coaches = useApi<any[]>("/admin/coaches?include_inactive=true");
  const venues = useApi<any[]>("/admin/venues");
  const batches = useApi<any[]>("/admin/batches");
  const periodQs = mode === "month" ? { month } : { start: range.start, end: range.end };
  const query = qs({ ...periodQs, ...filters });
  const fin = useApi<any>(mode === "range" && (!range.start || !range.end) ? null : `/admin/reports/finance${query}`);
  const rep = useApi<any>(mode === "range" && (!range.start || !range.end) ? null : `/admin/reports/${kind}${query}`);
  const s = fin.data?.summary;
  const exportLink = (format: "csv" | "xlsx", detail = false) => `/api/v1/admin/reports/${kind}/export${qs({ ...periodQs, ...filters, format, detail: detail || null })}`;

  return (
    <>
      <PageHeader title="Reports" subtitle="Cash collected, amounts billed, credits and expenses payable are shown separately — never mixed." />
      <Card className="mb-6 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[auto_1fr_1fr_1fr]">
        <div className="flex flex-col gap-2">
          <div className="flex gap-1 text-sm">
            <button className={buttonClass(mode === "month" ? "primary" : "secondary", "sm")} onClick={() => setMode("month")}>Month</button>
            <button className={buttonClass(mode === "range" ? "primary" : "secondary", "sm")} onClick={() => setMode("range")}>Date range</button>
          </div>
          {mode === "month" ? <MonthPicker value={month} onChange={setMonth} /> : (
            <div className="flex gap-2">
              <Input type="date" aria-label="Start" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
              <Input type="date" aria-label="End" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} />
            </div>
          )}
        </div>
        <Field label="Coach"><Select value={filters.coach_id} onChange={(e) => setFilters({ ...filters, coach_id: e.target.value })}><option value="">All coaches</option>{coaches.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Venue"><Select value={filters.venue_id} onChange={(e) => setFilters({ ...filters, venue_id: e.target.value })}><option value="">All venues</option>{venues.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></Field>
        <Field label="Batch"><Select value={filters.batch_id} onChange={(e) => setFilters({ ...filters, batch_id: e.target.value })}><option value="">All batches</option>{batches.data?.map((b) => <option key={b.id} value={b.id}>{b.name} {b.period_label}</option>)}</Select></Field>
      </Card>
      <ErrorNote error={fin.error ?? rep.error} />
      {mode === "range" && (!range.start || !range.end) && <p className="text-sm text-muted">Choose a start and end date.</p>}
      {s && (
        <>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Income</h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Billed (fees charged)" value={inr(s.income.billed)} hint="Packages + drop-in fees" />
            <Stat label="Cash collected" value={inr(s.income.cash_collected)} tone="good" hint="Verified payments" />
            <Stat label="Credits issued" value={inr(s.income.credits_issued)} hint="Refund credits + carry-forwards" />
            <Stat label="Refunds paid out" value={inr(s.income.refunds_paid)} />
          </div>
          <h2 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-muted">Expenses</h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Coach payable" value={inr(s.expenses.coach_payable)} hint={`Paid ${inr(s.expenses.coach_paid)}`} />
            <Stat label="Venue / court payable" value={inr(s.expenses.venue_payable)} hint={`Paid ${inr(s.expenses.venue_paid)}`} />
            <Stat label="Other expenses" value={inr(s.expenses.other_expenses)} hint={`Paid ${inr(s.expenses.other_expenses_paid)}`} />
            <Stat label="Total payable" value={inr(s.expenses.total_payable)} tone="warn" />
          </div>
          <h2 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-muted">Result & position</h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Operating surplus" value={inr(s.net.operating_surplus)} tone={s.net.operating_surplus < 0 ? "bad" : "good"} hint="Billed − total payable" />
            <Stat label="Net cash flow" value={inr(s.net.net_cash_flow)} tone={s.net.net_cash_flow < 0 ? "bad" : "good"} hint="Cash in − cash out" />
            <Stat label="Outstanding student dues" value={inr(s.receivables.outstanding_balances)} hint={`${s.receivables.students_with_dues} students · as of today`} tone={s.receivables.outstanding_balances > 0 ? "bad" : undefined} />
            <Stat label="Pending verification" value={inr(s.receivables.pending_verification_amount)} hint={<Link to="/admin/finance" className="underline">{s.receivables.pending_verification_count} payments</Link>} />
          </div>
          <div className="mt-2 text-xs text-muted">
            Liabilities: coaches unpaid {inr(s.liabilities.coach_unpaid)} · venues unpaid {inr(s.liabilities.venue_unpaid)} · other unpaid {inr(s.liabilities.other_unpaid)} · student credit held {inr(s.liabilities.student_credit_held)}
            {(filters.batch_id || filters.coach_id || filters.venue_id) && " · Coach/venue payouts are recorded per month and are not split by batch filter."}
          </div>
          <Card className="mt-6">
            <CardHeader title="Income and expenses over time" subtitle="6 months ending with the selected period" />
            <div className="p-4"><FinanceChart series={fin.data.series} /></div>
          </Card>
        </>
      )}

      <div className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Tabs<Kind>
            value={kind}
            onChange={setKind}
            tabs={[
              { value: "batches", label: "Batch revenue & occupancy" },
              { value: "coaches", label: "Coach hours & payable" },
              { value: "venues", label: "Venue usage & payable" },
              { value: "students", label: "Student fees & attendance" },
              { value: "monthly", label: "Monthly summary" },
            ]}
          />
          <div className="mb-4 flex flex-wrap gap-2">
            <a className={buttonClass("secondary", "sm")} href={exportLink("csv")}><Download size={14} /> CSV</a>
            <a className={buttonClass("secondary", "sm")} href={exportLink("xlsx")}><Download size={14} /> Excel</a>
            {(kind === "coaches" || kind === "venues") && <a className={buttonClass("secondary", "sm")} href={exportLink("xlsx", true)}><Download size={14} /> Session detail (Excel)</a>}
          </div>
        </div>
        {!rep.data ? <Loading /> : <ReportTable kind={kind} rows={rep.data.rows} />}
      </div>
    </>
  );
}

function ReportTable({ kind, rows }: { kind: Kind; rows: any[] }) {
  if (!rows.length) return <Card className="p-6 text-sm text-muted">No data for this period.</Card>;
  if (kind === "batches") {
    return (
      <div className="space-y-6">
        <Card className="p-4"><h3 className="mb-2 text-sm font-semibold">Occupancy (%)</h3><HBarChart rows={rows} labelKey="batch" valueKey="occupancy_pct" /></Card>
        <Card>
          <Table>
            <thead><tr><Th>Batch</Th><Th>Status</Th><Th right>Enrolled / cap.</Th><Th right>Occupancy</Th><Th right>Sessions done</Th><Th right>Cancelled</Th><Th right>Attendance</Th><Th right>Billed</Th><Th right>Collected</Th><Th right>Coach cost</Th><Th right>Court cost</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.batch_id}>
                  <Td><Link className="font-medium text-court-700 hover:underline" to={`/admin/batches/${r.batch_id}`}>{r.batch}</Link><span className="block text-xs text-muted">{r.code} {r.period}</span></Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td right>{r.enrolled}/{r.capacity}</Td><Td right>{r.occupancy_pct}%</Td><Td right>{r.sessions_completed}</Td><Td right>{r.sessions_cancelled}</Td>
                  <Td right>{r.attendance_pct != null ? `${r.attendance_pct}%` : "—"}</Td>
                  <Td right>{inr(r.billed)}</Td><Td right>{inr(r.collected)}</Td><Td right>{inr(r.coach_payable)}</Td><Td right>{inr(r.venue_payable)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    );
  }
  if (kind === "coaches") {
    return (
      <Card>
        <Table>
          <thead><tr><Th>Coach</Th><Th right>Sessions</Th><Th right>Hours</Th><Th right>Payable</Th><Th right>Paid</Th><Th right>Balance</Th><Th>Status</Th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.coach_id}><Td className="font-medium">{r.coach}</Td><Td right>{r.sessions}</Td><Td right>{num(r.hours, 2)}</Td><Td right>{inr(r.payable)}</Td><Td right>{inr(r.paid)}</Td><Td right>{inr(r.balance)}</Td><Td><StatusBadge status={r.status} /></Td></tr>)}</tbody>
        </Table>
      </Card>
    );
  }
  if (kind === "venues") {
    return (
      <Card>
        <Table>
          <thead><tr><Th>Venue</Th><Th right>Sessions</Th><Th right>Hours booked</Th><Th right>Court-hours</Th><Th right>Payable</Th><Th right>Paid</Th><Th right>Balance</Th><Th>Status</Th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.venue_id}><Td className="font-medium">{r.venue}</Td><Td right>{r.sessions}</Td><Td right>{num(r.hours_booked, 2)}</Td><Td right>{num(r.court_hours, 2)}</Td><Td right>{inr(r.payable)}</Td><Td right>{inr(r.paid)}</Td><Td right>{inr(r.balance)}</Td><Td><StatusBadge status={r.status} /></Td></tr>)}</tbody>
        </Table>
      </Card>
    );
  }
  if (kind === "students") {
    return (
      <Card>
        <Table>
          <thead><tr><Th>Student</Th><Th right>Billed</Th><Th right>Paid</Th><Th right>Credits</Th><Th right>Refunds</Th><Th right>Balance</Th><Th right>Present</Th><Th right>Make-ups</Th><Th right>Absent</Th><Th right>Cancelled</Th><Th right>Sessions left</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.student_id}>
                <Td><Link className="font-medium text-court-700 hover:underline" to={`/admin/students/${r.student_id}`}>{r.student}</Link></Td>
                <Td right>{inr(r.billed)}</Td><Td right>{inr(r.paid)}</Td><Td right>{inr(r.credits)}</Td><Td right>{inr(r.refunds)}</Td>
                <Td right className={r.balance < 0 ? "font-semibold text-red-700" : ""}>{inr(r.balance)}</Td>
                <Td right>{r.present}</Td><Td right>{r.makeups}</Td><Td right>{r.absent}</Td><Td right>{r.cancelled}</Td><Td right>{r.sessions_remaining}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    );
  }
  return (
    <Card>
      <Table>
        <thead><tr><Th>Month</Th><Th right>Billed</Th><Th right>Cash collected</Th><Th right>Coach payable</Th><Th right>Venue payable</Th><Th right>Other</Th><Th right>Surplus</Th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.month}><Td className="font-medium">{r.label}</Td><Td right>{inr(r.billed)}</Td><Td right>{inr(r.cash_collected)}</Td><Td right>{inr(r.coach_payable)}</Td><Td right>{inr(r.venue_payable)}</Td><Td right>{inr(r.other_expenses)}</Td><Td right className={r.operating_surplus < 0 ? "text-red-700" : "text-court-700"}>{inr(r.operating_surplus)}</Td></tr>)}</tbody>
      </Table>
    </Card>
  );
}
