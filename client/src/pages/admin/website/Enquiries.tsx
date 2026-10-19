import { CrudPage } from "@/components/admin/crud";
import { StatusBadge } from "@/components/ui";
import { fmtDateTime, waLink } from "@/lib/format";

const STATUSES = [{ value: "new", label: "New" }, { value: "contacted", label: "Contacted" }, { value: "closed", label: "Closed" }];

export default function EnquiriesAdmin() {
  return (
    <CrudPage
      title="Website enquiries"
      subtitle="Messages from the contact form."
      endpoint="/admin/enquiries"
      singular="enquiry"
      allowCreate={false}
      filters={[{ name: "status", label: "Status", options: STATUSES }]}
      fields={[{ name: "status", label: "Status", type: "select", required: true, options: STATUSES }]}
      columns={[
        { key: "created_at", label: "Received", render: (r) => <span className="text-xs">{fmtDateTime(r.created_at)}</span> },
        { key: "name", label: "From", render: (r) => <><span className="font-medium">{r.name}</span><span className="block text-xs">{r.mobile && <a className="underline" href={waLink(r.mobile.length === 10 ? `91${r.mobile}` : r.mobile, `Hi ${r.name}, this is LuvAll Sports replying to your enquiry.`)} target="_blank" rel="noopener noreferrer">{r.mobile}</a>}{r.email && <> · <a className="underline" href={`mailto:${r.email}`}>{r.email}</a></>}</span></> },
        { key: "message", label: "Message", render: (r) => <span className="block max-w-md whitespace-pre-line text-xs">{r.message}</span> },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
      ]}
    />
  );
}
