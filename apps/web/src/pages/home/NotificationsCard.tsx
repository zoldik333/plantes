import { useState } from "react";
import { Button, Card, Notice, useAction } from "../../components/ui";
import { enablePush, sendTestPush } from "../../lib/push";

export function NotificationsCard() {
  const { busy, error, run } = useAction();
  const [status, setStatus] = useState<string | null>(null);

  return (
    <Card title="🔔 Notifications">
      <Button
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
      {status && <Notice kind="ok">{status}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
    </Card>
  );
}
