import { useState } from "react";

import { SessionList } from "@/components/portal/session-list";
import { Card, ErrorNote, Loading, PageHeader } from "@/components/ui";
import { Tabs } from "@/components/ui-client";
import { MonthPicker } from "@/components/portal/month-picker";
import { useApi } from "@/lib/api";
import { monthISO } from "@/lib/format";

export default function CoachSchedule() {
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
  const [month, setMonth] = useState(monthISO());
  const { data, error } = useApi<any[]>(tab === "upcoming" ? "/coach/sessions?scope=upcoming" : `/coach/sessions?scope=history&month=${month}`);
  return (
    <>
      <PageHeader title="Schedule & history" actions={tab === "history" ? <MonthPicker value={month} onChange={setMonth} /> : null} />
      <Tabs tabs={[{ value: "upcoming", label: "Upcoming" }, { value: "history", label: "History" }]} value={tab} onChange={setTab} />
      <ErrorNote error={error} />
      {!data ? <Loading /> : <Card><SessionList sessions={data} hrefBase="/coach/sessions" empty="No sessions in this period." /></Card>}
    </>
  );
}
