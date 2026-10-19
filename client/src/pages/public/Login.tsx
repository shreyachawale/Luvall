import { useSearchParams } from "react-router";

import { AuthShell, LoginForm } from "@/components/auth/auth-forms";
import { Seo } from "@/components/seo";
import { useApi } from "@/lib/api";

import type { Site } from "./PublicLayout";

export default function LoginPage() {
  const [params] = useSearchParams();
  const next = params.get("next") ?? undefined;
  const { data: site } = useApi<Site>("/public/site");
  return (
    <>
      <Seo title="Sign in" description={site?.content.seo_description} noindex />
      <AuthShell title="Welcome back" intro="Students, coaches and admins sign in here." panelTitle="Back on court" panelText="Your sessions, attendance, make-ups and payments in one place.">
        <LoginForm next={next} />
      </AuthShell>
    </>
  );
}
