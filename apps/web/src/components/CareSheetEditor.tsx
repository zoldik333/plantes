import { useState } from "react";
import type { CareSheet } from "@plantes/shared";
import { Button, Card, Field, Notice } from "./ui";
import { LIGHT_LABELS } from "./CareSheetView";

const field = "min-h-11 rounded-xl border border-stone-300 bg-white px-3 text-base text-stone-900 focus:border-leaf-600 focus:outline-none";

function Area({ label, value, onChange, rows = 2 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
      {label}
      <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} className={`${field} py-2`} />
    </label>
  );
}

/** Édition de la fiche : les champs générés par l'IA sont tous corrigeables. */
export function CareSheetEditor({
  sheet,
  busy,
  onSave,
  onCancel,
}: {
  sheet: CareSheet;
  busy: boolean;
  onSave: (s: CareSheet) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState<CareSheet>(sheet);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<CareSheet>) => setS((cur) => ({ ...cur, ...patch }));
  const setExtra = (k: keyof CareSheet["extras"], v: string) => setS((cur) => ({ ...cur, extras: { ...cur.extras, [k]: v } }));
  const setWater = (patch: Partial<CareSheet["watering"]>) => setS((cur) => ({ ...cur, watering: { ...cur.watering, ...patch } }));

  const save = () => {
    const { intervalDaysSummer: ete, intervalDaysWinter: hiver } = s.watering;
    if (!Number.isInteger(ete) || ete < 1 || ete > 60) return setError("L'intervalle d'arrosage l'été doit être entre 1 et 60 jours.");
    if (!Number.isInteger(hiver) || hiver < 1 || hiver > 90) return setError("L'intervalle d'arrosage l'hiver doit être entre 1 et 90 jours.");
    if (!s.commonName.trim() || !s.scientificName.trim()) return setError("Les noms ne peuvent pas être vides.");
    setError(null);
    onSave({ ...s, tips: s.tips.map((t) => t.trim()).filter(Boolean).slice(0, 3) });
  };

  return (
    <Card title="✏️ Modifier la fiche">
      <Field label="Nom courant" value={s.commonName} onChange={(e) => set({ commonName: e.target.value })} />
      <Field label="Nom scientifique" value={s.scientificName} onChange={(e) => set({ scientificName: e.target.value })} />
      <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
        Difficulté
        <select value={s.difficulty} onChange={(e) => set({ difficulty: e.target.value as CareSheet["difficulty"] })} className={field}>
          <option value="facile">Facile</option>
          <option value="moyenne">Moyenne</option>
          <option value="difficile">Difficile</option>
        </select>
      </label>

      <h3 className="pt-2 font-semibold text-leaf-800">💧 Arrosage</h3>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Été (jours)" type="number" inputMode="numeric" min={1} max={60} value={s.watering.intervalDaysSummer} onChange={(e) => setWater({ intervalDaysSummer: Number(e.target.value) })} />
        <Field label="Hiver (jours)" type="number" inputMode="numeric" min={1} max={90} value={s.watering.intervalDaysWinter} onChange={(e) => setWater({ intervalDaysWinter: Number(e.target.value) })} />
      </div>
      <Area label="Comment savoir quand arroser" value={s.watering.method} onChange={(v) => setWater({ method: v })} />
      <Area label="Signes d'un mauvais arrosage" value={s.watering.signs} onChange={(v) => setWater({ signs: v })} />

      <h3 className="pt-2 font-semibold text-leaf-800">☀️ Lumière</h3>
      <select value={s.light.need} onChange={(e) => set({ light: { ...s.light, need: e.target.value as CareSheet["light"]["need"] } })} className={field}>
        {Object.entries(LIGHT_LABELS).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
      <Area label="Où la placer" value={s.light.details} onChange={(v) => set({ light: { ...s.light, details: v } })} />

      <h3 className="pt-2 font-semibold text-leaf-800">Le reste</h3>
      <Area label="Humidité" value={s.extras.humidity} onChange={(v) => setExtra("humidity", v)} />
      <Area label="Température" value={s.extras.temperature} onChange={(v) => setExtra("temperature", v)} />
      <Area label="Engrais" value={s.extras.fertilizer} onChange={(v) => setExtra("fertilizer", v)} />
      <Area label="Rempotage" value={s.extras.repotting} onChange={(v) => setExtra("repotting", v)} />
      <Area label="Terre" value={s.extras.substrate} onChange={(v) => setExtra("substrate", v)} />
      <Area label="À retenir (un conseil par ligne, 3 maximum)" rows={4} value={s.tips.join("\n")} onChange={(v) => set({ tips: v.split("\n") })} />

      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy} className="flex-1">
          Enregistrer
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy} className="flex-1">
          Annuler
        </Button>
      </div>
    </Card>
  );
}
