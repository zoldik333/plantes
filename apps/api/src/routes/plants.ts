import { and, count, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { EventInput, PlantInput, PlantUpdate, type CareEvent, type PlantDetail, type PlantSummary, type SheetJob, type WaterStatus } from "@plantes/shared";
import { MAX_ACTIVE_PER_HOUSEHOLD, activeCount, enqueue, jobsOf } from "../care-sheet-queue.js";
import { db } from "../db/instance.js";
import { careEvents, plantPhotos, plants, rooms, user } from "../db/schema.js";
import { deletePhotoFiles, isPhotoId, readPhoto, savePhoto } from "../lib/photos.js";
import { newId } from "../lib/tokens.js";
import { waterStatuses } from "../lib/watering.js";
import { parseBody } from "../lib/validate.js";
import { requireMember, type AuthEnv } from "../session.js";

const MAX_PLANTS = 300;
const MAX_PHOTOS_PER_PLANT = 20;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

type PlantRow = typeof plants.$inferSelect;

/** Toutes les lectures passent par le foyer de la session : un id d'un autre foyer = « introuvable ». */
const ownedPlant = (householdId: string, id: string) =>
  db.select().from(plants).where(and(eq(plants.id, id), eq(plants.householdId, householdId))).get();

const roomBelongs = (householdId: string, roomId: string) =>
  !!db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.id, roomId), eq(rooms.householdId, householdId))).get();

const photoIdsOf = (plantId: string) =>
  db.select({ id: plantPhotos.id }).from(plantPhotos).where(eq(plantPhotos.plantId, plantId)).orderBy(desc(plantPhotos.createdAt)).all().map((p) => p.id);

function summary(
  p: Pick<PlantRow, "id" | "name" | "roomId" | "createdAt">,
  coverPhotoId: string | null,
  hasSheet: boolean,
  job: SheetJob | null,
  water: WaterStatus | null,
): PlantSummary {
  return { id: p.id, name: p.name, roomId: p.roomId, coverPhotoId, hasSheet, job, water, createdAt: p.createdAt.toISOString() };
}

/** Résumé de toutes les plantes d'un foyer (liste, « Aujourd'hui », rappels). */
export function listSummaries(householdId: string, now = new Date()): PlantSummary[] {
  // Photos de la plus récente à la plus ancienne : la première rencontrée par plante est sa couverture.
  const cover = new Map<string, string>();
  for (const ph of db.select().from(plantPhotos).where(eq(plantPhotos.householdId, householdId)).orderBy(desc(plantPhotos.createdAt)).all()) {
    if (!cover.has(ph.plantId)) cover.set(ph.plantId, ph.id);
  }
  const jobs = jobsOf(householdId);
  const water = waterStatuses(householdId, now);
  // On ne lit pas les fiches elles-mêmes (volumineuses) : seulement leur présence.
  const list = db
    .select({ id: plants.id, name: plants.name, roomId: plants.roomId, createdAt: plants.createdAt, hasSheet: sql<number>`${plants.careSheet} is not null` })
    .from(plants)
    .where(eq(plants.householdId, householdId))
    .orderBy(plants.name)
    .all();
  return list.map((p) => summary(p, cover.get(p.id) ?? null, !!p.hasSheet, jobs.get(p.id) ?? null, water.get(p.id) ?? null));
}

export const plantsRoutes = new Hono<AuthEnv>();
plantsRoutes.use("*", requireMember);

plantsRoutes.get("/", (c) => c.json(listSummaries(c.get("householdId"))));

plantsRoutes.post("/", async (c) => {
  const householdId = c.get("householdId");
  const body = await parseBody(c, PlantInput);
  if ("res" in body) return body.res;
  const { name, roomId, careSheet } = body.data;
  if (roomId && !roomBelongs(householdId, roomId)) return c.json({ error: "Pièce introuvable" }, 400);
  const n = db.select({ n: count() }).from(plants).where(eq(plants.householdId, householdId)).get()?.n ?? 0;
  if (n >= MAX_PLANTS) return c.json({ error: `Maximum ${MAX_PLANTS} plantes` }, 400);
  const row = { id: newId(), householdId, roomId: roomId ?? null, name, careSheet: careSheet ?? null, createdBy: c.get("user").id };
  db.insert(plants).values(row).run();
  const created = ownedPlant(householdId, row.id)!;
  return c.json(summary(created, null, created.careSheet != null, null, waterStatuses(householdId).get(created.id) ?? null), 201);
});

