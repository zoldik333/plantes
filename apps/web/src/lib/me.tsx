import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";

export interface Me {
  user: { id: string; name: string; email: string };
  household: { id: string; name: string; members: { id: string; name: string; email: string }[] };
}

interface MeState {
  /** undefined : chargement ; null : non connecté. */
  me: Me | null | undefined;
  refresh: () => Promise<void>;
}

const MeContext = createContext<MeState | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>("/api/me"));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) setMe(null);
      else throw err;
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => setMe(null));
  }, [refresh]);

  return <MeContext.Provider value={{ me, refresh }}>{children}</MeContext.Provider>;
}

export function useMe(): MeState {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe hors de MeProvider");
  return ctx;
}
