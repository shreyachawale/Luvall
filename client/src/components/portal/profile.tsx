import { Button, Card, CardHeader, ErrorNote, Field, Input, Loading, Select, Textarea } from "@/components/ui";
import { useAction } from "@/components/ui-client";
import { api, useApi } from "@/lib/api";

export function ProfileEditor({ student }: { student?: boolean }) {
  const { data: me, error, mutate } = useApi<any>("/auth/me");
  const { busy, run } = useAction();
  if (error) return <ErrorNote error={error} />;
  if (!me) return <Loading />;
  const sp = me.student_profile ?? {};
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader title="Personal details" subtitle={`Mobile ${me.mobile} — contact the academy to change it`} />
        <form
          className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const body: Record<string, unknown> = {
              name: f.get("name"),
              email: f.get("email") || null,
              dob: f.get("dob") || null,
              gender: f.get("gender") || null,
              address: f.get("address") || null,
            };
            if (student) {
              body.skill_level = f.get("skill_level") || null;
              body.guardian_name = f.get("guardian_name") || null;
              body.emergency_contact = f.get("emergency_contact") || null;
            }
            run(async () => mutate(await api("/auth/me", { method: "PATCH", body })), "Profile saved");
          }}
        >
          <Field label="Full name" required><Input name="name" defaultValue={me.name} required /></Field>
          <Field label="Email"><Input name="email" type="email" defaultValue={me.email ?? ""} /></Field>
          <Field label="Date of birth"><Input name="dob" type="date" defaultValue={me.dob ?? ""} /></Field>
          <Field label="Gender">
            <Select name="gender" defaultValue={me.gender ?? ""}>
              <option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
            </Select>
          </Field>
          {student && (
            <>
              <Field label="Playing level">
                <Select name="skill_level" defaultValue={sp.skill_level ?? ""}>
                  <option value="">—</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
                </Select>
              </Field>
              <Field label="Emergency contact"><Input name="emergency_contact" type="tel" defaultValue={sp.emergency_contact ?? ""} /></Field>
              <Field label="Parent / guardian" className="sm:col-span-2"><Input name="guardian_name" defaultValue={sp.guardian_name ?? ""} /></Field>
            </>
          )}
          <Field label="Address" className="sm:col-span-2"><Textarea name="address" rows={2} defaultValue={me.address ?? ""} /></Field>
          <div className="sm:col-span-2"><Button type="submit" disabled={busy}>Save changes</Button></div>
        </form>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Change password" />
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            if (f.get("new_password") !== f.get("confirm")) {
              run(async () => { throw new Error("New passwords do not match"); });
              return;
            }
            run(async () => {
              await api("/auth/change-password", { body: { current_password: f.get("current_password"), new_password: f.get("new_password") } });
              form.reset();
            }, "Password changed");
          }}
        >
          <Field label="Current password"><Input name="current_password" type="password" required autoComplete="current-password" /></Field>
          <Field label="New password" hint="At least 8 characters"><Input name="new_password" type="password" required minLength={8} autoComplete="new-password" /></Field>
          <Field label="Confirm new password"><Input name="confirm" type="password" required minLength={8} autoComplete="new-password" /></Field>
          <Button type="submit" disabled={busy}>Update password</Button>
        </form>
      </Card>
    </div>
  );
}
