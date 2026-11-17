import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { useMe } from "./me";

/** Charge une ressource de l'API. Une session expirée (401) renvoie vers la connexion. */
export function useFetch<T>(path: string) {
  const { refresh } = useMe();
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });

  const load = useCallback(async () => {
    try {
      setState({ data: await api<T>(path), loading: false });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) void refresh();
      setState({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  }, [path, refresh]);

  useEffect(() => {
    setState((s) => ({ ...s, loading: true }));
    void load();
  }, [load]);

  return { ...state, reload: load };
}
