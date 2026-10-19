import { ProfileEditor } from "@/components/portal/profile";
import { PageHeader } from "@/components/ui";

export default function CoachProfilePage() {
  return (
    <>
      <PageHeader title="Profile" subtitle="Your public coach profile (bio, certifications, photo) is managed by the admin." />
      <ProfileEditor />
    </>
  );
}
