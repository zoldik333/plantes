import type { CareEventType, TimelineEntry } from "@plantes/shared";
import type { IconName } from "../components/Icon";

/** Libellé et icône de chaque type d'entrée du journal, tels qu'ils apparaissent dans la frise. */
export const EVENT_LABELS: Record<CareEventType, { label: string; icon: IconName }> = {
  watered: { label: "Arrosée", icon: "drop" },
  still_wet: { label: "Encore humide", icon: "clock" },
  fertilized: { label: "Engrais", icon: "sprout" },
  repotted: { label: "Rempotage", icon: "pot" },
  note: { label: "Note", icon: "note" },
};

const DAY_MS = 86_400_000;

/** Nombre de jours calendaires entre deux dates (heure locale), sans tenir compte de l'heure. */
export function calendarDaysBetween(a: Date, b: Date): number {
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((day(b) - day(a)) / DAY_MS);
}

const plural = (n: number, unit: string, pluralUnit = `${unit}s`) => `${n} ${n > 1 ? pluralUnit : unit}`;

/** « aujourd'hui », « hier », « il y a 3 semaines »… */
export function ago(iso: string, now = new Date()): string {
  const days = Math.max(0, calendarDaysBetween(new Date(iso), now));
  if (days === 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 14) return `il y a ${days} jours`;
  if (days < 60) return `il y a ${plural(Math.floor(days / 7), "semaine")}`;
  if (days < 730) return `il y a ${Math.floor(days / 30.44)} mois`;
  return `il y a ${plural(Math.floor(days / 365.25), "an")}`;
}

/** « 12 octobre » (avec l'année si ce n'est pas l'année en cours). */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", ...(d.getFullYear() !== now.getFullYear() && { year: "numeric" }) });
}

/** « Octobre 2026 » : titre d'un groupe de la frise. */
export function monthLabel(iso: string): string {
  const s = new Date(iso).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** « 5 semaines entre les deux » ; « le même jour » si les deux photos sont du même jour. */
export function gapLabel(fromIso: string, toIso: string): string {
  const days = Math.abs(calendarDaysBetween(new Date(fromIso), new Date(toIso)));
  if (days === 0) return "Prises le même jour";
  if (days < 14) return `${plural(days, "jour")} entre les deux`;
  if (days < 60) return `${plural(Math.floor(days / 7), "semaine")} entre les deux`;
  if (days < 730) return `${Math.floor(days / 30.44)} mois entre les deux`;
  return `${plural(Math.floor(days / 365.25), "an")} entre les deux`;
}

/** Regroupe les entrées (déjà triées, récentes d'abord) par mois, en gardant l'ordre. */
export function groupByMonth(entries: TimelineEntry[]): { month: string; entries: TimelineEntry[] }[] {
  const groups: { month: string; entries: TimelineEntry[] }[] = [];
  for (const e of entries) {
    const month = monthLabel(e.kind === "photo" ? e.createdAt : e.event.createdAt);
    const last = groups[groups.length - 1];
    if (last?.month === month) last.entries.push(e);
    else groups.push({ month, entries: [e] });
  }
  return groups;
}
