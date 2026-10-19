import { CrudPage, STATUS_OPTIONS } from "@/components/admin/crud";
import { StatusBadge } from "@/components/ui";
import { titleCase } from "@/lib/format";

export default function ProgramsAdmin() {
  return (
    <CrudPage
      title="Programs"
      subtitle="Coaching offerings shown on the website. Link batches to a program from the batch form."
      endpoint="/admin/programs"
      singular="program"
      filters={[{ name: "status", label: "Status", options: STATUS_OPTIONS }]}
      fields={[
        { name: "title", label: "Title", required: true },
        { name: "status", label: "Status", type: "select", required: true, default: "draft", options: STATUS_OPTIONS },
        { name: "skill_level", label: "Level", type: "select", options: ["beginner", "intermediate", "advanced", "kids", "all"].map((v) => ({ value: v, label: titleCase(v) })) },
        { name: "age_group", label: "Age group", placeholder: "15+ years" },
        { name: "summary", label: "Summary", type: "textarea" },
        { name: "description", label: "Full description", type: "textarea" },
        { name: "image_url", label: "Image", type: "image" },
        { name: "display_order", label: "Display order", type: "number", default: 0 },
        { name: "slug", label: "URL slug" },
      ]}
      columns={[
        { key: "title", label: "Program", render: (r) => <span className="font-medium">{r.title}</span> },
        { key: "skill_level", label: "Level", render: (r) => titleCase(r.skill_level) },
        { key: "age_group", label: "Age group" },
        { key: "display_order", label: "Order", right: true },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
      ]}
    />
  );
}
