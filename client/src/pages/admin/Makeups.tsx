import { useState } from "react";
import { Link, useSearchParams } from "react-router";

import { SimpleForm } from "@/components/admin/forms";
import { Button, Card, EmptyState, ErrorNote, Loading, Notice, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { Modal, Tabs, useAction } from "@/components/ui-client";
import { api, qs, useApi } from "@/lib/api";
import { fmtDate, fmtDay, timeRange } from "@/lib/format";

const TABS = [
  { value: "pending_approval", label: "Pending approval" },
  { value: "available", label: "Available" },
  { value: "booked", label: "Booked" },
  { value: "used", label: "Used" },
  { value: "expired", label: "Expired" },
  { value: "", label: "All" },
];

export default function Makeups() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("status") ?? "available");
  const student = params.get("student");
  const { data, error, mutate } = useApi<any>(`/admin/makeups${qs({ status: tab, student_id: student, page_size: 200 })}`);
  const { data: settings } = useApi<any>("/admin/settings");
  const [booking, setBooking] = useState<any>(null);
  const [extending, setExtending] = useState<any>(null);
  const { busy, run } = useAction();
  const post = (path: string, body?: unknown, msg = "Done") => run(async () => { await api(path, { method: "POST", body }); mutate(); }, msg);
  return (
    <>
      <PageHeader title="Make-ups" subtitle="Missed sessions, eligibility, bookings and usage. Make-up attendance keeps both the original and attended batch." />
      {settings && (
        <div className="mb-4">
          <Notice>
            Policy: {settings.makeup.eligible_on_absence ? "every absence creates a make-up" : "make-ups are granted manually"}
            {settings.makeup.requires_approval ? ", admin approval required" : ""}
            {settings.makeup.expiry_days ? `, expires after ${settings.makeup.expiry_days} days` : ", no expiry"}
            {settings.makeup.student_can_book ? ", students can self-book" : ", admin books"}. <Link to="/admin/settings" className="font-semibold underline">Change policy</Link>
          </Notice>
        </div>
      )}
      <Tabs tabs={TABS.map((t) => ({ ...t, label: `${t.label}${t.value && data?.counts?.[t.value] ? ` (${data.counts[t.value]})` : ""}` }))} value={tab} onChange={setTab} />
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.items.length === 0 ? <EmptyState title="Nothing here" /> : (
        <Card>
          <Table>
            <thead><tr><Th>Student</Th><Th>Missed</Th><Th>Original batch</Th><Th>Expires</Th><Th>Booked / used</Th><Th>Status</Th><Th right>Actions</Th></tr></thead>
            <tbody>
              {data.items.map((c: any) => (
                <tr key={c.id}>
                  <Td><Link to={`/admin/students/${c.student_id}`} className="font-medium text-court-700 hover:underline">{c.student_name}</Link></Td>
                  <Td>{fmtDay(c.missed_session_date)}</Td>
                  <Td>{c.original_batch_name}</Td>
                  <Td>{fmtDate(c.expires_on)}</Td>
                  <Td className="text-xs">{(c.used_session ?? c.booked_session) ? `${(c.used_session ?? c.booked_session).batch_name} · ${fmtDay((c.used_session ?? c.booked_session).session_date)}` : "—"}</Td>
                  <Td><StatusBadge status={c.status} />{c.note && <span className="block text-xs text-muted">{c.note}</span>}</Td>
                  <Td right>
                    <div className="flex justify-end gap-1">
                      {c.status === "pending_approval" && (
                        <>
                          <Button size="sm" disabled={busy} onClick={() => post(`/admin/makeups/${c.id}/decide`, { approve: true }, "Approved")}>Approve</Button>
                          <Button size="sm" variant="danger" disabled={busy} onClick={() => post(`/admin/makeups/${c.id}/decide`, { approve: false, note: "Not eligible" }, "Rejected")}>Reject</Button>
                        </>
                      )}
                      {c.status === "available" && <Button size="sm" onClick={() => setBooking(c)}>Book</Button>}
                      {c.status === "booked" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => post(`/admin/makeups/${c.id}/cancel-booking`, undefined, "Booking cancelled")}>Unbook</Button>}
                      {["available", "expired", "booked", "pending_approval"].includes(c.status) && <Button size="sm" variant="ghost" onClick={() => setExtending(c)}>Expiry</Button>}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {booking && <BookFor credit={booking} onClose={() => setBooking(null)} onDone={() => { setBooking(null); mutate(); }} />}
      {extending && (
        <SimpleForm title="Change expiry" fields={[{ name: "expires_on", label: "Expires on", type: "date", hint: "Leave empty for no expiry" }]} initial={{ expires_on: extending.expires_on }}
          endpoint={`/admin/makeups/${extending.id}/extend`} onClose={() => setExtending(null)} onDone={() => { setExtending(null); mutate(); }} />
      )}
    </>
  );
}

function BookFor({ credit, onClose, onDone }: { credit: any; onClose: () => void; onDone: () => void }) {
  const { data, error } = useApi<any[]>(`/admin/makeups/${credit.id}/options`);
  const { busy, run } = useAction();
  return (
    <Modal open onClose={onClose} title={`Book a make-up for ${credit.student_name}`} wide>
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.length === 0 ? <EmptyState title="No sessions with free spots before expiry" /> : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {data.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span><strong>{fmtDay(s.session_date)}</strong> · {timeRange(s.start_time, s.end_time)} · {s.batch_name} · {s.venue_name}</span>
              <Button size="sm" disabled={busy} onClick={() => run(async () => { await api(`/admin/makeups/${credit.id}/book`, { body: { session_id: s.id } }); onDone(); }, "Booked")}>Book</Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
