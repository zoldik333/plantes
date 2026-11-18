/** Fuseau fixe du foyer : les jours, les saisons et les heures de rappel se comptent à Paris. */
export const TZ = "Europe/Paris";

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Date (AAAA-MM-JJ) et heure à Paris pour un instant donné (gère l'heure d'été). */
export function parisParts(d: Date): { date: string; hour: number; minute: number } {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

export const parisDate = (d: Date): string => parisParts(d).date;

const utcMs = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

/** Ajoute des jours à une date AAAA-MM-JJ (calendrier pur, sans heure d'été). */
export function addDays(date: string, n: number): string {
  return new Date(utcMs(date) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Nombre de jours entre deux dates AAAA-MM-JJ (positif si `to` est après `from`). */
export function diffDays(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / 86_400_000);
}

/** Avril à septembre : intervalle d'été ; octobre à mars : intervalle d'hiver (hémisphère nord). */
export function seasonOf(date: string): "summer" | "winter" {
  const month = Number(date.slice(5, 7));
  return month >= 4 && month <= 9 ? "summer" : "winter";
}
