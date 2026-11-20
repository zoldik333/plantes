import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import { clearOfflineData } from "./offline";
import { onRefresh } from "./refresh";

export interface Me {
  user: { id: string; name: string; email: string };
  household: { id: string; name: string; ownerId: string | null; members: { id: string; name: string; email: string }[] };
}

interface MeState {
  /** undefined : chargement ; null : non connecté. */
  me: Me | null | undefined;
  refresh: () => Promise<void>;
}

/** Le foyer peut changer pendant que l'app reste ouverte (quelqu'un rejoint) : on le relit à cet intervalle. */
export const ME_POLL_MS = 30_000;

const MeContext = createContext<MeState | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>("/api/me"));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        void clearOfflineData(); // plus de session : rien de privé ne reste sur l'appareil
        setMe(null);
      } else throw err;
    }
  }, []);

  useEffect(() => {
    // Hors ligne sans rien en cache (statut 0) : ni écran de connexion ni erreur, on réessaie jusqu'au retour du réseau.
    let timer: ReturnType<typeof setTimeout>;
    const start = () =>
      refresh().catch((err) => {
        if (err instanceof ApiError && err.status === 0) timer = setTimeout(start, 4000);
        else setMe(null);
      });
    void start();
    return () => clearTimeout(timer);
  }, [refresh]);

  // Le foyer (qui en fait partie), la session : relus au retour au premier plan, régulièrement, et sur « tirer pour actualiser ».
  const loggedIn = !!me;
  useEffect(() => {
    if (!loggedIn) return;
    const quiet = () => void refresh().catch(() => {});
    const tick = () => {
      if (document.visibilityState === "visible") quiet();
    };
    const id = setInterval(tick, ME_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    const unsubscribe = onRefresh(refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      unsubscribe();
    };
  }, [loggedIn, refresh]);

  return <MeContext.Provider value={{ me, refresh }}>{children}</MeContext.Provider>;
}

export function useMe(): MeState {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe hors de MeProvider");
  return ctx;
}
