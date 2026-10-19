import { AlertTriangle, ChevronRight, Info } from "lucide-react";
import { Link } from "react-router";

import { FinanceChart } from "@/components/admin/charts";
import { SessionList } from "@/components/portal/session-list";
import { Card, CardHeader, ErrorNote, LinkButton, Loading, PageHeader, Stat, cx } from "@/components/ui";
import { useApi } from "@/lib/api";
import { inr } from "@/lib/format";

export default function AdminOverview() {
  const { data, error } = useApi<any>("/admin/overview");
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const s = data.summary;
  return (
    <>
      <PageHeader title="Overview" subtitle={`${data.month} at a glance`} actions={<LinkButton to="/admin/reports" variant="secondary">Full financial report</LinkButton>} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Billed this month" value={inr(s.income.billed)} hint="Fees charged (accrual)" />
        <Stat label="Cash collected" value={inr(s.income.cash_collected)} hint="Verified payments" tone="good" />
        <Stat label="Expenses payable" value={inr(s.expenses.total_payable)} hint="Coaches + courts + other" tone="warn" />
        <Stat label="Operating surplus" value={inr(s.net.operating_surplus)} tone={s.net.operating_surplus < 0 ? "bad" : "good"} hint="Billed − payable" />
        <Stat label="Outstanding dues" value={inr(s.receivables.outstanding_balances)} hint={`${s.receivables.students_with_dues} students`} tone={s.receivables.outstanding_balances > 0 ? "bad" : undefined} />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Income & expenses" subtitle="Last 6 months" />
          <div className="p-4"><FinanceChart series={data.series} /></div>
        </Card>
        <Card>
          <CardHeader title="Needs attention" />
          {data.alerts.length ? (
            <ul className="divide-y divide-line">
              {data.alerts.map((a: any) => (
                <li key={a.text}>
                  <Link to={a.link} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-court-50">
                    {a.level === "info" ? <Info size={18} className="shrink-0 text-sky-600" /> : <AlertTriangle size={18} className={cx("shrink-0", a.level === "danger" ? "text-red-600" : "text-amber-600")} />}
                    <span className="flex-1"><strong className="num">{a.count}</strong> {a.text}</span>
                    <ChevronRight size={16} className="text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="px-5 py-4 text-sm text-muted">All clear. Nothing needs attention.</p>}
        </Card>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Next 3 days" action={<Link to="/admin/sessions" className="text-sm font-semibold text-court-700">All sessions</Link>} />
          <SessionList sessions={data.upcoming_sessions} hrefBase="/admin/sessions" empty="No sessions in the next 3 days." />
        </Card>
        <div className="grid gap-4">
          <Stat label="Active students" value={data.counts.active_students} />
          <Stat label="Active enrollments" value={data.counts.active_enrollments} />
          <Stat label="Coach payable (unpaid)" value={inr(s.liabilities.coach_unpaid)} hint={<Link className="underline" to="/admin/finance?tab=coaches">Pay coaches</Link>} />
          <Stat label="Venue payable (unpaid)" value={inr(s.liabilities.venue_unpaid)} hint={<Link className="underline" to="/admin/finance?tab=venues">Pay venues</Link>} />
        </div>
      </div>
    </>
  );
}
