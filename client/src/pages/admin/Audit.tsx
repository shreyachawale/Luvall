import { Search } from "lucide-react";
import { Fragment, useState } from "react";

import { Button, Card, ErrorNote, Input, Loading, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { qs, useApi } from "@/lib/api";
import { fmtDateTime, titleCase } from "@/lib/format";

export default function AuditPage() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, error } = useApi<any>(`/admin/audit${qs({ q, entity_type: type, page })}`);
  return (
    <>
      <PageHeader title="Activity log" subtitle="Who changed what and when — attendance, fees, payments, publishing and master data." />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-72"><Search size={16} className="absolute left-3 top-2.5 text-muted" /><Input className="pl-9" placeholder="Search summaries" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        <Select className="w-auto" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Type">
          <option value="">All types</option>
          {data?.entity_types?.map((t: string) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </Select>
      </div>
      <ErrorNote error={error} />
      {!data ? <Loading /> : (
        <Card>
          <Table>
            <thead><tr><Th>When</Th><Th>Who</Th><Th>What</Th><Th>Action</Th><Th>Summary</Th><Th /></tr></thead>
            <tbody>
              {data.items.map((a: any) => (
                <Fragment key={a.id}>
                  <tr>
                    <Td className="text-xs">{fmtDateTime(a.created_at)}</Td>
                    <Td>{a.user_name ?? "System"}</Td>
                    <Td className="text-xs">{titleCase(a.entity_type)} #{a.entity_id}</Td>
                    <Td className="text-xs">{titleCase(a.action)}</Td>
                    <Td className="max-w-md whitespace-normal text-xs">{a.summary}</Td>
                    <Td right>{(a.old_value_json || a.new_value_json) && <Button size="sm" variant="ghost" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? "Hide" : "Changes"}</Button>}</Td>
                  </tr>
                  {open === a.id && (
                    <tr>
                      <td colSpan={6} className="bg-stone-50 px-4 py-3">
                        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-white p-3"><strong>Before</strong>{"\n"}{JSON.stringify(a.old_value_json, null, 2) ?? "—"}</pre>
                          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-white p-3"><strong>After</strong>{"\n"}{JSON.stringify(a.new_value_json, null, 2) ?? "—"}</pre>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="text-muted">{data.total} entries</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="secondary" disabled={page * data.page_size >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
