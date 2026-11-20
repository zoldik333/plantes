import { and, desc, eq } from "drizzle-orm";
import { CareSheet } from "@plantes/shared";
import type { ChatContext, Photo } from "../ai/provider.js";
import { db } from "../db/instance.js";
import { careEvents, chatMessages, plantPhotos, rooms, user } from "../db/schema.js";
import type { plants } from "../db/schema.js";
import { readPhoto } from "./photos.js";
import { parisDate, seasonOf } from "./time.js";
import { waterStatuses } from "./watering.js";

/** Bornes du contexte : assez pour comprendre l'historique de la plante, assez peu pour rester rapide et peu coûteux. */
export const MAX_CONTEXT_EVENTS = 50;
export const MAX_CONTEXT_MESSAGES = 20;

/**
 * Contexte donné à l'IA pour une question, construit ici et jamais fourni par le client : fiche, état d'arrosage,
 * journal récent, date du jour, conversation précédente et dernière photo. Tout est filtré par foyer.
 */
export async function buildChatContext(plant: typeof plants.$inferSelect, now = new Date()): Promise<ChatContext> {
  const householdId = plant.householdId;
  const today = parisDate(now);

  const room = plant.roomId
    ? db.select({ name: rooms.name }).from(rooms).where(and(eq(rooms.id, plant.roomId), eq(rooms.householdId, householdId))).get()
    : undefined;

  const sheet = CareSheet.safeParse(plant.careSheet);

  const events = db
    .select({ type: careEvents.type, note: careEvents.note, createdAt: careEvents.createdAt, userName: user.name })
    .from(careEvents)
    .leftJoin(user, eq(user.id, careEvents.userId))
    .where(and(eq(careEvents.plantId, plant.id), eq(careEvents.householdId, householdId)))
    .orderBy(desc(careEvents.createdAt))
    .limit(MAX_CONTEXT_EVENTS)
    .all()
    .reverse()
    .map((e) => ({ type: e.type, note: e.note, userName: e.userName, date: parisDate(e.createdAt) }));

  const history = db
    .select({ role: chatMessages.role, content: chatMessages.content, userName: user.name })
    .from(chatMessages)
    .leftJoin(user, eq(user.id, chatMessages.userId))
    .where(and(eq(chatMessages.plantId, plant.id), eq(chatMessages.householdId, householdId)))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(MAX_CONTEXT_MESSAGES)
    .all()
    .reverse();

  let photo: Photo | undefined;
  const latest = db
    .select({ id: plantPhotos.id })
    .from(plantPhotos)
    .where(and(eq(plantPhotos.plantId, plant.id), eq(plantPhotos.householdId, householdId)))
    .orderBy(desc(plantPhotos.createdAt))
    .get();
  if (latest) {
    try {
      photo = { data: await readPhoto(householdId, latest.id, false), mediaType: "image/jpeg" };
    } catch {
      /* fichier manquant : on répond sans photo */
    }
  }

  return {
    plantName: plant.name,
    roomName: room?.name ?? null,
    careSheet: sheet.success ? sheet.data : null,
    water: waterStatuses(householdId, now).get(plant.id) ?? null,
    today,
    season: seasonOf(today),
    events,
    history,
    photo,
  };
}
