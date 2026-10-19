import { useSearchParams } from "react-router";

import { AuthShell, RegisterForm } from "@/components/auth/auth-forms";
import { Seo } from "@/components/seo";
import { useApi } from "@/lib/api";

import type { Site } from "./PublicLayout";

export default function RegisterPage() {
  const [params] = useSearchParams();
  const next = params.get("next") ?? undefined;
  const { data: site } = useApi<Site>("/public/site");
  return (
    <>
      <Seo title="Create account" description={site?.content.seo_description} noindex />
      <AuthShell title="Create your student account" intro="Join a batch, track your sessions, make-ups and payments in one place." panelTitle="Your game starts here" panelText="Pick a batch, pay by UPI and get on court with a certified coach.">
        <RegisterForm next={next} />
      </AuthShell>
    </>
  );
}
