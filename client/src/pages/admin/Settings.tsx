import { useEffect, useState } from "react";

import { ImageInput } from "@/components/admin/crud";
import { Button, Card, CardHeader, ErrorNote, Field, Input, Loading, PageHeader, Select, Textarea } from "@/components/ui";
import { useAction } from "@/components/ui-client";
import { api, useApi } from "@/lib/api";
import { WEEKDAYS } from "@/lib/format";

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-court)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="font-medium">{label}</span>{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
    </label>
  );
}

export default function SettingsPage() {
  const rulesQ = useApi<any>("/admin/settings");
  const academyQ = useApi<any>("/admin/academy");
  const [r, setR] = useState<any>(null);
  const [a, setA] = useState<any>(null);
  const { busy, run } = useAction();
  useEffect(() => { if (rulesQ.data) setR(rulesQ.data); }, [rulesQ.data]);
  useEffect(() => { if (academyQ.data) setA(academyQ.data); }, [academyQ.data]);
  if (rulesQ.error || academyQ.error) return <ErrorNote error={rulesQ.error ?? academyQ.error} />;
  if (!r || !a) return <Loading />;
  const set = (k: string, v: unknown) => setR({ ...r, [k]: v });
  const setM = (k: string, v: unknown) => setR({ ...r, makeup: { ...r.makeup, [k]: v } });
  const setP = (k: string, v: unknown) => setR({ ...r, payment: { ...r.payment, [k]: v } });
  const save = () =>
    run(async () => {
      setR(await api("/admin/settings", { method: "PUT", body: { ...r, morning_evening_boundary: r.morning_evening_boundary.slice(0, 5) } }));
      const { id, code, status, created_at, updated_at, sport_scope, ...profile } = a;
      void id; void code; void status; void created_at; void updated_at; void sport_scope;
      setA(await api("/admin/academy", { method: "PATCH", body: { ...profile, email: profile.email || null } }));
    }, "Settings saved");
  return (
    <>
      <PageHeader title="Settings" subtitle="Business rules and rates the academy can change without a developer." actions={<Button onClick={save} disabled={busy}>Save settings</Button>} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Batches & attendance" />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <Field label="Default min players"><Input type="number" min={1} value={r.default_min_players} onChange={(e) => set("default_min_players", Number(e.target.value))} /></Field>
            <Field label="Default max players"><Input type="number" min={1} value={r.default_max_players} onChange={(e) => set("default_max_players", Number(e.target.value))} /></Field>
            <Field label="Coach attendance edit window (days)" hint="Coaches can correct attendance this many days after a session"><Input type="number" min={0} value={r.attendance_edit_window_days} onChange={(e) => set("attendance_edit_window_days", Number(e.target.value))} /></Field>
            <Field label="Session reminder (hours before)"><Input type="number" min={1} value={r.reminder_hours_before} onChange={(e) => set("reminder_hours_before", Number(e.target.value))} /></Field>
            <Field label="Drop-in fee (₹)" hint="Default charge for extra drop-in attendees"><Input type="number" min={0} value={r.drop_in_fee} onChange={(e) => set("drop_in_fee", e.target.value)} /></Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Venue rate slots" subtitle="How sessions pick a venue rate" />
          <div className="space-y-4 p-5">
            <Field label="Morning rate applies to sessions starting before"><Input type="time" value={r.morning_evening_boundary.slice(0, 5)} onChange={(e) => set("morning_evening_boundary", e.target.value)} /></Field>
            <Field label="Weekend days">
              <div className="flex flex-wrap gap-3">
                {WEEKDAYS.map((d, i) => (
                  <Check key={d} label={d} checked={r.weekend_days.includes(i)} onChange={(on) => set("weekend_days", on ? [...r.weekend_days, i].sort() : r.weekend_days.filter((x: number) => x !== i))} />
                ))}
              </div>
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Make-up policy" />
          <div className="space-y-4 p-5">
            <Check label="Absences automatically earn a make-up" checked={r.makeup.eligible_on_absence} onChange={(v) => setM("eligible_on_absence", v)} hint="Off = admin grants make-ups manually from the student's attendance" />
            <Check label="Make-ups need admin approval" checked={r.makeup.requires_approval} onChange={(v) => setM("requires_approval", v)} />
            <Check label="Students can book their own make-up" checked={r.makeup.student_can_book} onChange={(v) => setM("student_can_book", v)} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Expires after (days)" hint="Empty = never expires"><Input type="number" min={1} value={r.makeup.expiry_days ?? ""} onChange={(e) => setM("expiry_days", e.target.value ? Number(e.target.value) : null)} /></Field>
              <Field label="Booking cut-off (hours before session)"><Input type="number" min={0} value={r.makeup.booking_cutoff_hours} onChange={(e) => setM("booking_cutoff_hours", Number(e.target.value))} /></Field>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Cancellations & credits" />
          <div className="space-y-4 p-5">
            <Field label="Default treatment when the academy cancels a session">
              <Select value={r.default_cancellation_adjustment} onChange={(e) => set("default_cancellation_adjustment", e.target.value)}>
                <option value="carry_forward">Carry forward — session stays in the package</option>
                <option value="refund">Refund — credit the per-session value</option>
                <option value="no_adjustment">No adjustment</option>
              </Select>
            </Field>
            <Field label="Unused sessions when a package is closed">
              <Select value={r.unused_sessions_on_close} onChange={(e) => set("unused_sessions_on_close", e.target.value)}>
                <option value="carry_forward">Carry forward as account credit</option>
                <option value="forfeit">Forfeit</option>
              </Select>
            </Field>
            <p className="text-xs text-muted">A student&apos;s absence never creates a refund or credit by itself.</p>
          </div>
        </Card>
        <Card>
          <CardHeader title="UPI payments" subtitle="Shown to students when they enroll or pay" />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <Field label="UPI ID"><Input value={r.payment.upi_id} onChange={(e) => setP("upi_id", e.target.value)} placeholder="academy@okicici" /></Field>
            <Field label="Payee name"><Input value={r.payment.payee_name} onChange={(e) => setP("payee_name", e.target.value)} /></Field>
            <Field label="WhatsApp number" hint="With country code, e.g. 919876543210"><Input value={r.payment.whatsapp_number} onChange={(e) => setP("whatsapp_number", e.target.value)} /></Field>
            <Field label="QR code image" className="sm:col-span-2"><ImageInput value={r.payment.qr_image_url} onChange={(u) => setP("qr_image_url", u)} /></Field>
            <Field label="Instructions" className="sm:col-span-2"><Textarea rows={3} value={r.payment.instructions} onChange={(e) => setP("instructions", e.target.value)} /></Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Academy profile" />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <Field label="Academy name"><Input value={a.name ?? ""} onChange={(e) => setA({ ...a, name: e.target.value })} /></Field>
            <Field label="Owner"><Input value={a.owner_name ?? ""} onChange={(e) => setA({ ...a, owner_name: e.target.value })} /></Field>
            <Field label="Contact number"><Input value={a.contact_no ?? ""} onChange={(e) => setA({ ...a, contact_no: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={a.email ?? ""} onChange={(e) => setA({ ...a, email: e.target.value })} /></Field>
            <Field label="Location" className="sm:col-span-2"><Input value={a.location ?? ""} onChange={(e) => setA({ ...a, location: e.target.value })} /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea rows={2} value={a.description ?? ""} onChange={(e) => setA({ ...a, description: e.target.value })} /></Field>
            <Field label="Logo" className="sm:col-span-2"><ImageInput value={a.logo_url ?? ""} onChange={(u) => setA({ ...a, logo_url: u })} /></Field>
          </div>
        </Card>
      </div>
      <div className="mt-6 flex justify-end"><Button size="lg" onClick={save} disabled={busy}>Save settings</Button></div>
    </>
  );
}
