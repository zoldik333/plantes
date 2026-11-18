import { useState } from "react";
import type { CareEvent, CareEventType, WaterStatus } from "@plantes/shared";
import { api } from "../lib/api";
import { EVENT_LABELS, relativeDays, shortDateTime } from "../lib/dates";
import { useFetch } from "../lib/fetch";
import { Button, Card, Notice, useAction } from "./ui";

const field = "min-h-11 rounded-xl border border-stone-300 bg-white px-3 text-base text-stone-900 focus:border-leaf-600 focus:outline-none";

/** Arrosage (état + boutons) et journal d'entretien d'une plante. */
export function CareCard({ plantId, water, hasSheet, onChange }: { plantId: string; water: WaterStatus | null; hasSheet: boolean; onChange: () => void | Promise<void> }) {
  const events = useFetch<CareEvent[]>(`/api/plants/${plantId}/events`);
  const { busy, error, run } = useAction();
  const [other, setOther] = useState<Exclude<CareEventType, "watered" | "still_wet">>("fertilized");
  const [note, setNote] = useState("");

  const add = (type: CareEventType, text?: string, daysAgo?: number) =>
    run(async () => {
      await api(`/api/plants/${plantId}/events`, { method: "POST", json: { type, ...(text ? { note: text } : {}), ...(daysAgo ? { daysAgo } : {}) } });
      await Promise.all([events.reload(), onChange()]);
    });

  const undo = (id: string) =>
    run(async () => {
      await api(`/api/plants/${plantId}/events/${id}`, { method: "DELETE" });
      await Promise.all([events.reload(), onChange()]);
    });

  return (
    <>
      <Card title="💧 Arrosage">
        {water ? (
          <>
            <p className={water.daysUntil <= 0 ? "font-semibold text-leaf-800" : "text-stone-700"}>
              {water.daysUntil <= 0 ? "À arroser" : "Prochain arrosage"} : {relativeDays(water.daysUntil)}
              {water.snoozed && <span className="text-stone-500"> (repoussé : encore humide)</span>}
            </p>
            <p className="text-sm text-stone-500">
              {water.lastWateredAt ? `Dernier arrosage : ${shortDateTime(water.lastWateredAt)}. ` : "Jamais arrosée depuis son ajout. "}
              Rythme actuel : tous les {water.intervalDays} jours.
            </p>
            <div className="flex gap-2">
              <Button className="flex-1" disabled={busy} onClick={() => void add("watered")}>
                💧 Arrosée
              </Button>
              <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => void add("still_wet")}>
                Encore humide
              </Button>
            </div>
            <label className="flex flex-col gap-1 text-sm text-stone-600">
              Oublié de cocher ? Arrosée plus tôt :
              <select
                value=""
                disabled={busy}
                onChange={(e) => e.target.value && void add("watered", undefined, Number(e.target.value))}
                className={field}
              >
                <option value="">Choisir…</option>
                <option value="1">Hier</option>
                <option value="2">Il y a 2 jours</option>
                <option value="3">Il y a 3 jours</option>
                <option value="7">Il y a une semaine</option>
              </select>
            </label>
          </>
        ) : (
          <Notice>{hasSheet ? "Pas d'intervalle d'arrosage dans la fiche." : "Pas de rappel pour cette plante : génère d'abord sa fiche d'entretien, elle contient le rythme d'arrosage."}</Notice>
        )}
        {error && <Notice kind="error">{error}</Notice>}
      </Card>

      <Card title="📒 Journal d'entretien">
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <select value={other} onChange={(e) => setOther(e.target.value as typeof other)} className={`${field} flex-1`}>
              <option value="fertilized">{EVENT_LABELS.fertilized}</option>
              <option value="repotted">{EVENT_LABELS.repotted}</option>
              <option value="note">{EVENT_LABELS.note}</option>
            </select>
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={other === "note" ? "Ta note (obligatoire)" : "Précision (facultatif)"}
            className={field}
          />
          <Button
            variant="secondary"
            disabled={busy || (other === "note" && !note.trim())}
            onClick={() =>
              void add(other, note.trim() || undefined).then(() => setNote(""))
            }
          >
            Ajouter au journal
          </Button>
        </div>

        {events.data?.length === 0 && <Notice>Rien pour l'instant. Chaque arrosage et chaque soin apparaîtra ici.</Notice>}
        <ul className="flex flex-col divide-y divide-stone-100">
          {events.data?.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="font-medium">{EVENT_LABELS[e.type]}</span>
                <span className="block text-sm text-stone-500">
                  {shortDateTime(e.createdAt)} · {e.userName ?? "quelqu'un"}
                </span>
                {e.note && <span className="block break-words text-sm text-stone-700">{e.note}</span>}
              </span>
              <button
                className="shrink-0 rounded-lg px-2 py-1 text-sm text-stone-500 underline disabled:opacity-50"
                disabled={busy}
                aria-label={`Annuler cette entrée du journal : ${EVENT_LABELS[e.type]}`}
                onClick={() => void undo(e.id)}
              >
                Annuler
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
