import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { FormFields, initialValues, toPayload, type FieldDef } from "@/components/admin/crud";
import { Button, Field, Input, Select } from "@/components/ui";
import { Modal, useAction } from "@/components/ui-client";
import { api, useApi } from "@/lib/api";
import { WEEKDAYS, inr, titleCase } from "@/lib/format";

export type ScheduleRow = { weekday: number; start_time: string; end_time: string; venue_id: string; courts: number };
export type CoachRow = { coach_id: string; role: "lead" | "assistant" };

function useBatchOptions() {
  const programs = useApi<any>("/admin/programs?page_size=100");
  const plans = useApi<any>("/admin/fee-plans?status=active&page_size=100");
  const venues = useApi<any[]>("/admin/venues?include_inactive=false");
  const coaches = useApi<any[]>("/admin/coaches");
  return {
    programs: programs.data?.items ?? [],
    plans: plans.data?.items ?? [],
    venues: venues.data ?? [],
    coaches: coaches.data ?? [],
  };
}

export function batchFields(programs: any[], plans: any[]): FieldDef[] {
  return [
    { name: "name", label: "Batch name", required: true, placeholder: "Beginners — Tue/Thu Evening" },
    { name: "code", label: "Batch code", required: true, placeholder: "BEG-TT" },
    { name: "period_label", label: "Period / month", placeholder: "2026-11", hint: "Code + period must be unique" },
    { name: "status", label: "Status", type: "select", required: true, default: "upcoming", options: ["upcoming", "active", "completed", "cancelled"].map((v) => ({ value: v, label: titleCase(v) })) },
    { name: "start_date", label: "Start date", type: "date" },
    { name: "end_date", label: "End date", type: "date" },
    { name: "program_id", label: "Program", type: "select", options: programs.map((p) => ({ value: String(p.id), label: p.title })) },
    { name: "skill_level", label: "Skill level", type: "select", options: ["beginner", "intermediate", "advanced", "kids", "all"].map((v) => ({ value: v, label: titleCase(v) })) },
    { name: "min_players", label: "Min players", type: "number", hint: "Default from settings" },
    { name: "max_players", label: "Max players (capacity)", type: "number", hint: "Default from settings" },
    { name: "duration_minutes", label: "Session length (min)", type: "number", default: 60, required: true },
    { name: "fee_plan_id", label: "Linked fee plan", type: "select", options: plans.map((p) => ({ value: String(p.id), label: `${p.name} — ${inr(p.base_fee)} / ${p.number_of_sessions}` })) },
    { name: "price", label: "Batch price (₹)", type: "number", hint: "Used only when no fee plan is linked" },
    { name: "is_public", label: "Show on the public website", type: "checkbox", default: true },
    { name: "description", label: "Description", type: "textarea" },
  ];
}

export function batchPayload(fields: FieldDef[], values: Record<string, any>) {
  const body = toPayload(fields, values);
  for (const k of ["program_id", "fee_plan_id"]) body[k] = body[k] || null;
  if (body.period_label === null) body.period_label = "";
  return body;
}

export function ScheduleEditor({ rows, setRows, venues }: { rows: ScheduleRow[]; setRows: (r: ScheduleRow[]) => void; venues: any[] }) {
  const set = (i: number, patch: Partial<ScheduleRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-line p-2 sm:grid-cols-[110px_110px_110px_1fr_80px_40px]">
          <Select aria-label="Day" value={r.weekday} onChange={(e) => set(i, { weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((d, n) => <option key={d} value={n}>{d}</option>)}
          </Select>
          <Input aria-label="Start" type="time" value={r.start_time} onChange={(e) => set(i, { start_time: e.target.value })} required />
          <Input aria-label="End" type="time" value={r.end_time} onChange={(e) => set(i, { end_time: e.target.value })} required />
          <Select aria-label="Venue" value={r.venue_id} onChange={(e) => set(i, { venue_id: e.target.value })} required>
            <option value="">Venue…</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
          <Input aria-label="Courts" type="number" min={0} value={r.courts} onChange={(e) => set(i, { courts: Number(e.target.value) })} />
          <button type="button" className="grid place-items-center rounded-lg text-muted hover:bg-red-50 hover:text-red-700" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove row">
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <Button type="button" size="sm" variant="secondary" onClick={() => setRows([...rows, { weekday: rows.length ? (rows[rows.length - 1].weekday + 2) % 7 : 1, start_time: rows[0]?.start_time ?? "17:00", end_time: rows[0]?.end_time ?? "18:00", venue_id: rows[0]?.venue_id ?? "", courts: rows[0]?.courts ?? 1 }])}>
        <Plus size={14} /> Add day
      </Button>
      <p className="text-xs text-muted">Columns: day, start, end, venue, courts booked.</p>
    </div>
  );
}

export function CoachPicker({ rows, setRows, coaches }: { rows: CoachRow[]; setRows: (r: CoachRow[]) => void; coaches: any[] }) {
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_140px_40px] gap-2">
          <Select aria-label="Coach" value={r.coach_id} required onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, coach_id: e.target.value } : x)))}>
            <option value="">Coach…</option>
            {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select aria-label="Role" value={r.role} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, role: e.target.value as CoachRow["role"] } : x)))}>
            <option value="lead">Lead</option><option value="assistant">Assistant</option>
          </Select>
          <button type="button" className="grid place-items-center rounded-lg text-muted hover:bg-red-50 hover:text-red-700" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove coach"><Trash2 size={16} /></button>
        </div>
      ))}
      {rows.length < 3 && <Button type="button" size="sm" variant="secondary" onClick={() => setRows([...rows, { coach_id: "", role: rows.length ? "assistant" : "lead" }])}><Plus size={14} /> Add coach</Button>}
    </div>
  );
}

