import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { SheetJob } from "@plantes/shared";
import { ai } from "./ai/instance.js";
import { getPush, recordGenerationOutcome } from "./ai-status.js";
import { AiProviderError, type Photo } from "./ai/provider.js";
import { db } from "./db/instance.js";
import { careSheetJobs, plantPhotos, plants } from "./db/schema.js";
import { readPhoto } from "./lib/photos.js";
import { newId } from "./lib/tokens.js";

import { onIdle, release, tryAcquire } from "./ai/slot.js";

// Une seule génération à la fois (3,7 Go de RAM, un sous-processus Claude par appel), et jamais en même temps qu'une
// question de chat : le créneau d'IA (ai/slot.ts) est partagé.
/** Garde-fou par foyer : évite qu'un clic répété ou un bug ne vide l'abonnement. */
export const MAX_ACTIVE_PER_HOUSEHOLD = 5;

type Job = typeof careSheetJobs.$inferSelect;

/** État des générations d'un foyer, avec le nombre de générations qui passent avant chacune. */
export function jobsOf(householdId: string): Map<string, SheetJob> {
  const mine = db.select().from(careSheetJobs).where(eq(careSheetJobs.householdId, householdId)).all();
  const out = new Map<string, SheetJob>();
  for (const j of mine) {
    let ahead = 0;
    if (j.status === "pending") {
      ahead = db
        .select({ id: careSheetJobs.id })
        .from(careSheetJobs)
        .where(and(inArray(careSheetJobs.status, ["pending", "running"]), or(lt(careSheetJobs.createdAt, j.createdAt), eq(careSheetJobs.status, "running"))))
        .all().length;
    }
    out.set(j.plantId, { status: j.status, error: j.error, ahead });
  }
  return out;
}

export const activeCount = (householdId: string) =>
  db
    .select({ id: careSheetJobs.id })
    .from(careSheetJobs)
    .where(and(eq(careSheetJobs.householdId, householdId), inArray(careSheetJobs.status, ["pending", "running"])))
    .all().length;

onIdle(() => kick()); // un chat vient de finir : la file reprend

/** Met une génération en file (ou relance une génération en erreur). Idempotent si elle est déjà en cours. */
export function enqueue(plantId: string, householdId: string): void {
  const existing = db.select().from(careSheetJobs).where(eq(careSheetJobs.plantId, plantId)).get();
  if (existing && existing.status !== "error") return;
  if (existing) {
    db.update(careSheetJobs).set({ status: "pending", error: null, createdAt: new Date() }).where(eq(careSheetJobs.id, existing.id)).run();
  } else {
    db.insert(careSheetJobs).values({ id: newId(), plantId, householdId }).run();
  }
  kick();
}

/** Au démarrage : une génération interrompue par un redémarrage repart de zéro. */
export function startQueue(): void {
  db.update(careSheetJobs).set({ status: "pending" }).where(eq(careSheetJobs.status, "running")).run();
  kick();
}

function kick(): void {
  const next = db.select().from(careSheetJobs).where(eq(careSheetJobs.status, "pending")).orderBy(asc(careSheetJobs.createdAt)).get();
  if (!next || !tryAcquire()) return;
  db.update(careSheetJobs).set({ status: "running" }).where(eq(careSheetJobs.id, next.id)).run();
  void process(next)
    .catch((err) => console.error("[ai] file d'attente", err))
    .finally(() => release()); // libère le créneau : relance la file (onIdle) ou passe la main à un chat en attente
}

async function process(job: Job): Promise<void> {
  try {
    const plant = db.select().from(plants).where(eq(plants.id, job.plantId)).get();
    if (!plant) return; // supprimée entre-temps (la ligne de job part en cascade)

    let photo: Photo | undefined;
    const latest = db.select({ id: plantPhotos.id }).from(plantPhotos).where(eq(plantPhotos.plantId, plant.id)).orderBy(desc(plantPhotos.createdAt)).get();
    if (latest) {
      try {
        photo = { data: await readPhoto(plant.householdId, latest.id, false), mediaType: "image/jpeg" };
      } catch {
        /* fichier manquant : on génère à partir du nom seul */
      }
    }

    const result = await ai.generateCareSheet({ plantName: plant.name, photo });
    db.update(plants).set({ careSheet: result.sheet }).where(eq(plants.id, plant.id)).run();
    db.delete(careSheetJobs).where(eq(careSheetJobs.id, job.id)).run();
    console.log(`[ai] fiche « ${plant.name} » en ${result.durationMs} ms${photo ? "" : " (sans photo)"}`);
    await recordGenerationOutcome(getPush(), null).catch((e) => console.error("[ai] état", e));
  } catch (err) {
    console.error("[ai]", err);
    const message = err instanceof AiProviderError ? err.message : "Erreur inattendue pendant la génération";
    db.update(careSheetJobs).set({ status: "error", error: message }).where(eq(careSheetJobs.id, job.id)).run();
    await recordGenerationOutcome(getPush(), err).catch((e) => console.error("[ai] état", e));
  }
}
