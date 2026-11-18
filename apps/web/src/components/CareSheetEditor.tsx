import { useState } from "react";
import type { CareSheet } from "@plantes/shared";
import { Icon, type IconName } from "./Icon";
import { Button, Card, Field, Notice, inputClass, labelClass } from "./ui";
import { LIGHT_LABELS } from "./CareSheetView";

function Area({ label, value, onChange, rows = 2 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className={labelClass}>
      {label}
      <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} className={`${inputClass} py-3`} />
    </label>
  );
}

function Subtitle({ icon, children }: { icon?: IconName; children: string }) {
  return (
    <h3 className="flex items-center gap-2 pt-2 text-label text-ink">
      {icon && <Icon name={icon} />}
      {children}
    </h3>
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
    <Card title="Modifier la fiche">
      <Field label="Nom courant" value={s.commonName} onChange={(e) => set({ commonName: e.target.value })} />
      <Field label="Nom scientifique" value={s.scientificName} onChange={(e) => set({ scientificName: e.target.value })} />
      <label className={labelClass}>
        Difficulté
        <select value={s.difficulty} onChange={(e) => set({ difficulty: e.target.value as CareSheet["difficulty"] })} className={inputClass}>
          <option value="facile">Facile</option>
          <option value="moyenne">Moyenne</option>
          <option value="difficile">Difficile</option>
        </select>
      </label>

      <Subtitle icon="drop">Arrosage</Subtitle>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Été (jours)" type="number" inputMode="numeric" min={1} max={60} value={s.watering.intervalDaysSummer} onChange={(e) => setWater({ intervalDaysSummer: Number(e.target.value) })} />
        <Field label="Hiver (jours)" type="number" inputMode="numeric" min={1} max={90} value={s.watering.intervalDaysWinter} onChange={(e) => setWater({ intervalDaysWinter: Number(e.target.value) })} />
      </div>
      <Area label="Comment savoir quand arroser" value={s.watering.method} onChange={(v) => setWater({ method: v })} />
      <Area label="Signes d'un mauvais arrosage" value={s.watering.signs} onChange={(v) => setWater({ signs: v })} />

      <Subtitle icon="sun">Lumière</Subtitle>
      <select
        aria-label="Besoin en lumière"
        value={s.light.need}
        onChange={(e) => set({ light: { ...s.light, need: e.target.value as CareSheet["light"]["need"] } })}
        className={inputClass}
      >
        {Object.entries(LIGHT_LABELS).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
      <Area label="Où la placer" value={s.light.details} onChange={(v) => set({ light: { ...s.light, details: v } })} />

      <Subtitle>Le reste</Subtitle>
      <Area label="Humidité" value={s.extras.humidity} onChange={(v) => setExtra("humidity", v)} />
      <Area label="Température" value={s.extras.temperature} onChange={(v) => setExtra("temperature", v)} />
      <Area label="Engrais" value={s.extras.fertilizer} onChange={(v) => setExtra("fertilizer", v)} />
      <Area label="Rempotage" value={s.extras.repotting} onChange={(v) => setExtra("repotting", v)} />
      <Area label="Terre" value={s.extras.substrate} onChange={(v) => setExtra("substrate", v)} />
      <Area label="À retenir (un conseil par ligne, 3 maximum)" rows={4} value={s.tips.join("\n")} onChange={(v) => set({ tips: v.split("\n") })} />

      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex gap-2">
        <Button variant="dark" icon="check" onClick={save} disabled={busy} className="flex-1">
          Enregistrer
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy} className="flex-1">
          Annuler
        </Button>
      </div>
    </Card>
  );
}
