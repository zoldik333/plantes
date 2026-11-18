import { useState } from "react";
import { Icon } from "../../components/Icon";
import { Button, Card, Notice, useAction } from "../../components/ui";
import { api } from "../../lib/api";
import { enablePush, sendTestPush } from "../../lib/push";

export function NotificationsCard() {
  const { busy, error, run } = useAction();
  const [status, setStatus] = useState<string | null>(null);

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Icon name="bell" className="text-leaf" />
          Notifications
        </span>
      }
    >
      <p className="text-body-sm text-ink-muted">
        Rappels à 9 h, et une relance à 18 h seulement s'il reste des plantes à arroser. Dès qu'un membre du foyer coche une plante, personne n'est
        plus relancé pour elle.
      </p>
      <Button
        variant="primary"
        icon="bell"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const total = await enablePush();
            setStatus(`Notifications activées (${total} appareil${total > 1 ? "s" : ""} abonné${total > 1 ? "s" : ""}).`);
          })
        }
      >
        Activer les notifications
      </Button>
      <Button
        variant="secondary"
        icon="clock"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await sendTestPush();
            setStatus("Notification envoyée dans 10 s : verrouille ton téléphone pour la voir arriver.");
          })
        }
      >
        M'envoyer une notification dans 10 s
      </Button>
      <Button
        variant="secondary"
        icon="drop"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const r = await api<{ plants: number; sent: number; total: number }>("/api/reminders/test", { method: "POST" });
            setStatus(
              r.total === 0
                ? "Aucun appareil abonné pour toi : active d'abord les notifications."
                : `Rappel envoyé à ${r.sent} appareil${r.sent > 1 ? "s" : ""} (${r.plants} plante${r.plants > 1 ? "s" : ""} à arroser en ce moment).`,
            );
          })
        }
      >
        Tester le vrai rappel
      </Button>
      {status && <Notice kind="ok">{status}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
    </Card>
  );
}
