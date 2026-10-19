import { Link } from "react-router";

import { CrudPage } from "@/components/admin/crud";
import { Badge, Notice, StatusBadge } from "@/components/ui";
import { inr, titleCase } from "@/lib/format";

export default function PricingPage() {
  return (
    <>
      <CrudPage
        title="Fee plans"
        subtitle="Reusable packages. Link one to a batch; student-specific prices and discounts are set on each student's package."
        endpoint="/admin/fee-plans"
        singular="fee plan"
        filters={[{ name: "status", label: "Status", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] }]}
        fields={[
          { name: "name", label: "Name", required: true, placeholder: "Monthly — 8 sessions" },
          { name: "plan_type", label: "Type", type: "select", required: true, default: "monthly", options: [{ value: "monthly", label: "Monthly" }, { value: "package", label: "Session package" }, { value: "per_session", label: "Per session" }] },
          { name: "number_of_sessions", label: "Sessions included", type: "number", required: true },
          { name: "base_fee", label: "Fee (₹)", type: "number", required: true },
          { name: "validity_days", label: "Validity (days)", type: "number", hint: "Used when the batch has no end date" },
          { name: "status", label: "Status", type: "select", required: true, default: "active", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] },
          { name: "is_public", label: "Show on the website", type: "checkbox", default: true },
          { name: "description", label: "Description", type: "textarea" },
        ]}
        columns={[
          { key: "name", label: "Plan", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "plan_type", label: "Type", render: (r) => titleCase(r.plan_type) },
          { key: "number_of_sessions", label: "Sessions", right: true },
          { key: "base_fee", label: "Fee", right: true, render: (r) => inr(r.base_fee) },
          { key: "per", label: "Per session", right: true, render: (r) => inr(r.base_fee / r.number_of_sessions, true) },
          { key: "status", label: "Status", render: (r) => <><StatusBadge status={r.status} />{!r.is_public && <Badge className="ml-1">Hidden</Badge>}</> },
        ]}
      />
      <div className="mt-6">
        <Notice>
          Coach hourly rates are set per coach (<Link className="underline" to="/admin/coaches">Coaches</Link>), court rates per venue (<Link className="underline" to="/admin/venues">Venues</Link>), and the drop-in fee, make-up and cancellation rules in <Link className="underline" to="/admin/settings">Settings</Link>. All rates are effective-dated so changes never rewrite history.
        </Notice>
      </div>
    </>
  );
}
