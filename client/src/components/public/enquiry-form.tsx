import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";

import { Button, ErrorNote, Field, Input, Textarea } from "@/components/ui";
import { api } from "@/lib/api";

export function EnquiryForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (sent) {
    return (
      <div className="flex items-start gap-4 rounded-3xl bg-mint p-6 text-court-950" role="status">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-court text-ball">
          <Check size={20} />
        </span>
        <p className="pt-2.5 font-semibold leading-snug">Thanks! We&apos;ve received your message and will get back to you soon.</p>
      </div>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        try {
          await api("/public/enquiries", {
            body: { name: f.get("name"), mobile: f.get("mobile") || null, email: f.get("email") || null, message: f.get("message") },
          });
          setSent(true);
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Your name" required><Input name="name" required minLength={2} autoComplete="name" className="h-12 px-4" /></Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Mobile"><Input name="mobile" type="tel" autoComplete="tel" inputMode="tel" className="h-12 px-4" /></Field>
        <Field label="Email"><Input name="email" type="email" autoComplete="email" className="h-12 px-4" /></Field>
      </div>
      <Field label="Message" required>
        <Textarea name="message" required minLength={5} rows={5} placeholder="Tell us your level, preferred timings or anything else." className="px-4 py-3" />
      </Field>
      <ErrorNote error={error} />
      <div className="pt-1">
        <Button type="submit" size="lg" disabled={busy} className="w-full sm:w-auto">
          {busy ? "Sending…" : "Send message"}
          {!busy && <ArrowRight size={18} />}
        </Button>
      </div>
    </form>
  );
}
