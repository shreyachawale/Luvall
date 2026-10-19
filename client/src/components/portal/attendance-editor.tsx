import { Check, Clock, MapPin, Plus, Search, Trash2, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge, Button, Card, CardHeader, ErrorNote, Field, Input, Loading, Notice, Select, StatusBadge, Textarea, cx } from "@/components/ui";
import { Modal, useAction } from "@/components/ui-client";
import { api, useApi } from "@/lib/api";
import { fmtDay, inr, timeRange, titleCase } from "@/lib/format";

type Row = {
  student_id: string;
  name: string;
  mobile: string | null;
  attendee_type: string;
  expected: boolean;
  attendance_id: string | null;
  status: "present" | "absent" | null;
  billing_mode: string | null;
  drop_in_fee: number | null;
  makeup_credit_id: string | null;
  original_batch_name: string | null;
  remarks: string | null;
};

const REGULAR_BILLING = [
  { value: "package", label: "Counts from package" },
  { value: "carried_forward", label: "Excused — carry forward" },
  { value: "complimentary", label: "Complimentary" },
];
const EXTRA_BILLING = [
  { value: "makeup", label: "Uses make-up credit" },
  { value: "package", label: "Uses package credit" },
  { value: "drop_in", label: "Drop-in fee" },
  { value: "complimentary", label: "Complimentary" },
];
const TYPE_LABEL: Record<string, string> = { regular: "Regular", makeup: "Make-up", drop_in: "Drop-in", other: "Other" };

