import { useParams } from "react-router";

import { AttendanceEditor } from "@/components/portal/attendance-editor";
import { PageHeader } from "@/components/ui";

export default function CoachSession() {
  const { id } = useParams();
  return (
    <>
      <PageHeader title="Session attendance" back={{ href: "/coach", label: "Back" }} />
      <AttendanceEditor key={id} sessionId={id!} admin={false} />
    </>
  );
}
