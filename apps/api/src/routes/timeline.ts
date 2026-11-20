import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { CareEvent, PlantTimeline, TimelineEntry } from "@plantes/shared";
import { db } from "../db/instance.js";
import { careEvents, plantPhotos, plants, user } from "../db/schema.js";
import { requireMember, type AuthEnv } from "../session.js";

/** Bornes : 20 photos par plante déjà imposées à l'envoi ; les événements sont limités ici. */
export const MAX_TIMELINE_EVENTS = 200;
const MAX_TIMELINE_PHOTOS = 20;

export const timelineRoutes = new Hono<AuthEnv>();

/** Évolution d'une plante : photos et journal mêlés, du plus récent au plus ancien. N'a pas besoin de la fiche JSON. */
timelineRoutes.get("/:id/timeline", requireMember, (c) => {
  const householdId = c.get("householdId");
  const plantId = c.req.param("id");
  const plant = db.select({ id: plants.id }).from(plants).where(and(eq(plants.id, plantId), eq(plants.householdId, householdId))).get();
  if (!plant) return c.json({ error: "Plante introuvable" }, 404);

  const photos = db
    .select({ id: plantPhotos.id, createdAt: plantPhotos.createdAt })
    .from(plantPhotos)
    .where(and(eq(plantPhotos.plantId, plant.id), eq(plantPhotos.householdId, householdId)))
    .orderBy(desc(plantPhotos.createdAt))
    .limit(MAX_TIMELINE_PHOTOS)
    .all();
  const events = db
    .select({ id: careEvents.id, type: careEvents.type, note: careEvents.note, createdAt: careEvents.createdAt, userName: user.name })
    .from(careEvents)
    .leftJoin(user, eq(user.id, careEvents.userId))
    .where(and(eq(careEvents.plantId, plant.id), eq(careEvents.householdId, householdId)))
    .orderBy(desc(careEvents.createdAt))
    .limit(MAX_TIMELINE_EVENTS)
    .all();

  const entries: (TimelineEntry & { at: number })[] = [
    ...photos.map((p) => ({ kind: "photo" as const, id: p.id, createdAt: p.createdAt.toISOString(), at: p.createdAt.getTime() })),
    ...events.map((e) => {
      const event: CareEvent = { id: e.id, type: e.type, note: e.note, userName: e.userName, createdAt: e.createdAt.toISOString() };
      return { kind: "event" as const, event, at: e.createdAt.getTime() };
    }),
  ];
  entries.sort((a, b) => b.at - a.at);
  const body: PlantTimeline = { entries: entries.map(({ at: _at, ...entry }) => entry as TimelineEntry) };
  return c.json(body);
});