export function BatchCreateModal({ onClose, onDone }: { onClose: () => void; onDone: (b: any) => void }) {
  const opts = useBatchOptions();
  const fields = batchFields(opts.programs, opts.plans);
  const [values, setValues] = useState(() => initialValues(fields));
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [coaches, setCoaches] = useState<CoachRow[]>([{ coach_id: "", role: "lead" }]);
  const { busy, run } = useAction();
  return (
    <Modal open onClose={onClose} title="New batch" wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="batch-form" disabled={busy}>Create batch</Button></>}>
      <form
        id="batch-form"
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const b = await api("/admin/batches", {
              body: { ...batchPayload(fields, values), schedules, coaches: coaches.filter((c) => c.coach_id) },
            });
            onDone(b);
          }, "Batch created");
        }}
      >
        <FormFields fields={fields} values={values} setValues={setValues} />
        <Field label="Weekly schedule"><ScheduleEditor rows={schedules} setRows={setSchedules} venues={opts.venues} /></Field>
        <Field label="Coaches"><CoachPicker rows={coaches} setRows={setCoaches} coaches={opts.coaches} /></Field>
      </form>
    </Modal>
  );
}

export function BatchEditModal({ batch, onClose, onDone }: { batch: any; onClose: () => void; onDone: () => void }) {
  const opts = useBatchOptions();
  const fields = batchFields(opts.programs, opts.plans);
  const [values, setValues] = useState(() =>
    initialValues(fields, { ...batch, program_id: batch.program_id ?? "", fee_plan_id: batch.fee_plan_id ?? "" }),
  );
  const { busy, run } = useAction();
  return (
    <Modal open onClose={onClose} title="Edit batch" wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="batch-edit" disabled={busy}>Save</Button></>}>
      <form id="batch-edit" onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/admin/batches/${batch.id}`, { method: "PATCH", body: batchPayload(fields, values) }); onDone(); }, "Batch updated"); }}>
        <FormFields fields={fields} values={values} setValues={setValues} />
      </form>
    </Modal>
  );
}

export function ScheduleCoachesModal({ batch, onClose, onDone }: { batch: any; onClose: () => void; onDone: () => void }) {
  const opts = useBatchOptions();
  const [schedules, setSchedules] = useState<ScheduleRow[]>(
    batch.schedules.map((s: any) => ({ weekday: s.weekday, start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5), venue_id: s.venue_id, courts: s.courts })),
  );
  const [coaches, setCoaches] = useState<CoachRow[]>(batch.coaches.map((c: any) => ({ coach_id: c.coach_id, role: c.role })));
  const { busy, run } = useAction();
  return (
    <Modal open onClose={onClose} title="Schedule & coaches" wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="sched-form" disabled={busy}>Save</Button></>}>
      <form
        id="sched-form"
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api(`/admin/batches/${batch.id}/schedules`, { method: "PUT", body: schedules });
            await api(`/admin/batches/${batch.id}/coaches`, { method: "PUT", body: coaches.filter((c) => c.coach_id) });
            onDone();
          }, "Saved — future sessions use the new coaches");
        }}
      >
        <Field label="Weekly schedule" hint="Changes apply to sessions generated from now on; existing sessions keep their time and venue.">
          <ScheduleEditor rows={schedules} setRows={setSchedules} venues={opts.venues} />
        </Field>
        <Field label="Coaches" hint="Upcoming scheduled sessions are updated to these coaches.">
          <CoachPicker rows={coaches} setRows={setCoaches} coaches={opts.coaches} />
        </Field>
      </form>
    </Modal>
  );
}
