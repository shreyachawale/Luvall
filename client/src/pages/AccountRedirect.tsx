import { useEffect } from "react";
import { useNavigate } from "react-router";

import { homeFor } from "@/components/auth/auth-forms";
import { Seo } from "@/components/seo";
import { Loading } from "@/components/ui";
import { api } from "@/lib/api";

export default function AccountRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    api<{ roles: string[] }>("/auth/me")
      .then((me) => navigate(homeFor(me.roles), { replace: true }))
      .catch(() => navigate("/login", { replace: true }));
  }, [navigate]);
  return (
    <div className="container-page">
      <Seo description="Pickleball coaching batches for every level." />
      <Loading label="Opening your dashboard…" />
    </div>
  );
}
