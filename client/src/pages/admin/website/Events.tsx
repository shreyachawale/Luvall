import { CrudPage, STATUS_OPTIONS } from "@/components/admin/crud";
import { StatusBadge } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";

export default function EventsAdmin() {
  const venues = useApi<any[]>("/admin/venues");
  return (
    <CrudPage
      title="Events"
      subtitle="Clinics, workshops and tournaments listed on the Events page."
      endpoint="/admin/events"
      singular="event"
      filters={[{ name: "status", label: "Status", options: STATUS_OPTIONS }]}
      fields={[
        { name: "title", label: "Title", required: true, full: true },
        { name: "event_date", label: "Date", type: "date", required: true },
        { name: "end_date", label: "End date", type: "date" },
        { name: "venue_id", label: "Venue", type: "select", options: (venues.data ?? []).map((v) => ({ value: String(v.id), label: v.name })) },
        { name: "location_text", label: "Location text", hint: "Use for venues not in the list" },
        { name: "status", label: "Status", type: "select", required: true, default: "draft", options: STATUS_OPTIONS },
        { name: "registration_url", label: "Registration link", type: "url" },
        { name: "description", label: "Description", type: "textarea" },
        { name: "cover_image_url", label: "Cover image", type: "image" },
        { name: "slug", label: "URL slug" },
      ]}
      columns={[
        { key: "title", label: "Event", render: (r) => <span className="font-medium">{r.title}</span> },
        { key: "event_date", label: "Date", render: (r) => fmtDate(r.event_date) },
        { key: "location_text", label: "Location" },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
      ]}
    />
  );
}
