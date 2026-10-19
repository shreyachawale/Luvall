import { useState } from "react";
import { Link } from "react-router";

import { MonthPicker } from "@/components/portal/month-picker";
import { Card, ErrorNote, Loading, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDay, inr, monthISO, num } from "@/lib/format";

export default function CoachHours() {
  const [month, setMonth] = useState(monthISO());
  const { data, error } = useApi<any>(`/coach/hours?month=${month}`);
  return (
    <>
      <PageHeader title="Hours & earnings" subtitle="Coach payable = actual hours × the rate in force on the session date (+ any adjustments)." actions={<MonthPicker value={month} onChange={setMonth} />} />
      <ErrorNote error={error} />
      {!data ? <Loading /> : (
        <>
          <div className="mb-6 grid grid-cols-3 gap-4">
            <Stat label="Sessions" value={data.totals.sessions} />
            <Stat label="Hours" value={num(data.totals.hours)} />
            <Stat label="Payable" value={inr(data.totals.payable)} />
          </div>
          <Card>
            {data.sessions.length ? (
              <Table>
                <thead><tr><Th>Date</Th><Th>Batch</Th><Th>Venue</Th><Th>Status</Th><Th right>Hours</Th><Th right>Rate</Th><Th right>Adj.</Th><Th right>Payable</Th></tr></thead>
                <tbody>
                  {data.sessions.map((r: any) => (
                    <tr key={r.session_id}>
                      <Td><Link to={`/coach/sessions/${r.session_id}`} className="underline">{fmtDay(r.date)}</Link></Td>
                      <Td>{r.batch}</Td>
                      <Td>{r.venue}</Td>
                      <Td><StatusBadge status={r.status} /></Td>
                      <Td right>{num(r.hours_coached, 2)}</Td>
                      <Td right>{inr(r.rate_applied)}</Td>
                      <Td right title={r.adjustment_note ?? ""}>{Number(r.adjustment) ? inr(r.adjustment) : "—"}</Td>
                      <Td right className="font-semibold">{inr(r.payable)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <p className="p-5 text-sm text-muted">No recorded sessions this month.</p>}
          </Card>
        </>
      )}
    </>
  );
}
