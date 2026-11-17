import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { DATA_DIR } from "../db/instance.js";

// Peu de RAM sur le serveur : un seul traitement à la fois, pas de cache d'images.
sharp.cache(false);
sharp.concurrency(1);

const PHOTO_DIR = join(DATA_DIR, "photos");
const ID = /^[a-f0-9]{32}$/;

export const isPhotoId = (id: string) => ID.test(id);

function paths(householdId: string, photoId: string) {
  // Les identifiants sont générés par le serveur (hex) ; on refuse tout autre format avant de construire un chemin.
  if (!ID.test(photoId) || !ID.test(householdId)) throw new Error("Identifiant de photo invalide");
  const dir = join(PHOTO_DIR, householdId);
  return { dir, full: join(dir, `${photoId}.jpg`), thumb: join(dir, `${photoId}.thumb.jpg`) };
}

/**
 * Ré-encode la photo reçue : orientation corrigée, métadonnées (EXIF, GPS) supprimées,
 * grande version 1600 px et vignette carrée 400 px. Lève une erreur si ce n'est pas une image valide.
 */
export async function savePhoto(householdId: string, photoId: string, input: Buffer): Promise<void> {
  const p = paths(householdId, photoId);
  await mkdir(p.dir, { recursive: true });
  const base = sharp(input, { limitInputPixels: 50_000_000, failOn: "error" }).rotate();
  await base.clone().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toFile(p.full);
  await base.clone().resize({ width: 400, height: 400, fit: "cover" }).jpeg({ quality: 75 }).toFile(p.thumb);
}

export async function readPhoto(householdId: string, photoId: string, thumb: boolean): Promise<Buffer> {
  const p = paths(householdId, photoId);
  return readFile(thumb ? p.thumb : p.full);
}

export async function deletePhotoFiles(householdId: string, photoId: string): Promise<void> {
  const p = paths(householdId, photoId);
  await Promise.all([p.full, p.thumb].map((f) => unlink(f).catch(() => {})));
}
