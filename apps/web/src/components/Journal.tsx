import { useState } from "react";
import type { CareEvent, CareEventType, WaterStatus } from "@plantes/shared";
import { api } from "../lib/api";
import { relativeDays, shortDateTime } from "../lib/dates";
import { useFetch } from "../lib/fetch";
import { Icon, type IconName } from "./Icon";
import { Button, Card, Notice, buttonClass, inputClass, useAction } from "./ui";

/** Libellé et icône de chaque type d'entrée du journal. */
const EVENTS: Record<CareEventType, { label: string; icon: IconName }> = {
  watered: { label: "Arrosée", icon: "drop" },
  still_wet: { label: "Encore humide", icon: "clock" },
  fertilized: { label: "Engrais", icon: "sprout" },
  repotted: { label: "Rempotage", icon: "pot" },
  note: { label: "Note", icon: "note" },
};

/** Arrosage (état + boutons, la carte sombre de la fiche) et journal d'entretien d'une plante. */
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
      <Card
        tone="deep"
        title={
          <span className="flex items-center gap-2">
            <Icon name="drop" />
            Arrosage
          </span>
        }
      >
        {water ? (
          <>
            <p className="text-display text-on-deep">
              <span className="block text-label text-on-deep-muted">{water.daysUntil <= 0 ? "À arroser" : "Prochain arrosage"} :</span>{" "}
              {relativeDays(water.daysUntil)}
            </p>
            <p className="text-body-sm text-on-deep-muted">
              {water.lastWateredAt ? `Dernier arrosage : ${shortDateTime(water.lastWateredAt)}. ` : "Jamais arrosée depuis son ajout. "}
              Rythme actuel : tous les {water.intervalDays} jours.
              {water.snoozed && " (repoussé : encore humide)"}
            </p>
            <div className="flex gap-2">
              <Button variant="primary" icon="drop" className="flex-1" disabled={busy} onClick={() => void add("watered")}>
                Arrosée
              </Button>
              <Button variant="on-deep" className="flex-none" disabled={busy} onClick={() => void add("still_wet")}>
                Encore humide
              </Button>
            </div>
            <label className="flex flex-col gap-1.5 text-label text-on-deep-muted">
              Oublié de cocher ? Arrosée plus tôt :
              <select
                value=""
                disabled={busy}
                onChange={(e) => e.target.value && void add("watered", undefined, Number(e.target.value))}
                className={buttonClass("on-deep", "w-full *:bg-surface *:text-ink")}
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
          <p className="text-body-sm text-on-deep-muted">
            {hasSheet ? "Pas d'intervalle d'arrosage dans la fiche." : "Pas de rappel pour cette plante : génère d'abord sa fiche d'entretien, elle contient le rythme d'arrosage."}
          </p>
        )}
        {error && <Notice kind="error">{error}</Notice>}
      </Card>

      <Card title="Journal d'entretien">
        <div className="flex flex-col gap-2">
          <select aria-label="Type d'entrée" value={other} onChange={(e) => setOther(e.target.value as typeof other)} className={inputClass}>
            <option value="fertilized">{EVENTS.fertilized.label}</option>
            <option value="repotted">{EVENTS.repotted.label}</option>
            <option value="note">{EVENTS.note.label}</option>
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={other === "note" ? "Ta note (obligatoire)" : "Précision (facultatif)"}
            className={inputClass}
          />
          <Button
            variant="secondary"
            icon="plus"
            disabled={busy || (other === "note" && !note.trim())}
            onClick={() => void add(other, note.trim() || undefined).then(() => setNote(""))}
          >
            Ajouter au journal
          </Button>
        </div>

        {events.data?.length === 0 && <Notice>Rien pour l'instant. Chaque arrosage et chaque soin apparaîtra ici.</Notice>}
        <ul className="flex flex-col divide-y divide-line">
          {events.data?.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-3">
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-sm bg-surface-sunken ${e.type === "watered" ? "text-water" : "text-ink"}`}>
                <Icon name={EVENTS[e.type].icon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-label text-ink">{EVENTS[e.type].label}</span>
                <span className="block text-caption text-ink-muted">
                  {shortDateTime(e.createdAt)} · {e.userName ?? "quelqu'un"}
                </span>
                {e.note && <span className="block text-body-sm break-words text-ink">{e.note}</span>}
              </span>
              <button
                type="button"
                className="min-h-12 shrink-0 rounded-full px-3 text-label text-ink-muted underline underline-offset-2 active:opacity-70 disabled:opacity-50"
                disabled={busy}
                aria-label={`Annuler cette entrée du journal : ${EVENTS[e.type].label}`}
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
