import { useState } from "react";
import { useParams } from "react-router";

import { EntityForm } from "@/components/admin/crud";
import { VENUE_FIELDS } from "@/components/admin/fields";
import { SimpleForm } from "@/components/admin/forms";
import { Button, Card, CardHeader, ErrorNote, Loading, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { ConfirmButton, useAction } from "@/components/ui-client";
import { api, useApi } from "@/lib/api";
import { fmtDate, inr, titleCase, todayISO } from "@/lib/format";

export default function VenueDetail() {
  const { id } = useParams();
  const { data: v, error, mutate } = useApi<any>(`/admin/venues/${id}`);
  const { data: settings } = useApi<any>("/admin/settings");
  const [modal, setModal] = useState<null | "edit" | "rates">(null);
  const { run } = useAction();
  if (error) return <ErrorNote error={error} />;
  if (!v) return <Loading />;
  const cr = v.current_rates;
  return (
    <>
      <PageHeader title={v.name} subtitle={`${v.address ?? ""} ${v.city ? `· ${v.city}` : ""}`} back={{ href: "/admin/venues", label: "Venues" }}
        actions={<><Button variant="secondary" onClick={() => setModal("edit")}>Edit venue</Button><Button onClick={() => setModal("rates")}>Change rates</Button></>} />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {["weekday_morning", "weekday_evening", "weekend_morning", "weekend_evening"].map((k) => (
          <Stat key={k} label={titleCase(k)} value={cr[k] != null ? `${inr(cr[k])}/h` : "Not set"} tone={cr[k] == null ? "bad" : undefined} hint="per court" />
        ))}
      </div>
      {settings && (
        <p className="mb-4 text-sm text-muted">
          Sessions starting before {settings.morning_evening_boundary.slice(0, 5)} use the morning rate. Weekend days are set in Settings.
        </p>
      )}
      <Card>
        <CardHeader title="Rate history" subtitle="Effective-dated: a new rate closes the previous one the day before." />
        <Table>
          <thead><tr><Th>Day type</Th><Th>Time slot</Th><Th>From</Th><Th>To</Th><Th right>Rate / court / hour</Th><Th /></tr></thead>
          <tbody>
            {v.rates.map((r: any) => (
              <tr key={r.id}>
                <Td>{titleCase(r.day_type)}</Td><Td>{titleCase(r.time_slot)}</Td><Td>{fmtDate(r.effective_from)}</Td><Td>{r.effective_to ? fmtDate(r.effective_to) : "Current"}</Td><Td right>{inr(r.hourly_rate)}</Td>
                <Td right><ConfirmButton variant="ghost" confirm="Delete this rate row?" onConfirm={() => run(async () => { await api(`/admin/venues/${v.id}/rates/${r.id}`, { method: "DELETE" }); mutate(); })}>Delete</ConfirmButton></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {modal === "edit" && <EntityForm title="Edit venue" fields={VENUE_FIELDS} row={v} endpoint="/admin/venues" onClose={() => setModal(null)} onSaved={() => { setModal(null); mutate(); }} />}
      {modal === "rates" && (
        <SimpleForm
          title="Change court rates"
          intro={<p className="text-sm text-muted">Leave a slot empty to keep its current rate.</p>}
          fields={[
            { name: "effective_from", label: "Effective from", type: "date", required: true, default: todayISO(), full: true },
            { name: "weekday_morning", label: "Weekday morning (₹/court/h)", type: "number", default: cr.weekday_morning ?? "" },
            { name: "weekday_evening", label: "Weekday evening", type: "number", default: cr.weekday_evening ?? "" },
            { name: "weekend_morning", label: "Weekend morning", type: "number", default: cr.weekend_morning ?? "" },
            { name: "weekend_evening", label: "Weekend evening", type: "number", default: cr.weekend_evening ?? "" },
          ]}
          transform={(b) => {
            const out: Record<string, unknown> = { effective_from: b.effective_from };
            for (const k of ["weekday_morning", "weekday_evening", "weekend_morning", "weekend_evening"]) {
              out[k] = b[k] !== null && (cr[k] == null || Number(b[k]) !== Number(cr[k])) ? b[k] : null;
            }
            return out;
          }}
          endpoint={`/admin/venues/${v.id}/rates`}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); mutate(); }}
        />
      )}
    </>
  );
}
