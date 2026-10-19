import { CrudPage, STATUS_OPTIONS } from "@/components/admin/crud";
import { StatusBadge } from "@/components/ui";

export default function FaqsAdmin() {
  return (
    <CrudPage
      title="FAQs"
      endpoint="/admin/faqs"
      singular="FAQ"
      fields={[
        { name: "question", label: "Question", required: true, full: true },
        { name: "answer", label: "Answer", type: "textarea", required: true },
        { name: "status", label: "Status", type: "select", required: true, default: "published", options: STATUS_OPTIONS },
        { name: "display_order", label: "Display order", type: "number", default: 0 },
      ]}
      columns={[
        { key: "question", label: "Question", render: (r) => <span className="font-medium">{r.question}</span> },
        { key: "display_order", label: "Order", right: true },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
      ]}
    />
  );
}
