import { ImagePlus, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button, Card, EmptyState, ErrorNote, Field, Input, Loading, PageHeader, Select, Table, Td, Textarea, Th, cx } from "@/components/ui";
import { ConfirmButton, Modal, useAction } from "@/components/ui-client";
import { api, qs, uploadImage, useApi } from "@/lib/api";

export type Option = { value: string; label: string };
export type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "date" | "datetime" | "time" | "select" | "checkbox" | "image" | "url" | "images";
  options?: Option[];
  required?: boolean;
  hint?: string;
  full?: boolean;
  default?: unknown;
  placeholder?: string;
  step?: string;
};
export type ColumnDef<T = any> = { key: string; label: string; render?: (row: T) => ReactNode; right?: boolean };
export type FilterDef = { name: string; label: string; options: Option[] };

function toLocalInput(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function initialValues(fields: FieldDef[], row?: any): Record<string, any> {
  const v: Record<string, any> = {};
  for (const f of fields) {
    const raw = row ? row[f.name] : f.default;
    if (f.type === "checkbox") v[f.name] = row ? Boolean(raw) : Boolean(f.default);
    else if (f.type === "datetime") v[f.name] = toLocalInput(raw ?? null);
    else if (f.type === "images") v[f.name] = row?.images?.map((i: any) => i.id) ?? [];
    else v[f.name] = raw ?? "";
  }
  return v;
}

export function toPayload(fields: FieldDef[], values: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.type === "checkbox") out[f.name] = Boolean(v);
    else if (f.type === "number") out[f.name] = v === "" || v === null ? null : Number(v);
    else if (f.type === "datetime") out[f.name] = v ? new Date(v).toISOString() : null;
    else if (f.type === "images") out.image_ids = v ?? [];
    else out[f.name] = v === "" ? null : v;
  }
  return out;
}

export function ImageInput({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {value ? (
          <img src={value} alt="" className="h-16 w-24 rounded-lg border border-line object-cover" />
        ) : (
          <div className="grid h-16 w-24 place-items-center rounded-lg border border-dashed border-line text-muted"><ImagePlus size={18} /></div>
        )}
        <label className="cursor-pointer rounded-full border border-line bg-white px-3 py-1.5 text-sm font-semibold hover:bg-court-50">
          {busy ? "Uploading…" : "Upload"}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              setError(null);
              try {
                onChange((await uploadImage(file)).url);
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {value && <button type="button" className="text-sm text-muted underline" onClick={() => onChange("")}>Remove</button>}
      </div>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="…or paste an image URL" />
      <ErrorNote error={error} />
    </div>
  );
}

export function MediaPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { data } = useApi<any>("/admin/media?media_type=image&page_size=96");
  const [open, setOpen] = useState(false);
  const items: any[] = data?.items ?? [];
  const selected = items.filter((m) => value.includes(m.id));
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {selected.map((m) => (
          <img key={m.id} src={m.thumbnail_url ?? m.storage_url} alt="" className="h-14 w-20 rounded-lg object-cover" />
        ))}
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {value.length ? `Edit images (${value.length})` : "Choose from media library"}
        </Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Choose images" wide footer={<Button onClick={() => setOpen(false)}>Done</Button>}>
        {!data ? <Loading /> : items.length === 0 ? <p className="text-sm text-muted">Upload images in Website → Media first.</p> : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {items.map((m) => {
              const on = value.includes(m.id);
              return (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => onChange(on ? value.filter((x) => x !== m.id) : [...value, m.id])}
                  className={cx("overflow-hidden rounded-lg ring-2", on ? "ring-court-600" : "ring-transparent")}
                >
                  <img src={m.thumbnail_url ?? m.storage_url} alt={m.caption ?? ""} className="aspect-square w-full object-cover" />
                </button>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
  );
}

export function FormFields({ fields, values, setValues }: { fields: FieldDef[]; values: Record<string, any>; setValues: (v: Record<string, any>) => void }) {
  const set = (name: string, v: unknown) => setValues({ ...values, [name]: v });
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const common = { name: f.name, required: f.required, placeholder: f.placeholder };
        let control: ReactNode;
        switch (f.type) {
          case "textarea":
            control = <Textarea {...common} rows={5} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)} />;
            break;
          case "select":
            control = (
              <Select {...common} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                {!f.required && <option value="">—</option>}
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            );
            break;
          case "checkbox":
            return (
              <label key={f.name} className={cx("flex items-center gap-2 text-sm font-medium", f.full && "sm:col-span-2")}>
                <input type="checkbox" checked={Boolean(values[f.name])} onChange={(e) => set(f.name, e.target.checked)} className="h-4 w-4 accent-[var(--color-court)]" />
                {f.label}
                {f.hint && <span className="font-normal text-muted">— {f.hint}</span>}
              </label>
            );
          case "image":
            control = <ImageInput value={values[f.name] ?? ""} onChange={(v) => set(f.name, v)} />;
            break;
          case "images":
            control = <MediaPicker value={values[f.name] ?? []} onChange={(v) => set(f.name, v)} />;
            break;
          default:
            control = (
              <Input
                {...common}
                type={f.type === "datetime" ? "datetime-local" : f.type === "url" ? "url" : f.type ?? "text"}
                step={f.step ?? (f.type === "number" ? "any" : undefined)}
                value={values[f.name] ?? ""}
                onChange={(e) => set(f.name, e.target.value)}
              />
            );
        }
        return (
          <Field key={f.name} label={f.label} hint={f.hint} required={f.required} className={cx((f.full || f.type === "textarea" || f.type === "image" || f.type === "images") && "sm:col-span-2")}>
            {control}
          </Field>
        );
      })}
    </div>
  );
}

