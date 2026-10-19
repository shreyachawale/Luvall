import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { UpiPanel, WhatsAppConfirm } from "@/components/portal/upi";
import { Button, Card, ErrorNote, Field, Input, LinkButton, Loading, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { api, uploadImage, useApi } from "@/lib/api";
import { fmtDate, inr, scheduleSummary, todayISO } from "@/lib/format";

/** Keyed on the batch so moving to another batch's enroll page starts a fresh form, as a new Next.js page did. */
export default function EnrollPage() {
  const { batchId } = useParams();
  return <Enroll key={batchId} batchId={batchId!} />;
}

function Enroll({ batchId }: { batchId: string }) {
  const { data, error, mutate } = useApi<any>(`/student/enroll/${batchId}`);
  const { data: me } = useApi<any>("/auth/me");
  const [mode, setMode] = useState<"paid" | "later">("paid");
  const [proof, setProof] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const b = data.batch;
  const amount = b.display_price;

  if (done) {
    const utr = done.payment?.reference_no;
    return (
      <Card className="mx-auto max-w-xl p-8 text-center">
        <CheckCircle2 className="mx-auto text-court-600" size={44} />
        <h1 className="mt-3 text-2xl font-bold">Request received</h1>
        <p className="mt-2 text-muted">
          Your seat in <strong>{b.name}</strong> is held while the academy {done.payment ? "verifies your payment" : "confirms your enrollment"}.
          It will appear as active on your dashboard once confirmed.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <WhatsAppConfirm
            number={data.payment.whatsapp_number}
            message={`Hi LuvAll Sports, I (${me?.name ?? ""}, ${me?.mobile ?? ""}) have enrolled in ${b.name}${utr ? ` and paid ${inr(done.payment.amount)} via UPI. UTR: ${utr}` : ". I will pay at the academy"}.`}
          />
          <LinkButton to="/student">Go to dashboard</LinkButton>
        </div>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title={`Join ${b.name}`} back={{ href: `/batches/${b.id}`, label: "Batch details" }} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card className="h-fit p-5">
          <h2 className="font-semibold">Batch summary</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted">Schedule</dt><dd className="text-right">{scheduleSummary(b.schedules)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Venue</dt><dd className="text-right">{[...new Set(b.schedules.map((s: any) => s.venue_name))].join(", ")}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Dates</dt><dd>{fmtDate(b.start_date)} – {fmtDate(b.end_date)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Plan</dt><dd>{b.fee_plan ? `${b.fee_plan.name}` : data.sessions_estimate ? `${data.sessions_estimate} sessions` : "Batch fee"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Seats left</dt><dd>{b.seats_left}</dd></div>
            <div className="flex justify-between gap-4 border-t border-line pt-2 text-base"><dt className="font-semibold">Fee</dt><dd className="num font-bold">{amount !== null ? inr(amount) : "Set by academy"}</dd></div>
          </dl>
        </Card>

        {data.already_enrolled ? (
          <Card className="p-6">
            <p className="font-semibold">You&apos;re already in this batch</p>
            <p className="mt-1 text-sm text-muted">Status: <StatusBadge status={data.already_enrolled.status} /></p>
            <LinkButton to="/student" className="mt-4">Go to dashboard</LinkButton>
          </Card>
        ) : b.display_status === "full" ? (
          <Card className="p-6">
            <Notice tone="warn">This batch is full. Please choose another batch or contact the academy.</Notice>
            <LinkButton to="/batches" variant="secondary" className="mt-4">Other batches</LinkButton>
          </Card>
        ) : (
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Payment</h2>
            <div className="mb-4 flex gap-2" role="radiogroup">
              <Button type="button" variant={mode === "paid" ? "primary" : "secondary"} size="sm" onClick={() => setMode("paid")} aria-pressed={mode === "paid"}>Pay now by UPI</Button>
              <Button type="button" variant={mode === "later" ? "primary" : "secondary"} size="sm" onClick={() => setMode("later")} aria-pressed={mode === "later"}>Pay at the academy</Button>
            </div>
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                setSubmitError(null);
                try {
                  const body: any = { batch_id: b.id };
                  if (mode === "paid") {
                    body.amount = Number(f.get("amount"));
                    body.reference_no = f.get("reference_no");
                    body.payment_date = f.get("payment_date");
                    body.proof_url = proof;
                  }
                  setDone(await api("/student/enroll", { body }));
                  mutate();
                } catch (err) {
                  setSubmitError(err);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {mode === "paid" ? (
                <>
                  <UpiPanel payment={data.payment} amount={amount} note={`${b.code} ${me?.name ?? ""}`} />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Amount paid (₹)" required>
                      <Input name="amount" type="number" min={1} step="0.01" required defaultValue={amount ?? ""} />
                    </Field>
                    <Field label="Payment date" required>
                      <Input name="payment_date" type="date" required defaultValue={todayISO()} max={todayISO()} />
                    </Field>
                  </div>
                  <Field label="UPI transaction reference (UTR)" required hint="12-digit number shown in your UPI app after paying">
                    <Input name="reference_no" required minLength={4} placeholder="e.g. 412345678901" />
                  </Field>
                  <Field label="Payment screenshot (optional)">
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          setProof((await uploadImage(file, "/student/payment-proof")).url);
                        } catch (err) {
                          setSubmitError(err);
                        }
                      }}
                    />
                  </Field>
                  {proof && <p className="text-xs text-court-700">Screenshot attached.</p>}
                </>
              ) : (
                <Notice>Your seat is held as pending. Pay at the academy and the admin will confirm your enrollment.</Notice>
              )}
              <ErrorNote error={submitError} />
              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy ? "Submitting…" : mode === "paid" ? "Submit payment & enroll" : "Request enrollment"}
              </Button>
              <p className="text-center text-xs text-muted">
                By enrolling you agree to the academy&apos;s make-up and cancellation policy. <Link to="/faq" className="underline">FAQs</Link>
              </p>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
