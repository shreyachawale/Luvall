import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { EntityForm } from "@/components/admin/crud";
import { STUDENT_FIELDS } from "@/components/admin/fields";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Loading, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { qs, useApi } from "@/lib/api";
import { inr, titleCase } from "@/lib/format";

export default function Students() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const dues = params.get("dues") === "1";
  const { data, error, mutate } = useApi<any>(`/admin/students${qs({ q, status, dues: dues || null, page })}`);
  return (
    <>
      <PageHeader title="Students" subtitle="Profiles, enrollments, packages, payments, attendance, credits and ledgers." actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> Add student</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={16} className="absolute left-3 top-2.5 text-muted" />
          <Input className="pl-9" placeholder="Name, mobile or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </Select>
        <Button variant={dues ? "primary" : "secondary"} onClick={() => navigate(dues ? "/admin/students" : "/admin/students?dues=1", { replace: true })}>With dues</Button>
      </div>
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.items.length === 0 ? <EmptyState title="No students found" /> : (
        <Card>
          <Table>
            <thead><tr><Th>Name</Th><Th>Mobile</Th><Th>Level</Th><Th>Batches</Th><Th>Status</Th><Th right>Balance</Th></tr></thead>
            <tbody>
              {data.items.map((s: any) => (
                <tr key={s.id} className="hover:bg-stone-50/70">
                  <Td><Link to={`/admin/students/${s.id}`} className="font-medium text-court-700 hover:underline">{s.name}</Link>{s.source === "walk_in" && <Badge className="ml-2">Walk-in</Badge>}{!s.has_login && <Badge className="ml-2">No login</Badge>}</Td>
                  <Td>{s.mobile}</Td>
                  <Td>{titleCase(s.skill_level)}</Td>
                  <Td className="num">{s.active_batches}</Td>
                  <Td><StatusBadge status={s.profile_status} /></Td>
                  <Td right className={s.balance < 0 ? "font-semibold text-red-700" : s.balance > 0 ? "text-court-700" : ""}>{inr(s.balance)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="text-muted">{data.total} students</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="secondary" disabled={page * data.page_size >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        </Card>
      )}
      {creating && (
        <EntityForm title="Add student" fields={STUDENT_FIELDS} endpoint="/admin/students" onClose={() => setCreating(false)}
          onSaved={(s) => { setCreating(false); mutate(); navigate(`/admin/students/${s.id}`); }} />
      )}
    </>
  );
}
