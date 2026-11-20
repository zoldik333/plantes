import { useState } from "react";
import type { ApiTokenCreated, ApiTokenSummary } from "@plantes/shared";
import { Icon } from "../../components/Icon";
import { Button, Card, Field, LinkBox, Notice, useAction } from "../../components/ui";
import { api } from "../../lib/api";
import { useFetch } from "../../lib/fetch";

const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/** Jetons personnels du raccourci iOS. Le jeton en clair n'existe qu'en mémoire, le temps de l'afficher une fois. */
export function ShortcutCard() {
  const { data: tokens, reload } = useFetch<ApiTokenSummary[]>("/api/tokens");
  const { busy, error, run } = useAction();
  const [name, setName] = useState("iPhone");
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);
  const base = window.location.origin;

  const create = () =>
    void run(async () => {
      setCreated(await api<ApiTokenCreated>("/api/tokens", { method: "POST", json: { name } }));
      await reload();
    });

  const revoke = (t: ApiTokenSummary) => {
    if (!window.confirm(`Révoquer le jeton « ${t.name} » ? Les raccourcis qui l'utilisent cesseront de fonctionner.`)) return;
    void run(async () => {
      await api(`/api/tokens/${t.id}`, { method: "DELETE" });
      if (created?.id === t.id) setCreated(null);
      await reload();
    });
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Icon name="key" className="text-leaf" />
          Raccourci iOS
        </span>
      }
    >
      <p className="text-body-sm text-ink-muted">
        Un jeton permet à l'app Raccourcis d'arroser une plante ou de lire ce qu'il y a à arroser, par Siri ou depuis l'écran d'accueil. Il donne accès à
        l'arrosage de tout le foyer : ne le partage pas.
      </p>

      {created && (
        <div className="flex flex-col gap-2">
          <Notice kind="warning" icon="alert">
            Copie ce jeton maintenant : il ne sera plus jamais affiché. S'il est perdu, révoque-le et crées-en un autre.
          </Notice>
          <LinkBox url={created.token} hint={`Jeton « ${created.name} ». À coller dans l'en-tête Authorization, après le mot Bearer.`} />
        </div>
      )}

      {tokens && tokens.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-3">
              <span className="min-w-0">
                <span className="text-label text-ink">{t.name}</span>
                <span className="block text-caption text-ink-muted">
                  Créé le {day(t.createdAt)} · {t.lastUsedAt ? `utilisé le ${day(t.lastUsedAt)}` : "jamais utilisé"}
                </span>
              </span>
              <Button variant="danger" icon="trash" className="shrink-0 px-4 text-label" disabled={busy} onClick={() => revoke(t)}>
                Révoquer
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <Field label="Nom du jeton" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="secondary" icon="plus" disabled={busy || !name.trim()}>
          Créer un jeton
        </Button>
      </form>
      {error && <Notice kind="error">{error}</Notice>}

      <details className="rounded-md bg-surface-sunken p-4 text-body-sm text-ink">
        <summary className="cursor-pointer text-label">Comment l'utiliser</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>
            Dans l'app Raccourcis, ajoute l'action « Obtenir le contenu de l'URL » avec l'adresse{" "}
            <code className="rounded-sm bg-surface px-1.5 py-0.5 break-all select-all">{base}/api/shortcuts/today</code>
          </li>
          <li>
            Ajoute l'en-tête <code className="rounded-sm bg-surface px-1.5 py-0.5">Authorization</code> avec la valeur{" "}
            <code className="rounded-sm bg-surface px-1.5 py-0.5">Bearer </code> suivie du jeton.
          </li>
          <li>Ajoute « Énoncer le texte » sur le champ <code className="rounded-sm bg-surface px-1.5 py-0.5">text</code> de la réponse.</li>
        </ol>
        <p className="mt-3 text-ink-muted">
          Pour arroser : requête POST vers <code className="rounded-sm bg-surface px-1.5 py-0.5 break-all">{base}/api/shortcuts/water</code> avec un
          corps JSON <code className="rounded-sm bg-surface px-1.5 py-0.5">{`{"plant": "Monstera"}`}</code>. Guide complet : docs/raccourci-ios.md dans le projet.
        </p>
      </details>
    </Card>
  );
}
