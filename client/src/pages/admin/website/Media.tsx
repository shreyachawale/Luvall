import { Film, Trash2, Upload } from "lucide-react";
import { useState } from "react";

import { SimpleForm } from "@/components/admin/forms";
import { Button, Card, EmptyState, ErrorNote, Input, Loading, PageHeader, Select } from "@/components/ui";
import { ConfirmButton, useAction, useToast } from "@/components/ui-client";
import { api, qs, useApi } from "@/lib/api";

export default function MediaLibrary() {
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi<any>(`/admin/media${qs({ media_type: type, page, page_size: 48 })}`);
  const albums = useApi<any>("/admin/albums?page_size=100");
  const [album, setAlbum] = useState("");
  const [uploading, setUploading] = useState(0);
  const [video, setVideo] = useState(false);
  const toast = useToast();
  const { run } = useAction();
  const upload = async (files: FileList) => {
    setUploading(files.length);
    let ok = 0;
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      form.append("caption", file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
      if (album) form.append("album_id", album);
      try {
        await api("/admin/media/upload", { form });
        ok += 1;
      } catch (e) {
        toast(`${file.name}: ${e instanceof Error ? e.message : "failed"}`, "error");
      }
      setUploading((n) => n - 1);
    }
    if (ok) toast(`${ok} image(s) uploaded`);
    mutate();
  };
  return (
    <>
      <PageHeader
        title="Media library"
        subtitle="Images are resized and converted to WebP automatically. Videos are embedded from YouTube/Instagram, never uploaded."
        actions={
          <>
            <Button variant="secondary" onClick={() => setVideo(true)}><Film size={16} /> Add video link</Button>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-court px-4 text-sm font-semibold text-white hover:bg-court-700">
              <Upload size={16} /> {uploading ? `Uploading ${uploading}…` : "Upload images"}
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => e.target.files && upload(e.target.files)} />
            </label>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select className="w-auto" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Type">
          <option value="">All media</option><option value="image">Images</option><option value="video">Videos</option>
        </Select>
        <Select className="w-auto" value={album} onChange={(e) => setAlbum(e.target.value)} aria-label="Upload into album">
          <option value="">Upload without album</option>
          {albums.data?.items?.map((a: any) => <option key={a.id} value={a.id}>Upload into: {a.title}</option>)}
        </Select>
      </div>
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.items.length === 0 ? <EmptyState title="No media yet">Upload photos from your phone or computer.</EmptyState> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {data.items.map((m: any) => (
            <Card key={m.id} className="overflow-hidden">
              {m.media_type === "image" ? (
                <a href={m.storage_url} target="_blank" rel="noopener noreferrer"><img src={m.thumbnail_url ?? m.storage_url} alt={m.alt_text ?? ""} className="aspect-[4/3] w-full object-cover" loading="lazy" /></a>
              ) : (
                <a href={m.storage_url} target="_blank" rel="noopener noreferrer" className="grid aspect-[4/3] place-items-center bg-court-950 text-white"><Film /></a>
              )}
              <div className="space-y-2 p-2">
                <Input
                  aria-label="Caption"
                  defaultValue={m.caption ?? ""}
                  placeholder="Caption"
                  className="h-8 py-1 text-xs"
                  onBlur={(e) => e.target.value !== (m.caption ?? "") && run(() => api(`/admin/media/${m.id}`, { method: "PATCH", body: { caption: e.target.value, alt_text: e.target.value } }), "Caption saved")}
                />
                <div className="flex items-center justify-between text-xs text-muted">
                  <button className="underline" onClick={() => { navigator.clipboard?.writeText(m.storage_url); toast("URL copied"); }}>Copy URL</button>
                  <ConfirmButton variant="ghost" confirm="Delete this file? It disappears from every post and album using it." onConfirm={() => run(async () => { await api(`/admin/media/${m.id}`, { method: "DELETE" }); mutate(); }, "Deleted")}>
                    <Trash2 size={14} />
                  </ConfirmButton>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {data && data.total > data.page_size && (
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button size="sm" variant="secondary" disabled={page * data.page_size >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
      {video && (
        <SimpleForm
          title="Add a video or reel"
          fields={[
            { name: "url", label: "Video link", type: "url", required: true, full: true, placeholder: "https://www.instagram.com/reel/…" },
            { name: "caption", label: "Caption", full: true },
            { name: "album_id", label: "Add to album", type: "select", options: (albums.data?.items ?? []).map((a: any) => ({ value: String(a.id), label: a.title })) },
          ]}
          transform={(b) => ({ ...b, album_id: b.album_id || null })}
          endpoint="/admin/media/video"
          onClose={() => setVideo(false)}
          onDone={() => { setVideo(false); mutate(); }}
        />
      )}
    </>
  );
}
