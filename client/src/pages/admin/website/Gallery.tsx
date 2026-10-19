import { useState } from "react";

import { CrudPage, MediaPicker, STATUS_OPTIONS } from "@/components/admin/crud";
import { Button, StatusBadge } from "@/components/ui";
import { Modal, useAction } from "@/components/ui-client";
import { api, useApi } from "@/lib/api";

export default function GalleryAdmin() {
  const [managing, setManaging] = useState<any>(null);
  return (
    <>
      <CrudPage
        title="Gallery albums"
        subtitle="Group photos and videos into albums. Upload files in the Media library, then add them to an album."
        endpoint="/admin/albums"
        singular="album"
        filters={[{ name: "status", label: "Status", options: STATUS_OPTIONS }]}
        fields={[
          { name: "title", label: "Title", required: true },
          { name: "status", label: "Status", type: "select", required: true, default: "draft", options: STATUS_OPTIONS },
          { name: "description", label: "Description", type: "textarea" },
          { name: "display_order", label: "Display order", type: "number", default: 0 },
          { name: "slug", label: "URL slug" },
        ]}
        columns={[
          { key: "title", label: "Album", render: (r) => <span className="font-medium">{r.title}</span> },
          { key: "items", label: "Items", right: true, render: (r) => r.items.length },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
        ]}
        extraActions={(row, reload) => (
          <Button size="sm" variant="secondary" onClick={() => setManaging({ row, reload })}>Photos & videos</Button>
        )}
      />
      {managing && <AlbumItems album={managing.row} onClose={() => setManaging(null)} onDone={() => { managing.reload(); setManaging(null); }} />}
    </>
  );
}

function AlbumItems({ album, onClose, onDone }: { album: any; onClose: () => void; onDone: () => void }) {
  const [ids, setIds] = useState<string[]>(album.items.filter((i: any) => i.media_type === "image").map((i: any) => i.id));
  const videos = album.items.filter((i: any) => i.media_type === "video");
  const allVideos = useApi<any>("/admin/media?media_type=video&page_size=100");
  const [videoIds, setVideoIds] = useState<string[]>(videos.map((v: any) => v.id));
  const { busy, run } = useAction();
  return (
    <Modal open onClose={onClose} title={`Items in “${album.title}”`} wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => run(async () => { await api(`/admin/albums/${album.id}/items`, { method: "PUT", body: [...ids, ...videoIds] }); onDone(); }, "Album updated")}>Save</Button></>}>
      <h3 className="mb-2 text-sm font-semibold">Photos</h3>
      <MediaPicker value={ids} onChange={setIds} />
      <h3 className="mb-2 mt-6 text-sm font-semibold">Videos & reels</h3>
      <div className="space-y-1">
        {(allVideos.data?.items ?? []).map((v: any) => (
          <label key={v.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={videoIds.includes(v.id)} onChange={(e) => setVideoIds(e.target.checked ? [...videoIds, v.id] : videoIds.filter((x) => x !== v.id))} />
            {v.caption || v.storage_url}
          </label>
        ))}
        {allVideos.data?.items?.length === 0 && <p className="text-sm text-muted">Add video links in the Media library.</p>}
      </div>
    </Modal>
  );
}
