import { Copy, MessageCircle, Smartphone } from "lucide-react";

import { buttonClass } from "@/components/ui";
import { useToast } from "@/components/ui-client";
import { inr, upiLink, waLink } from "@/lib/format";

export type PaymentInfo = { upi_id: string; payee_name: string; qr_image_url: string; whatsapp_number: string; instructions: string };

export function UpiPanel({ payment, amount, note }: { payment: PaymentInfo; amount?: number | null; note?: string }) {
  const toast = useToast();
  if (!payment.upi_id && !payment.qr_image_url) {
    return <p className="text-sm text-muted">Payment details will be shared by the academy.</p>;
  }
  return (
    <div className="rounded-2xl border border-line bg-court-50 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {payment.qr_image_url && (
          <img src={payment.qr_image_url} alt="UPI QR code" className="h-40 w-40 rounded-xl border border-line bg-white object-contain p-2" />
        )}
        <div className="space-y-2 text-sm">
          {amount ? <p className="num font-display text-2xl font-bold">{inr(amount)}</p> : null}
          {payment.upi_id && (
            <p className="flex items-center gap-2">
              <span className="text-muted">UPI ID</span>
              <span className="font-mono font-semibold">{payment.upi_id}</span>
              <button type="button" aria-label="Copy UPI ID" className="rounded p-1 hover:bg-white" onClick={() => { navigator.clipboard?.writeText(payment.upi_id); toast("UPI ID copied"); }}>
                <Copy size={14} />
              </button>
            </p>
          )}
          {payment.payee_name && <p><span className="text-muted">Payee</span> {payment.payee_name}</p>}
          {payment.upi_id && (
            <a href={upiLink(payment.upi_id, payment.payee_name, amount ?? undefined, note)} className={buttonClass("secondary", "sm", "sm:hidden")}>
              <Smartphone size={14} /> Pay with a UPI app
            </a>
          )}
        </div>
      </div>
      {payment.instructions && <p className="mt-3 text-xs text-muted">{payment.instructions}</p>}
    </div>
  );
}

export function WhatsAppConfirm({ number, message }: { number: string; message: string }) {
  if (!number) return null;
  return (
    <a href={waLink(number, message)} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "md")}>
      <MessageCircle size={16} /> Send confirmation on WhatsApp
    </a>
  );
}
