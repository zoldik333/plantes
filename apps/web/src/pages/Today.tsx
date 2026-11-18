import { useEffect, useState } from "react";
import { Link } from "wouter";
import type { PlantSummary, Room, TodayResponse } from "@plantes/shared";
import { AiStatusBanner } from "../components/AiStatusBanner";
import { Button, Notice, Page, useAction } from "../components/ui";
import { api } from "../lib/api";
import { longDate, relativeDays } from "../lib/dates";
import { useFetch, useFocusReload } from "../lib/fetch";
import { photoUrl } from "../lib/photos";

type Undo = { plantId: string; eventId: string; label: string };

function Thumb({ p }: { p: PlantSummary }) {
  return p.coverPhotoId ? (
    <img src={photoUrl(p.coverPhotoId, true)} alt="" className="size-16 shrink-0 rounded-xl object-cover" />
  ) : (
    <div className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-leaf-50 text-3xl">🪴</div>
  );
}

export default function Today() {
  const today = useFetch<TodayResponse>("/api/today");
  const rooms = useFetch<Room[]>("/api/rooms");
  const plants = useFetch<PlantSummary[]>("/api/plants");
  const { busy, error, run } = useAction();
  const [undo, setUndo] = useState<Undo | null>(null);
  useFocusReload(today.reload);

  // Le bandeau « Annuler » disparaît seul au bout de 10 s.
  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), 10_000);
    return () => clearTimeout(id);
  }, [undo]);

  const roomName = (id: string | null) => rooms.data?.find((r) => r.id === id)?.name;

  const act = (p: PlantSummary, type: "watered" | "still_wet") =>
    void run(async () => {
      const ev = await api<{ id: string }>(`/api/plants/${p.id}/events`, { method: "POST", json: { type } });
      setUndo({ plantId: p.id, eventId: ev.id, label: `${p.name} : ${type === "watered" ? "arrosée" : "rappel repoussé"}` });
      await today.reload();
    });

  const cancel = () =>
    undo &&
    void run(async () => {
      await api(`/api/plants/${undo.plantId}/events/${undo.eventId}`, { method: "DELETE" });
      setUndo(null);
      await today.reload();
    });

  const data = today.data;
  const noPlants = plants.data?.length === 0;
  const askNotifications = "Notification" in window && Notification.permission === "default";

  return (
    <Page>
      <header className="pt-2">
        <h1 className="text-2xl font-bold text-leaf-800">Aujourd'hui</h1>
        {data && <p className="text-stone-600 first-letter:uppercase">{longDate(data.date)}</p>}
      </header>

      <AiStatusBanner />
      {askNotifications && (
        <Notice>
          🔔 Active les notifications pour être prévenu quand une plante a soif. <Link href="/settings" className="font-medium underline">Réglages</Link>
        </Notice>
      )}
      {today.error && <Notice kind="error">{today.error}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {!data && !today.error && <Notice>Chargement…</Notice>}

      {undo && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-leaf-700 px-3 py-2 text-sm text-white">
          <span>{undo.label}</span>
          <button className="rounded-lg px-2 py-1 font-semibold underline" disabled={busy} onClick={cancel}>
            Annuler
          </button>
        </div>
      )}

      {noPlants && (
        <Notice>
          Tu n'as pas encore de plante. <Link href="/plants/new" className="font-medium underline">Ajoute la première</Link> : une fiche avec le rythme d'arrosage sera générée.
        </Notice>
      )}

      {data && data.due.length === 0 && !noPlants && (
        <div className="rounded-2xl bg-leaf-50 p-4 text-center ring-1 ring-leaf-100">
          <p className="text-3xl">🎉</p>
          <p className="mt-1 font-semibold text-leaf-800">Rien à arroser aujourd'hui</p>
        </div>
      )}

      {data && data.due.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-leaf-800">
            À arroser · {data.due.length}
          </h2>
          <ul className="flex flex-col gap-3">
            {data.due.map((p) => (
              <li key={p.id} className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5">
                <Link href={`/plants/${p.id}`} className="flex items-center gap-3">
                  <Thumb p={p} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-stone-900">{p.name}</span>
                    <span className="block truncate text-sm text-stone-500">{roomName(p.roomId) ?? "Sans pièce"}</span>
                    <span className={`block text-sm ${p.water!.daysUntil < 0 ? "font-medium text-red-700" : "text-leaf-700"}`}>
                      {relativeDays(p.water!.daysUntil)}
                    </span>
                  </span>
                </Link>
                <div className="mt-3 flex gap-2">
                  <Button className="flex-1" disabled={busy} onClick={() => act(p, "watered")}>
                    💧 Arrosée
                  </Button>
                  <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => act(p, "still_wet")}>
                    Encore humide
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && data.upcoming.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-leaf-800">Dans les 7 prochains jours</h2>
          <ul className="flex flex-col divide-y divide-stone-100 rounded-2xl bg-white px-3 shadow-sm ring-1 ring-black/5">
            {data.upcoming.map((p) => (
              <li key={p.id}>
                <Link href={`/plants/${p.id}`} className="flex min-h-12 items-center justify-between gap-2 py-2">
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="shrink-0 text-sm text-stone-500">{relativeDays(p.water!.daysUntil)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && data.withoutSheet > 0 && (
        <Notice>
          {data.withoutSheet} plante{data.withoutSheet > 1 ? "s n'ont" : " n'a"} pas de fiche : aucun rappel pour {data.withoutSheet > 1 ? "elles" : "elle"}.{" "}
          <Link href="/plants" className="font-medium underline">Voir mes plantes</Link>
        </Notice>
      )}
    </Page>
  );
}