plantsRoutes.get("/:id", (c) => {
  const p = ownedPlant(c.get("householdId"), c.req.param("id"));
  if (!p) return c.json({ error: "Plante introuvable" }, 404);
  const photoIds = photoIdsOf(p.id);
  const detail: PlantDetail = {
    ...summary(p, photoIds[0] ?? null, p.careSheet != null, jobsOf(p.householdId).get(p.id) ?? null, waterStatuses(p.householdId).get(p.id) ?? null),
    careSheet: p.careSheet ?? null,
    photoIds,
  };
  return c.json(detail);
});

plantsRoutes.patch("/:id", async (c) => {
  const householdId = c.get("householdId");
  const p = ownedPlant(householdId, c.req.param("id"));
  if (!p) return c.json({ error: "Plante introuvable" }, 404);
  const body = await parseBody(c, PlantUpdate);
  if ("res" in body) return body.res;
  const { name, roomId, careSheet } = body.data;
  if (roomId && !roomBelongs(householdId, roomId)) return c.json({ error: "Pièce introuvable" }, 400);
  db.update(plants)
    .set({
      ...(name !== undefined && { name }),
      ...(roomId !== undefined && { roomId }),
      ...(careSheet !== undefined && { careSheet }),
    })
    .where(eq(plants.id, p.id))
    .run();
  return c.json({ ok: true });
});

plantsRoutes.delete("/:id", async (c) => {
  const householdId = c.get("householdId");
  const p = ownedPlant(householdId, c.req.param("id"));
  if (!p) return c.json({ error: "Plante introuvable" }, 404);
  const photoIds = photoIdsOf(p.id);
  db.delete(plants).where(eq(plants.id, p.id)).run(); // les lignes de photos partent en cascade
  await Promise.all(photoIds.map((id) => deletePhotoFiles(householdId, id)));
  return c.json({ ok: true });
});

const MAX_NOTE_EVENTS = 1000;

/** Journal d'entretien d'une plante, du plus récent au plus ancien. */
plantsRoutes.get("/:id/events", (c) => {
  const householdId = c.get("householdId");
  const p = ownedPlant(householdId, c.req.param("id"));
  if (!p) return c.json({ error: "Plante introuvable" }, 404);
  const rows = db
    .select({ id: careEvents.id, type: careEvents.type, note: careEvents.note, createdAt: careEvents.createdAt, userName: user.name })
    .from(careEvents)
    .leftJoin(user, eq(user.id, careEvents.userId))
    .where(and(eq(careEvents.plantId, p.id), eq(careEvents.householdId, householdId)))
    .orderBy(desc(careEvents.createdAt))
    .limit(100)
    .all();
  const list: CareEvent[] = rows.map((r) => ({ id: r.id, type: r.type, note: r.note, userName: r.userName, createdAt: r.createdAt.toISOString() }));
  return c.json(list);
});

plantsRoutes.post("/:id/events", async (c) => {
  const householdId = c.get("householdId");
  const p = ownedPlant(householdId, c.req.param("id"));
  if (!p) return c.json({ error: "Plante introuvable" }, 404);
  const body = await parseBody(c, EventInput);
  if ("res" in body) return body.res;
  const total = db.select({ n: count() }).from(careEvents).where(eq(careEvents.plantId, p.id)).get()?.n ?? 0;
  if (total >= MAX_NOTE_EVENTS) return c.json({ error: "Journal plein pour cette plante" }, 400);
  const event = { id: newId(), plantId: p.id, householdId, userId: c.get("user").id, type: body.data.type, note: body.data.note || null };
  db.insert(careEvents).values(event).run();
  return c.json({ id: event.id, water: waterStatuses(householdId).get(p.id) ?? null }, 201);
});

