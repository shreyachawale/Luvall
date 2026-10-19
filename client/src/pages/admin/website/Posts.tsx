import { Link } from "react-router";

import { CrudPage, STATUS_OPTIONS } from "@/components/admin/crud";
import { Badge, StatusBadge } from "@/components/ui";
import { fmtDateTime, titleCase } from "@/lib/format";

const CATEGORIES = ["achievement", "tournament", "event", "academy_update"].map((v) => ({ value: v, label: titleCase(v) }));

export default function PostsAdmin() {
  return (
    <CrudPage
      title="Posts & campaigns"
      subtitle="Achievements, tournaments, events and academy updates. Published posts appear on the homepage and News page automatically."
      endpoint="/admin/posts"
      singular="post"
      filters={[{ name: "status", label: "Status", options: STATUS_OPTIONS }, { name: "category", label: "Category", options: CATEGORIES }]}
      fields={[
        { name: "title", label: "Campaign title", required: true, full: true },
        { name: "category", label: "Category", type: "select", required: true, default: "achievement", options: CATEGORIES },
        { name: "status", label: "Status", type: "select", required: true, default: "draft", options: STATUS_OPTIONS },
        { name: "summary", label: "Short description", type: "textarea", hint: "Shown on cards" },
        { name: "body", label: "Full story", type: "textarea" },
        { name: "cover_image_url", label: "Cover image", type: "image" },
        { name: "image_ids", label: "Photo gallery", type: "images" },
        { name: "video_url", label: "Video / reel URL", type: "url", full: true, hint: "YouTube, Instagram reel, Vimeo or Facebook link — embedded, not uploaded" },
        { name: "publish_from", label: "Publish on", type: "datetime", hint: "Leave empty to publish immediately" },
        { name: "publish_to", label: "Expires on", type: "datetime", hint: "Optional — hides the post after this time" },
        { name: "is_featured", label: "Feature on the homepage", type: "checkbox" },
        { name: "slug", label: "URL slug", hint: "Generated from the title if empty" },
      ]}
      columns={[
        { key: "title", label: "Title", render: (r) => <><span className="font-medium">{r.title}</span>{r.is_featured && <Badge tone="lime" className="ml-2">Featured</Badge>}<span className="block text-xs text-muted">/news/{r.slug}</span></> },
        { key: "category", label: "Category", render: (r) => titleCase(r.category) },
        { key: "media", label: "Media", render: (r) => <span className="text-xs">{r.images?.length ?? 0} photos{r.video_url ? " · video" : ""}</span> },
        { key: "publish_from", label: "Window", render: (r) => <span className="text-xs">{r.publish_from ? fmtDateTime(r.publish_from) : "Now"} → {r.publish_to ? fmtDateTime(r.publish_to) : "no expiry"}</span> },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
        { key: "view", label: "", render: (r) => r.status === "published" ? <Link to={`/news/${r.slug}`} target="_blank" className="text-xs text-court-700 underline">View</Link> : null },
      ]}
    />
  );
}
