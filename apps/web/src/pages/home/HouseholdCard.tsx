import { useState } from "react";
import { Button, Card, LinkBox, Notice, useAction } from "../../components/ui";
import { api } from "../../lib/api";
import type { Me } from "../../lib/me";

interface Link {
  url: string;
  expiresAt: string;
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

export function HouseholdCard({ me }: { me: Me }) {
  const { busy, error, run } = useAction();
  const [invite, setInvite] = useState<Link | null>(null);
  const [reset, setReset] = useState<{ name: string; link: Link } | null>(null);

  const createInvite = () =>
    void run(async () => {
      setInvite(await api<Link>("/api/household/invitations", { method: "POST" }));
    });

  const createReset = (id: string, name: string) =>
    void run(async () => {
      setReset({ name, link: await api<Link>(`/api/household/members/${id}/reset-link`, { method: "POST" }) });
    });

  return (
    <Card title={`🏠 ${me.household.name}`}>
      <ul className="flex flex-col divide-y divide-stone-100">
        {me.household.members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium">{m.name}</span>
              {m.id === me.user.id && <span className="ml-1 text-sm text-stone-500">(toi)</span>}
              <span className="block text-sm text-stone-500">{m.email}</span>
            </span>
            {m.id !== me.user.id && (
              <Button variant="secondary" className="min-h-9 px-3 py-1 text-sm" disabled={busy} onClick={() => createReset(m.id, m.name)}>
                Mot de passe oublié
              </Button>
            )}
          </li>
        ))}
      </ul>
      {reset && (
        <LinkBox
          url={reset.link.url}
          hint={`Envoie ce lien à ${reset.name} : il lui permet de choisir un nouveau mot de passe. Valable jusqu'au ${fmt(reset.link.expiresAt)}, à usage unique.`}
        />
      )}
      <Button variant="secondary" onClick={createInvite} disabled={busy}>
        ➕ Inviter quelqu'un
      </Button>
      {invite && (
        <LinkBox url={invite.url} hint={`Lien à usage unique, valable jusqu'au ${fmt(invite.expiresAt)}. Il donne accès à tout le foyer.`} />
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </Card>
  );
}
