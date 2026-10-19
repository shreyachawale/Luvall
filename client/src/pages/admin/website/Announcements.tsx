import { CrudPage, STATUS_OPTIONS } from "@/components/admin/crud";
import { Badge, StatusBadge } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

const AUDIENCES = [
  { value: "public", label: "Everyone (website + portals)" },
  { value: "members", label: "Students & coaches" },
  { value: "students", label: "Students only" },
  { value: "coaches", label: "Coaches only" },
];

export default function AnnouncementsAdmin() {
  return (
    <CrudPage
      title="Announcements"
      subtitle="Public announcements appear as a banner on the website and on dashboards; member announcements only in the portals."
      endpoint="/admin/announcements"
      singular="announcement"
      filters={[{ name: "status", label: "Status", options: STATUS_OPTIONS }, { name: "audience", label: "Audience", options: AUDIENCES }]}
      fields={[
        { name: "title", label: "Title", required: true },
        { name: "audience", label: "Audience", type: "select", required: true, default: "public", options: AUDIENCES },
        { name: "message", label: "Message", type: "textarea", required: true },
        { name: "link_url", label: "Link", placeholder: "/batches" },
        { name: "status", label: "Status", type: "select", required: true, default: "draft", options: STATUS_OPTIONS },
        { name: "publish_from", label: "Show from", type: "datetime" },
        { name: "publish_to", label: "Show until", type: "datetime" },
        { name: "is_pinned", label: "Pin to top", type: "checkbox" },
      ]}
      columns={[
        { key: "title", label: "Title", render: (r) => <><span className="font-medium">{r.title}</span>{r.is_pinned && <Badge tone="lime" className="ml-2">Pinned</Badge>}</> },
        { key: "audience", label: "Audience", render: (r) => AUDIENCES.find((a) => a.value === r.audience)?.label },
        { key: "window", label: "Window", render: (r) => <span className="text-xs">{r.publish_from ? fmtDateTime(r.publish_from) : "Now"} → {r.publish_to ? fmtDateTime(r.publish_to) : "—"}</span> },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
      ]}
    />
  );
}