export function AttendanceEditor({ sessionId, admin, onSaved }: { sessionId: string; admin: boolean; onSaved?: () => void }) {
  const { data, error, mutate } = useApi<any>(`/sessions/${sessionId}`);
  const [rows, setRows] = useState<Row[]>([]);
  const [coaches, setCoaches] = useState<any[]>([]);
  const [meta, setMeta] = useState({ start: "", end: "", courts: 1, remarks: "" });
  const [adding, setAdding] = useState(false);
  const { busy, run } = useAction();

  useEffect(() => {
    if (!data) return;
    setRows(data.roster.map((r: any) => ({ ...r })));
    setCoaches(
      data.coaches.map((c: any) => ({
        coach_id: c.coach_id,
        name: c.name,
        hours_coached: c.hours_coached ?? c.scheduled_hours,
        adjustment_amount: c.adjustment_amount ?? 0,
        adjustment_note: c.adjustment_note ?? "",
        rate_applied: c.rate_applied,
        payable_amount: c.payable_amount,
      })),
    );
    setMeta({ start: data.start_time.slice(0, 5), end: data.end_time.slice(0, 5), courts: data.courts_booked, remarks: data.remarks ?? "" });
  }, [data]);

  const unmarked = rows.filter((r) => !r.status).length;
  const present = rows.filter((r) => r.status === "present").length;
  const editable = data?.can_edit;
  const update = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.student_id === id ? { ...r, ...patch } : r)));

  const save = () =>
    run(async () => {
      await api(`/sessions/${sessionId}/attendance`, {
        body: {
          entries: rows.map((r) => ({
            student_id: r.student_id,
            status: r.status,
            attendee_type: r.attendee_type === "regular" ? null : r.attendee_type,
            makeup_credit_id: r.attendee_type === "makeup" ? r.makeup_credit_id : null,
            billing_mode: admin ? r.billing_mode : null,
            drop_in_fee: admin && r.billing_mode === "drop_in" ? r.drop_in_fee : null,
            remarks: r.remarks || null,
          })),
          coaches: coaches.map((c) => ({
            coach_id: c.coach_id,
            hours_coached: Number(c.hours_coached),
            adjustment_amount: admin ? Number(c.adjustment_amount || 0) : null,
            adjustment_note: admin ? c.adjustment_note || null : null,
          })),
          actual_start_time: meta.start,
          actual_end_time: meta.end,
          courts_booked: Number(meta.courts),
          remarks: meta.remarks || null,
        },
      });
      await mutate();
      onSaved?.();
    }, "Attendance saved");

  const removeRow = (r: Row) =>
    run(async () => {
      if (r.attendance_id) {
        await api(`/sessions/${sessionId}/attendance/${r.attendance_id}`, { method: "DELETE" });
        await mutate();
      } else {
        setRows((rs) => rs.filter((x) => x.student_id !== r.student_id));
      }
    });

  const venueLine = useMemo(() => (data ? `${data.venue_name}${data.venue_address ? ` · ${data.venue_address}` : ""}` : ""), [data]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted">{data.batch.name}</p>
            <h2 className="text-xl font-bold">{fmtDay(data.session_date)}</h2>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              <span className="flex items-center gap-1.5"><Clock size={15} />{timeRange(data.start_time, data.end_time)}</span>
              <span className="flex items-center gap-1.5"><MapPin size={15} />{venueLine}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusBadge status={data.status} />
            {data.status === "completed" && <span className="text-xs text-muted">{present} present</span>}
          </div>
        </div>
        {data.status === "cancelled" && (
          <div className="mt-4"><Notice tone="warn">Cancelled{data.cancellation_reason ? `: ${data.cancellation_reason}` : ""} · {titleCase(data.cancellation_adjustment)}</Notice></div>
        )}
        {!editable && data.status !== "cancelled" && data.edit_blocked_reason && <div className="mt-4"><Notice>{data.edit_blocked_reason}</Notice></div>}
      </Card>

      <Card>
        <CardHeader
          title={`Players (${rows.length})`}
          subtitle="Regular students of the batch plus booked make-ups. Add anyone else who played."
          action={
            editable && (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, status: r.status ?? "present" })))}>
                  <Check size={14} /> Mark rest present
                </Button>
                <Button size="sm" onClick={() => setAdding(true)}><Plus size={14} /> Add attendee</Button>
              </div>
            )
          }
        />
        {rows.length === 0 ? (
          <p className="p-5 text-sm text-muted">No students are enrolled for this date.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.student_id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    {r.attendee_type !== "regular" && <Badge tone={r.attendee_type === "makeup" ? "lime" : "purple"}>{TYPE_LABEL[r.attendee_type]}</Badge>}
                  </div>
                  <p className="text-xs text-muted">
                    {r.mobile}
                    {r.original_batch_name && r.attendee_type === "makeup" ? ` · make-up for ${r.original_batch_name}` : ""}
                  </p>
                  {admin && r.status && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Select
                        aria-label="Billing"
                        className="h-8 w-auto py-1 text-xs"
                        value={r.billing_mode ?? (r.attendee_type === "regular" ? "package" : r.attendee_type === "makeup" ? "makeup" : r.attendee_type === "drop_in" ? "drop_in" : "complimentary")}
                        disabled={!editable}
                        onChange={(e) => update(r.student_id, { billing_mode: e.target.value })}
                      >
                        {(r.attendee_type === "regular" ? REGULAR_BILLING : EXTRA_BILLING).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                      {(r.billing_mode ?? (r.attendee_type === "drop_in" ? "drop_in" : "")) === "drop_in" && (
                        <Input
                          aria-label="Drop-in fee"
                          type="number"
                          min={0}
                          className="h-8 w-28 py-1 text-xs"
                          value={r.drop_in_fee ?? data.drop_in_fee}
                          disabled={!editable}
                          onChange={(e) => update(r.student_id, { drop_in_fee: Number(e.target.value), billing_mode: "drop_in" })}
                        />
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex overflow-hidden rounded-full border border-line" role="group" aria-label={`Attendance for ${r.name}`}>
                    {(["present", "absent"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={!editable}
                        onClick={() => update(r.student_id, { status: s })}
                        aria-pressed={r.status === s}
                        className={cx(
                          "px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed",
                          r.status === s ? (s === "present" ? "bg-court text-white" : "bg-red-600 text-white") : "bg-white text-muted hover:bg-stone-50",
                        )}
                      >
                        {s === "present" ? "Present" : "Absent"}
                      </button>
                    ))}
                  </div>
                  {editable && !r.expected && (
                    <button onClick={() => removeRow(r)} className="rounded-full p-2 text-muted hover:bg-red-50 hover:text-red-700" aria-label={`Remove ${r.name}`}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Session details" subtitle="Actual timings, courts and coach hours are used for coach pay and court charges." />
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
          <Field label="Actual start"><Input type="time" value={meta.start} disabled={!editable} onChange={(e) => setMeta({ ...meta, start: e.target.value })} /></Field>
          <Field label="Actual end"><Input type="time" value={meta.end} disabled={!editable} onChange={(e) => setMeta({ ...meta, end: e.target.value })} /></Field>
          <Field label="Courts used"><Input type="number" min={0} value={meta.courts} disabled={!editable} onChange={(e) => setMeta({ ...meta, courts: Number(e.target.value) })} /></Field>
        </div>
        <div className="space-y-3 px-5 pb-5">
          {coaches.map((c, i) => (
            <div key={c.coach_id} className="grid grid-cols-1 gap-3 rounded-xl border border-line p-3 sm:grid-cols-[1fr_120px] lg:grid-cols-[1fr_120px_140px_1fr]">
              <div>
                <p className="font-medium">{c.name}</p>
                {admin && c.rate_applied != null && <p className="text-xs text-muted">Rate {inr(c.rate_applied)}/h · payable {inr(c.payable_amount)}</p>}
              </div>
              <Field label="Hours coached">
                <Input type="number" step="0.25" min={0} max={24} value={c.hours_coached} disabled={!editable}
                  onChange={(e) => setCoaches((cs) => cs.map((x, j) => (j === i ? { ...x, hours_coached: e.target.value } : x)))} />
              </Field>
              {admin && (
                <>
                  <Field label="Adjustment (₹)">
                    <Input type="number" step="1" value={c.adjustment_amount} disabled={!editable}
                      onChange={(e) => setCoaches((cs) => cs.map((x, j) => (j === i ? { ...x, adjustment_amount: e.target.value } : x)))} />
                  </Field>
                  <Field label="Adjustment note">
                    <Input value={c.adjustment_note} disabled={!editable}
                      onChange={(e) => setCoaches((cs) => cs.map((x, j) => (j === i ? { ...x, adjustment_note: e.target.value } : x)))} />
                  </Field>
                </>
              )}
            </div>
          ))}
          <Field label="Remarks"><Textarea rows={2} value={meta.remarks} disabled={!editable} onChange={(e) => setMeta({ ...meta, remarks: e.target.value })} placeholder="Drills covered, issues at the venue, etc." /></Field>
        </div>
      </Card>

      {editable && (
        <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
          <span className="text-sm text-muted">{unmarked ? `${unmarked} player(s) not marked yet` : `${present} present · ${rows.length - present} absent`}</span>
          <Button size="lg" disabled={busy || unmarked > 0} onClick={save}>{data.status === "completed" ? "Save corrections" : "Submit attendance"}</Button>
        </div>
      )}

      {adding && (
        <AddAttendee
          sessionId={sessionId}
          existing={rows.map((r) => r.student_id)}
          onClose={() => setAdding(false)}
          onAdd={(row) => {
            setRows((rs) => [...rs, row]);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function AddAttendee({ sessionId, existing, onClose, onAdd }: { sessionId: string; existing: string[]; onClose: () => void; onAdd: (r: Row) => void }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isLoading } = useApi<any[]>(term.length >= 2 ? `/sessions/${sessionId}/candidates?q=${encodeURIComponent(term)}` : null);
  const [walkIn, setWalkIn] = useState(false);
  const { busy, run } = useAction();
  const base = (s: any): Omit<Row, "attendee_type" | "makeup_credit_id" | "billing_mode"> => ({
    student_id: s.student_id, name: s.name, mobile: s.mobile, expected: false, attendance_id: null, status: "present",
    drop_in_fee: null, original_batch_name: null, remarks: null,
  });
  return (
    <Modal open onClose={onClose} title="Add attendee" wide>
      {walkIn ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              const s = await api(`/sessions/${sessionId}/walk-in`, { body: { name: f.get("name"), mobile: f.get("mobile") } });
              onAdd({ ...base(s), attendee_type: "drop_in", makeup_credit_id: null, billing_mode: null });
            });
          }}
        >
          <Notice>New players are added as drop-ins and charged the drop-in fee. Their record is created so the academy can follow up.</Notice>
          <Field label="Name" required><Input name="name" required minLength={2} /></Field>
          <Field label="Mobile" required><Input name="mobile" type="tel" required /></Field>
          <div className="flex justify-between">
            <Button type="button" variant="ghost" onClick={() => setWalkIn(false)}>← Search instead</Button>
            <Button type="submit" disabled={busy}><UserPlus size={16} /> Add player</Button>
          </div>
        </form>
      ) : (
        <>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-3 text-muted" />
            <Input autoFocus className="pl-9" placeholder="Search by name or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="mt-4 min-h-24">
            {term.length < 2 ? <p className="text-sm text-muted">Type at least 2 characters.</p> : isLoading || !data ? <Loading /> : data.length === 0 ? (
              <p className="text-sm text-muted">No student found.</p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {data.map((s) => {
                  const already = existing.includes(s.student_id);
                  return (
                    <li key={s.student_id} className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium">{s.name}</p>
                          <p className="text-xs text-muted">{s.mobile}{s.skill_level ? ` · ${titleCase(s.skill_level)}` : ""}</p>
                        </div>
                        {already ? <Badge>Already listed</Badge> : s.is_regular ? <Badge>Regular in this batch</Badge> : (
                          <div className="flex flex-wrap gap-2">
                            {s.makeup_credits.map((c: any) => (
                              <Button key={c.id} size="sm" onClick={() => onAdd({ ...base(s), attendee_type: "makeup", makeup_credit_id: c.id, billing_mode: null, original_batch_name: c.original_batch_name })}>
                                Make-up ({c.original_batch_name})
                              </Button>
                            ))}
                            <Button size="sm" variant="secondary" onClick={() => onAdd({ ...base(s), attendee_type: "drop_in", makeup_credit_id: null, billing_mode: null })}>Drop-in</Button>
                            <Button size="sm" variant="ghost" onClick={() => onAdd({ ...base(s), attendee_type: "other", makeup_credit_id: null, billing_mode: null })}>Other</Button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="mt-4 flex justify-between border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setWalkIn(true)}><UserPlus size={16} /> New walk-in player</Button>
            <Button variant="secondary" onClick={onClose}><X size={16} /> Close</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
