import sharp from "sharp";

/** Fiche d'entretien valide (7 jours l'été, 12 l'hiver). */
export const FICHE = {
  commonName: "Calathea",
  scientificName: "Calathea sanderiana",
  nameMatchesPhoto: true,
  difficulty: "moyenne",
  light: { need: "mi-ombre", details: "Près d'une fenêtre." },
  watering: { intervalDaysSummer: 7, intervalDaysWinter: 12, method: "Enfonce un doigt.", signs: "Feuilles molles." },
  tips: ["Conseil."],
  extras: { humidity: "h", temperature: "t", fertilizer: "f", repotting: "r", substrate: "s" },
};

/** JPEG de test ; `orientation` écrit une orientation EXIF (6 = à tourner de 90°). */
export async function jpeg(opts: { width?: number; height?: number; orientation?: number } = {}): Promise<Buffer> {
  let img = sharp({ create: { width: opts.width ?? 800, height: opts.height ?? 600, channels: 3, background: { r: 40, g: 120, b: 60 } } });
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
  return img.jpeg().toBuffer();
}

export const bytes = (n: number): Buffer => Buffer.alloc(n, 7);

/** Attend qu'une condition devienne vraie (sondage), sinon échoue avec `what`. */
export async function until<T>(fn: () => Promise<T | undefined | false> | T | undefined | false, what: string, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Délai dépassé : ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}
