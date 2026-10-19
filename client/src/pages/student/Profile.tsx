import { ProfileEditor } from "@/components/portal/profile";
import { PageHeader } from "@/components/ui";

export default function StudentProfile() {
  return (
    <>
      <PageHeader title="Profile" subtitle="Your contact details and password." />
      <ProfileEditor student />
    </>
  );
}
