// Test en ligne de commande : npm run test:ai -- ./photo.jpg "Calathea sanderiana"
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { createAiProvider, type ImageMediaType } from "./ai/index.js";

const [photoPath, ...nameParts] = process.argv.slice(2);
const plantName = nameParts.join(" ");

if (!photoPath || !plantName) {
  console.error('Usage : npm run test:ai -- <photo.jpg> "<nom de la plante>"');
  process.exit(1);
}

const types: Record<string, ImageMediaType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const mediaType = types[extname(photoPath).toLowerCase()];
if (!mediaType) {
  console.error("Format non pris en charge (jpg, png, webp). Les HEIC d'iPhone doivent être convertis.");
  process.exit(1);
}

const { size } = await stat(photoPath);
if (size > 3.5 * 1024 * 1024) {
  console.error(`Photo trop lourde (${(size / 1e6).toFixed(1)} Mo) : réduis-la sous 3,5 Mo.`);
  process.exit(1);
}

process.env.AI_DEBUG ??= "1";
const ai = createAiProvider();
console.log(`→ ${ai.name} : génération de la fiche pour « ${plantName} »…`);

try {
  const { sheet, durationMs } = await ai.generateCareSheet({
    plantName,
    photo: { data: await readFile(photoPath), mediaType },
  });
  console.log(JSON.stringify(sheet, null, 2));
  console.log(`✓ Fiche générée en ${(durationMs / 1000).toFixed(1)} s`);
} catch (err) {
  console.error("✗ Échec :", err);
  process.exit(1);
}