export function EntityForm({
  title,
  fields,
  row,
  endpoint,
  onClose,
  onSaved,
}: {
  title: string;
  fields: FieldDef[];
  row?: any;
  endpoint: string;
  onClose: () => void;
  onSaved: (saved: any) => void;
}) {
  const [values, setValues] = useState(() => initialValues(fields, row));
  const { busy, run } = useAction();
  useEffect(() => setValues(initialValues(fields, row)), [row, fields]);
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="entity-form" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <form
        id="entity-form"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const saved = await api(row ? `${endpoint}/${row.id}` : endpoint, { method: row ? "PATCH" : "POST", body: toPayload(fields, values) });
            onSaved(saved);
          }, "Saved");
        }}
      >
        <FormFields fields={fields} values={values} setValues={setValues} />
      </form>
    </Modal>
  );
}

export function CrudPage({
  title,
  subtitle,
  endpoint,
  fields,
  columns,
  filters = [],
  searchable = true,
  singular = "item",
  allowCreate = true,
  allowDelete = true,
  extraActions,
}: {
  title: string;
  subtitle?: string;
  endpoint: string;
  fields: FieldDef[];
  columns: ColumnDef[];
  filters?: FilterDef[];
  searchable?: boolean;
  singular?: string;
  allowCreate?: boolean;
  allowDelete?: boolean;
  extraActions?: (row: any, reload: () => void) => ReactNode;
}) {
  const [q, setQ] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<any | null | undefined>(undefined);
  const { data, error, mutate } = useApi<any>(`${endpoint}${qs({ q, page, page_size: 50, ...filterValues })}`);
  const { run } = useAction();
  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={allowCreate && <Button onClick={() => setEditing(null)}><Plus size={16} /> New {singular}</Button>}
      />
      {(searchable || filters.length > 0) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {searchable && (
            <div className="relative w-full sm:w-72">
              <Search size={16} className="absolute left-3 top-2.5 text-muted" />
              <Input className="pl-9" placeholder="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            </div>
          )}
          {filters.map((f) => (
            <Select key={f.name} className="w-auto" aria-label={f.label} value={filterValues[f.name] ?? ""} onChange={(e) => { setFilterValues({ ...filterValues, [f.name]: e.target.value }); setPage(1); }}>
              <option value="">{f.label}: all</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          ))}
        </div>
      )}
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.items.length === 0 ? (
        <EmptyState title={`No ${title.toLowerCase()} yet`} action={allowCreate && <Button onClick={() => setEditing(null)}>Create the first one</Button>} />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                {columns.map((c) => <Th key={c.key} right={c.right}>{c.label}</Th>)}
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row: any) => (
                <tr key={row.id} className="hover:bg-stone-50/70">
                  {columns.map((c) => <Td key={c.key} right={c.right}>{c.render ? c.render(row) : row[c.key] ?? "—"}</Td>)}
                  <Td right>
                    <div className="flex justify-end gap-1">
                      {extraActions?.(row, () => mutate())}
                      <Button size="sm" variant="ghost" onClick={() => setEditing(row)} aria-label="Edit"><Pencil size={14} /></Button>
                      {allowDelete && (
                        <ConfirmButton variant="ghost" confirm={`Delete this ${singular}? This cannot be undone.`} onConfirm={() => run(async () => { await api(`${endpoint}/${row.id}`, { method: "DELETE" }); mutate(); }, "Deleted")}>
                          <Trash2 size={14} />
                        </ConfirmButton>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {data.total > data.page_size && (
            <div className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-muted">{data.total} total</span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={page * data.page_size >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </Card>
      )}
      {editing !== undefined && (
        <EntityForm
          title={editing ? `Edit ${singular}` : `New ${singular}`}
          fields={fields}
          row={editing ?? undefined}
          endpoint={endpoint}
          onClose={() => setEditing(undefined)}
          onSaved={() => { setEditing(undefined); mutate(); }}
        />
      )}
    </>
  );
}

export const STATUS_OPTIONS: Option[] = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];
