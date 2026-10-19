import { CrudPage, STATUS_OPTIONS } from "@/components/admin/crud";
import { StatusBadge } from "@/components/ui";

export default function TestimonialsAdmin() {
  return (
    <CrudPage
      title="Testimonials"
      endpoint="/admin/testimonials"
      singular="testimonial"
      filters={[{ name: "status", label: "Status", options: STATUS_OPTIONS }]}
      fields={[
        { name: "author_name", label: "Name", required: true },
        { name: "author_title", label: "Subtitle", placeholder: "Beginner batch" },
        { name: "quote", label: "Quote", type: "textarea", required: true },
        { name: "rating", label: "Rating (1–5)", type: "number" },
        { name: "status", label: "Status", type: "select", required: true, default: "draft", options: STATUS_OPTIONS },
        { name: "display_order", label: "Display order", type: "number", default: 0 },
        { name: "photo_url", label: "Photo", type: "image" },
      ]}
      columns={[
        { key: "author_name", label: "Name", render: (r) => <><span className="font-medium">{r.author_name}</span><span className="block text-xs text-muted">{r.author_title}</span></> },
        { key: "quote", label: "Quote", render: (r) => <span className="line-clamp-2 max-w-md whitespace-normal text-xs">{r.quote}</span> },
        { key: "rating", label: "Rating", right: true },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
      ]}
    />
  );
}
