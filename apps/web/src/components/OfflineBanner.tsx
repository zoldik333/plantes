import { useOffline, useUpdateReady } from "../lib/offline";
import { Icon } from "./Icon";

/** Bandeau flottant en haut de l'écran : hors connexion, ou nouvelle version prête. Absent (aucun rôle ARIA) le reste du temps. */
export function OfflineBanner() {
  const offline = useOffline();
  const update = useUpdateReady();
  if (!offline && !update) return null;
  return (
    <div className="pointer-events-none fixed inset-x-4 top-[calc(env(safe-area-inset-top)+8px)] z-50 mx-auto flex max-w-[26rem] flex-col gap-2">
      {offline && (
        <p role="status" className="pointer-events-auto flex items-center gap-2 rounded-full bg-surface-deep px-4 py-2 text-body-sm text-on-deep shadow-float">
          <Icon name="alert" size={18} />
          Hors connexion : données de ta dernière visite.
        </p>
      )}
      {update && (
        <p role="status" className="pointer-events-auto flex items-center justify-between gap-3 rounded-full bg-surface-deep px-4 py-2 text-body-sm text-on-deep shadow-float">
          Nouvelle version disponible.
          <button type="button" onClick={() => location.reload()} className="rounded-full bg-accent px-3 py-1 font-bold text-on-accent">
            Recharger
          </button>
        </p>
      )}
    </div>
  );
}
