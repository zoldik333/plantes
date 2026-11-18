import type { SheetJob } from "@plantes/shared";
import { Button, Notice } from "./ui";

/** Où en est la génération de fiche : file d'attente, en cours, ou erreur avec relance. */
export function SheetStatus({ job, busy, onRetry }: { job: SheetJob; busy: boolean; onRetry: () => void }) {
  if (job.status === "error") {
    return (
      <div className="flex flex-col gap-2">
        <Notice kind="error">La fiche n'a pas pu être générée : {job.error ?? "erreur inconnue"}.</Notice>
        <Button variant="secondary" onClick={onRetry} disabled={busy}>
          Réessayer
        </Button>
      </div>
    );
  }
  if (job.status === "pending") {
    return (
      <Notice>
        ⏳ Fiche en attente de génération{job.ahead > 0 ? ` (${job.ahead} avant elle)` : ""}. Tu peux quitter cette page : elle sera prête à ton retour.
      </Notice>
    );
  }
  return <Notice>🌱 Claude prépare la fiche… compte 15 à 30 secondes. Tu peux quitter cette page.</Notice>;
}
