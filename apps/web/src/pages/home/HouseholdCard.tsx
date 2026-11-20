import { useState } from "react";
import { Icon } from "../../components/Icon";
import { Button, Card, LinkBox, Notice, useAction } from "../../components/ui";
import { api } from "../../lib/api";
import { useMe, type Me } from "../../lib/me";

interface Link {
  url: string;
  expiresAt: string;
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

export function HouseholdCard({ me }: { me: Me }) {
  const { busy, error, run } = useAction();
  const [invite, setInvite] = useState<Link | null>(null);
  const { refresh } = useMe();
  const isOwner = me.household.ownerId === me.user.id;
  const [reset, setReset] = useState<{ name: string; link: Link } | null>(null);

  const createInvite = () =>
    void run(async () => {
      setInvite(await api<Link>("/api/household/invitations", { method: "POST" }));
    });

  const createReset = (id: string, name: string) =>
    void run(async () => {
      setReset({ name, link: await api<Link>(`/api/household/members/${id}/reset-link`, { method: "POST" }) });
    });

  const removeMember = (id: string, name: string) => {
    const ok = window.confirm(
      `Retirer ${name} du foyer ? Son compte et ses appareils seront supprimés définitivement. Les plantes et le journal restent. Si ${name} revient, il faudra une nouvelle invitation.`,
    );
    if (!ok) return;
    void run(async () => {
      await api(`/api/household/members/${id}`, { method: "DELETE" });
      if (reset) setReset(null);
      await refresh();
    });
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Icon name="users" className="text-leaf" />
          {me.household.name}
        </span>
      }
    >
      <ul className="flex flex-col divide-y divide-line">
        {me.household.members.map((m) => (
          <li key={m.id} className="flex flex-col gap-3 py-3">
            <span className="min-w-0">
              <span className="text-label text-ink">{m.name}</span>
              {m.id === me.user.id && <span className="ml-1 text-body-sm text-ink-muted">(toi)</span>}
              <span className="block truncate text-body-sm text-ink-muted">{m.email}</span>
            </span>
            {m.id !== me.user.id && (
              <span className="flex flex-wrap gap-2">
                <Button variant="secondary" icon="key" className="px-4 text-label" disabled={busy} onClick={() => createReset(m.id, m.name)}>
                  Mot de passe oublié
                </Button>
                {isOwner && (
                  <Button
                    variant="danger"
                    className="px-4 text-label"
                    aria-label={`Retirer ${m.name} du foyer`}
                    disabled={busy}
                    onClick={() => removeMember(m.id, m.name)}
                  >
                    Retirer du foyer
                  </Button>
                )}
              </span>
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
      <Button variant="secondary" icon="plus" onClick={createInvite} disabled={busy}>
        Inviter quelqu'un
      </Button>
      {invite && (
        <LinkBox url={invite.url} hint={`Lien à usage unique, valable jusqu'au ${fmt(invite.expiresAt)}. Il donne accès à tout le foyer.`} />
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </Card>
  );
}
