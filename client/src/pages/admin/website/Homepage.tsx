import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ImageInput } from "@/components/admin/crud";
import { Button, Card, CardHeader, ErrorNote, Field, Input, Loading, PageHeader, Textarea } from "@/components/ui";
import { useAction } from "@/components/ui-client";
import { api, useApi } from "@/lib/api";

const TEXT: [string, string, boolean?][] = [
  ["hero_eyebrow", "Hero tagline"],
  ["hero_title", "Hero headline"],
  ["hero_subtitle", "Hero sub-text", true],
];

export default function HomepageEditor() {
  const { data, error, mutate } = useApi<any>("/admin/site-content");
  const [v, setV] = useState<any>(null);
  const { busy, run } = useAction();
  useEffect(() => { if (data) setV(data); }, [data]);
  if (error) return <ErrorNote error={error} />;
  if (!v) return <Loading />;
  const set = (k: string, value: unknown) => setV({ ...v, [k]: value });
  const input = (k: string, label: string, textarea = false, hint?: string) => (
    <Field key={k} label={label} hint={hint} className={textarea ? "sm:col-span-2" : ""}>
      {textarea ? <Textarea rows={3} value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} /> : <Input value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} />}
    </Field>
  );
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(async () => mutate(await api("/admin/site-content", { method: "PUT", body: v })), "Homepage updated — live now"); }}>
      <PageHeader title="Homepage" subtitle="Changes go live immediately — no developer needed." actions={<Button type="submit" disabled={busy}>Save & publish</Button>} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Hero" />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            {TEXT.map(([k, l, t]) => input(k, l, t))}
            <Field label="Hero image" className="sm:col-span-2"><ImageInput value={v.hero_image_url} onChange={(u) => set("hero_image_url", u)} /></Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="About" />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            {input("about_title", "Title", false)}
            {input("about_body", "Text (blank line = new paragraph)", true)}
            <Field label="About image" className="sm:col-span-2"><ImageInput value={v.about_image_url} onChange={(u) => set("about_image_url", u)} /></Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Highlight numbers" subtitle="Shown under the hero" />
          <div className="space-y-2 p-5">
            {v.stats.map((st: any, i: number) => (
              <div key={i} className="grid grid-cols-[100px_1fr_36px] gap-2">
                <Input aria-label="Value" value={st.value} onChange={(e) => set("stats", v.stats.map((x: any, j: number) => (j === i ? { ...x, value: e.target.value } : x)))} />
                <Input aria-label="Label" value={st.label} onChange={(e) => set("stats", v.stats.map((x: any, j: number) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <button type="button" aria-label="Remove" className="text-muted hover:text-red-700" onClick={() => set("stats", v.stats.filter((_: any, j: number) => j !== i))}><Trash2 size={16} /></button>
              </div>
            ))}
            {v.stats.length < 6 && <Button type="button" size="sm" variant="secondary" onClick={() => set("stats", [...v.stats, { value: "", label: "" }])}><Plus size={14} /> Add</Button>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Contact & social" />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            {input("contact_phone", "Phone")}
            {input("contact_email", "Email")}
            {input("contact_hours", "Hours")}
            {input("instagram_url", "Instagram URL")}
            {input("youtube_url", "YouTube URL")}
            {input("facebook_url", "Facebook URL")}
            {input("contact_address", "Address", true)}
            {input("map_embed_url", "Google Maps embed URL", true, "Maps → Share → Embed a map → copy the src link")}
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Search engines" />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            {input("seo_title", "Page title")}
            {input("seo_description", "Meta description", true)}
          </div>
        </Card>
      </div>
    </form>
  );
}