/** Annuler une action (clic par erreur) : l'état d'arrosage est recalculé à partir du journal restant. */
plantsRoutes.delete("/:id/events/:eventId", (c) => {
  const householdId = c.get("householdId");
  const plantId = c.req.param("id");
  const ev = db
    .select({ id: careEvents.id })
    .from(careEvents)
    .where(and(eq(careEvents.id, c.req.param("eventId")), eq(careEvents.plantId, plantId), eq(careEvents.householdId, householdId)))
    .get();
  if (!ev) return c.json({ error: "Action introuvable" }, 404);
  db.delete(careEvents).where(eq(careEvents.id, ev.id)).run();
  return c.json({ ok: true, water: waterStatuses(householdId).get(plantId) ?? null });
});

/** Lance (ou relance après une erreur) la génération de la fiche par l'IA ; la plante est lue avec sa dernière photo. */
plantsRoutes.post("/:id/care-sheet", (c) => {
  const householdId = c.get("householdId");
  const p = ownedPlant(householdId, c.req.param("id"));
  if (!p) return c.json({ error: "Plante introuvable" }, 404);
  const current = jobsOf(householdId).get(p.id);
  if (!current || current.status === "error") {
    if (activeCount(householdId) >= MAX_ACTIVE_PER_HOUSEHOLD) {
      return c.json({ error: `Déjà ${MAX_ACTIVE_PER_HOUSEHOLD} fiches en cours de génération : patiente un instant.` }, 429);
    }
    enqueue(p.id, householdId);
  }
  return c.json(jobsOf(householdId).get(p.id), 202);
});

plantsRoutes.post(
  "/:id/photos",
  // Coupe la requête avant de la lire en mémoire (la marge couvre l'enveloppe multipart).
  bodyLimit({ maxSize: MAX_UPLOAD_BYTES + 64 * 1024, onError: (c) => c.json({ error: "Photo trop lourde (8 Mo maximum)" }, 413) }),
  async (c) => {
  const householdId = c.get("householdId");
  const p = ownedPlant(householdId, c.req.param("id"));
  if (!p) return c.json({ error: "Plante introuvable" }, 404);
  const file = (await c.req.parseBody().catch(() => ({})) as Record<string, unknown>).photo;
  if (!(file instanceof File) || file.size === 0) return c.json({ error: "Photo manquante" }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: "Photo trop lourde (8 Mo maximum)" }, 413);
  if (photoIdsOf(p.id).length >= MAX_PHOTOS_PER_PLANT) return c.json({ error: `Maximum ${MAX_PHOTOS_PER_PLANT} photos par plante` }, 400);

  const photoId = newId();
  try {
    await savePhoto(householdId, photoId, Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    console.error("[photo]", err);
    await deletePhotoFiles(householdId, photoId);
    return c.json({ error: "Ce fichier n'est pas une image lisible" }, 415);
  }
  db.insert(plantPhotos).values({ id: photoId, plantId: p.id, householdId }).run();
  return c.json({ id: photoId }, 201);
  },
);

plantsRoutes.delete("/:id/photos/:photoId", async (c) => {
  const householdId = c.get("householdId");
  const photoId = c.req.param("photoId");
  const photo = db
    .select()
    .from(plantPhotos)
    .where(and(eq(plantPhotos.id, photoId), eq(plantPhotos.plantId, c.req.param("id")), eq(plantPhotos.householdId, householdId)))
    .get();
  if (!photo) return c.json({ error: "Photo introuvable" }, 404);
  db.delete(plantPhotos).where(eq(plantPhotos.id, photo.id)).run();
  await deletePhotoFiles(householdId, photo.id);
  return c.json({ ok: true });
});

/** Fichiers de photos, derrière la session (pas d'URL publique). */
export const photosRoutes = new Hono<AuthEnv>();
photosRoutes.use("*", requireMember);

photosRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const householdId = c.get("householdId");
  if (!isPhotoId(id)) return c.json({ error: "Photo introuvable" }, 404);
  const photo = db
    .select({ id: plantPhotos.id })
    .from(plantPhotos)
    .where(and(eq(plantPhotos.id, id), eq(plantPhotos.householdId, householdId)))
    .get();
  if (!photo) return c.json({ error: "Photo introuvable" }, 404);
  try {
    const data = await readPhoto(householdId, id, c.req.query("size") === "thumb");
    // L'identifiant ne change jamais pour un contenu donné : cache long, mais privé (pas de cache partagé).
    return c.body(new Uint8Array(data), 200, { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" });
  } catch {
    return c.json({ error: "Photo introuvable" }, 404);
  }
});
