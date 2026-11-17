import { useEffect, useState } from "react";
import { Card, Notice, Page } from "../components/ui";
import { api } from "../lib/api";
import { SignupForm } from "./SignupForm";

export default function Join({ token }: { token: string }) {
  const [info, setInfo] = useState<{ householdName: string; invitedBy: string } | "invalid" | null>(null);

  useEffect(() => {
    api<{ householdName: string; invitedBy: string }>(`/api/invitations/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch(() => setInfo("invalid"));
  }, [token]);

  return (
    <Page>
      <h1 className="pt-6 text-center text-3xl font-bold text-leaf-800">🌿 Plantes</h1>
      {info === null && <Notice>Vérification de l'invitation…</Notice>}
      {info === "invalid" && <Notice kind="error">Cette invitation est invalide, expirée ou déjà utilisée. Demande-en une nouvelle.</Notice>}
      {info && info !== "invalid" && (
        <Card title={`${info.invitedBy} t'invite à rejoindre « ${info.householdName} »`}>
          <SignupForm extra={{ inviteToken: token }} />
        </Card>
      )}
    </Page>
  );
}
