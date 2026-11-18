
/** « en retard de 3 jours », « aujourd'hui », « demain », « dans 4 jours ». */
export function relativeDays(daysUntil: number): string {
  if (daysUntil < 0) return `en retard de ${-daysUntil} jour${-daysUntil > 1 ? "s" : ""}`;
  if (daysUntil === 0) return "aujourd'hui";
  if (daysUntil === 1) return "demain";
  return `dans ${daysUntil} jours`;
}

/** « mercredi 18 novembre » à partir de AAAA-MM-JJ. */
export function longDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

/** « 18 nov., 14:05 » */
export function shortDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}, ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

