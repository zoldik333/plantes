import { Button, Card, Notice, useAction } from "../../components/ui";
import { authClient } from "../../lib/auth-client";

const deviceName = () => (/iPhone|iPad/.test(navigator.userAgent) ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android" : "Ordinateur");

export function PasskeysCard() {
  const { data: passkeys, isPending } = authClient.useListPasskeys();
  const { busy, error, run } = useAction();

  const add = () =>
    void run(async () => {
      const res = await authClient.passkey.addPasskey({ name: deviceName() });
      if (res?.error) throw new Error("Passkey non créée (annulée ou non prise en charge sur cet appareil).");
    });

  const remove = (id: string) =>
    void run(async () => {
      const res = await authClient.passkey.deletePasskey({ id });
      if (res.error) throw new Error("Suppression impossible.");
    });

  return (
    <Card title="🔑 Connexion sans mot de passe">
      <p className="text-sm text-stone-600">
        Une passkey te connecte avec Face ID ou ton empreinte. C'est aussi ta solution de secours si tu oublies ton mot de passe.
      </p>
      {isPending ? null : passkeys && passkeys.length > 0 ? (
        <ul className="flex flex-col divide-y divide-stone-100">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2">
              <span>
                {p.name ?? "Passkey"}
                <span className="block text-xs text-stone-500">
                  Ajoutée le {p.createdAt ? new Date(p.createdAt).toLocaleDateString("fr-FR") : "—"}
                </span>
              </span>
              <Button variant="danger" className="min-h-9 px-3 py-1 text-sm" disabled={busy} onClick={() => remove(p.id)}>
                Retirer
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Notice>Aucune passkey enregistrée.</Notice>
      )}
      <Button variant="secondary" onClick={add} disabled={busy}>
        Ajouter une passkey sur cet appareil
      </Button>
      {error && <Notice kind="error">{error}</Notice>}
    </Card>
  );
}
