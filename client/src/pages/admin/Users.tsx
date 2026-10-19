import { Plus, Search } from "lucide-react";
import { useState } from "react";

import { SimpleForm } from "@/components/admin/forms";
import { Badge, Button, Card, ErrorNote, Input, Loading, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { ConfirmButton, useAction } from "@/components/ui-client";
import { api, qs, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

export default function UsersPage() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi<any>(`/admin/users${qs({ q, role, page })}`);
  const [creating, setCreating] = useState(false);
  const [reset, setReset] = useState<any>(null);
  const { run } = useAction();
  const toggleRole = (u: any, r: string) => run(async () => { await api(`/admin/users/${u.id}/roles`, { body: { role: r, grant: !u.roles.includes(r) } }); mutate(); }, "Access updated");
  return (
    <>
      <PageHeader title="Users & access" subtitle="Role-based access: admins manage everything, coaches see their sessions, students see their own records." actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> Add admin</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-72"><Search size={16} className="absolute left-3 top-2.5 text-muted" /><Input className="pl-9" placeholder="Name or mobile" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        <Select className="w-auto" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label="Role"><option value="">All roles</option><option value="admin">Admins</option><option value="coach">Coaches</option><option value="student">Students</option></Select>
      </div>
      <ErrorNote error={error} />
      {!data ? <Loading /> : (
        <Card>
          <Table>
            <thead><tr><Th>User</Th><Th>Roles</Th><Th>Last sign-in</Th><Th>Status</Th><Th right>Actions</Th></tr></thead>
            <tbody>
              {data.items.map((u: any) => (
                <tr key={u.id}>
                  <Td><span className="font-medium">{u.name}</span><span className="block text-xs text-muted">{u.mobile}{u.email ? ` · ${u.email}` : ""}</span></Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {["admin", "coach", "student"].map((r) => (
                        <button key={r} onClick={() => toggleRole(u, r)} title={u.roles.includes(r) ? `Remove ${r}` : `Grant ${r}`}>
                          <Badge tone={u.roles.includes(r) ? "green" : "gray"} className={u.roles.includes(r) ? "" : "opacity-50"}>{u.roles.includes(r) ? "✓ " : "+ "}{r}</Badge>
                        </button>
                      ))}
                    </div>
                  </Td>
                  <Td className="text-xs">{u.has_login ? (u.last_login_at ? fmtDateTime(u.last_login_at) : "Never") : <Badge>No password</Badge>}</Td>
                  <Td><StatusBadge status={u.status} /></Td>
                  <Td right>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setReset(u)}>Password</Button>
                      <ConfirmButton confirm={u.status === "active" ? `Deactivate ${u.name}? They will be signed out and unable to sign in.` : `Reactivate ${u.name}?`}
                        onConfirm={() => run(async () => { await api(`/admin/users/${u.id}/status`, { body: { status: u.status === "active" ? "inactive" : "active" } }); mutate(); }, "Updated")}>
                        {u.status === "active" ? "Deactivate" : "Activate"}
                      </ConfirmButton>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="text-muted">{data.total} users</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="secondary" disabled={page * data.page_size >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        </Card>
      )}
      {creating && (
        <SimpleForm title="Add admin user" fields={[
          { name: "name", label: "Name", required: true },
          { name: "mobile", label: "Mobile", required: true },
          { name: "email", label: "Email" },
          { name: "password", label: "Password", required: true, hint: "At least 8 characters" },
        ]} endpoint="/admin/users" onClose={() => setCreating(false)} onDone={() => { setCreating(false); mutate(); }} />
      )}
      {reset && (
        <SimpleForm title={`Set password for ${reset.name}`} fields={[{ name: "new_password", label: "New password", required: true, hint: "Existing sessions are signed out" }]}
          endpoint={`/admin/users/${reset.id}/password`} onClose={() => setReset(null)} onDone={() => { setReset(null); mutate(); }} />
      )}
    </>
  );
}
