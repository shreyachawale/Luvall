import { useState } from "react";

import { Badge, Button, Card, EmptyState, ErrorNote, Loading, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { Modal, useAction } from "@/components/ui-client";
import { api, useApi } from "@/lib/api";
import { fmtDate, fmtDay, timeRange, titleCase } from "@/lib/format";

export default function StudentMakeups() {
  const { data, error, mutate } = useApi<any>("/student/makeups");
  const [booking, setBooking] = useState<any>(null);
  const { busy, run } = useAction();
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const policy = data.policy;
  const open = data.items.filter((c: any) => ["available", "booked", "pending_approval"].includes(c.status));
  const closed = data.items.filter((c: any) => !["available", "booked", "pending_approval"].includes(c.status));
  return (
    <>
      <PageHeader title="Make-up sessions" subtitle="Missed a session? Use a make-up to attend another batch's session." />
      <div className="mb-6">
        <Notice>
          Make-ups {policy.expiry_days ? `must be used within ${policy.expiry_days} days of the missed session` : "do not expire"}
          {policy.requires_approval ? " and are approved by the academy first" : ""}.
          {policy.student_can_book ? ` You can book up to ${policy.booking_cutoff_hours} hours before a session starts.` : " The academy books make-ups for you — contact the admin."}
        </Notice>
      </div>
      {open.length === 0 ? (
        <EmptyState title="No make-ups available">When you miss a regular session, a make-up appears here.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {open.map((c: any) => (
            <Card key={c.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-muted">Missed {fmtDay(c.missed_session_date)}</p>
                  <p className="font-semibold">{c.original_batch_name}</p>
                </div>
                <StatusBadge status={c.status} />
              </div>
              {c.expires_on && <p className="mt-2 text-sm text-muted">Use by {fmtDate(c.expires_on)}</p>}
              {c.status === "booked" && c.booked_session && (
                <div className="mt-3 rounded-xl bg-ball-100 p-3 text-sm">
                  Booked: <strong>{c.booked_session.batch_name}</strong> on {fmtDay(c.booked_session.session_date)},{" "}
                  {timeRange(c.booked_session.start_time, c.booked_session.end_time)} at {c.booked_session.venue_name}
                </div>
              )}
              <div className="mt-4 flex gap-2">
                {c.status === "available" && policy.student_can_book && <Button size="sm" onClick={() => setBooking(c)}>Book a session</Button>}
                {c.status === "booked" && policy.student_can_book && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(async () => { await api(`/student/makeups/${c.id}/cancel`, { method: "POST" }); mutate(); }, "Booking cancelled")}>
                    Cancel booking
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {closed.length > 0 && (
        <>
          <h2 className="mb-3 mt-10 text-lg font-semibold">History</h2>
          <Card>
            <ul className="divide-y divide-line">
              {closed.map((c: any) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span>Missed {fmtDay(c.missed_session_date)} · {c.original_batch_name}{c.used_session ? ` → attended ${c.used_session.batch_name} on ${fmtDay(c.used_session.session_date)}` : ""}</span>
                  <StatusBadge status={c.status} />
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
      {booking && <BookModal credit={booking} onClose={() => setBooking(null)} onBooked={() => { setBooking(null); mutate(); }} />}
    </>
  );
}

function BookModal({ credit, onClose, onBooked }: { credit: any; onClose: () => void; onBooked: () => void }) {
  const { data, error } = useApi<any[]>(`/student/makeups/${credit.id}/options`);
  const { busy, run } = useAction();
  return (
    <Modal open onClose={onClose} title="Choose a make-up session" wide>
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.length === 0 ? (
        <EmptyState title="No sessions with free spots before the expiry date">Contact the academy and we&apos;ll help you find one.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-semibold">{fmtDay(s.session_date)} · {timeRange(s.start_time, s.end_time)}</p>
                <p className="text-muted">{s.batch_name} · {s.venue_name} {s.skill_level && <Badge className="ml-1">{titleCase(s.skill_level)}</Badge>}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted">{s.spots_left} spot{s.spots_left === 1 ? "" : "s"}</span>
                <Button size="sm" disabled={busy} onClick={() => run(async () => { await api(`/student/makeups/${credit.id}/book`, { body: { session_id: s.id } }); onBooked(); }, "Make-up booked")}>Book</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
