import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { RoomInput, type Room } from "@plantes/shared";
import { db } from "../db/instance.js";
import { plants, rooms } from "../db/schema.js";
import { newId } from "../lib/tokens.js";
import { parseBody } from "../lib/validate.js";
import { requireMember, type AuthEnv } from "../session.js";

const MAX_ROOMS = 50;

export const roomsRoutes = new Hono<AuthEnv>();
roomsRoutes.use("*", requireMember);

const owned = (householdId: string, id: string) =>
  db.select().from(rooms).where(and(eq(rooms.id, id), eq(rooms.householdId, householdId))).get();

roomsRoutes.get("/", (c) => {
  const householdId = c.get("householdId");
  const counts = new Map(
    db
      .select({ roomId: plants.roomId, n: count() })
      .from(plants)
      .where(eq(plants.householdId, householdId))
      .groupBy(plants.roomId)
      .all()
      .map((r) => [r.roomId, r.n]),
  );
  const list: Room[] = db
    .select()
    .from(rooms)
    .where(eq(rooms.householdId, householdId))
    .orderBy(rooms.name)
    .all()
    .map((r) => ({ id: r.id, name: r.name, plantCount: counts.get(r.id) ?? 0 }));
  return c.json(list);
});

roomsRoutes.post("/", async (c) => {
  const householdId = c.get("householdId");
  const body = await parseBody(c, RoomInput);
  if ("res" in body) return body.res;
  const n = db.select({ n: count() }).from(rooms).where(eq(rooms.householdId, householdId)).get()?.n ?? 0;
  if (n >= MAX_ROOMS) return c.json({ error: `Maximum ${MAX_ROOMS} pièces` }, 400);
  const room = { id: newId(), householdId, name: body.data.name };
  db.insert(rooms).values(room).run();
  return c.json({ id: room.id, name: room.name, plantCount: 0 } satisfies Room, 201);
});

roomsRoutes.patch("/:id", async (c) => {
  const room = owned(c.get("householdId"), c.req.param("id"));
  if (!room) return c.json({ error: "Pièce introuvable" }, 404);
  const body = await parseBody(c, RoomInput);
  if ("res" in body) return body.res;
  db.update(rooms).set({ name: body.data.name }).where(eq(rooms.id, room.id)).run();
  return c.json({ ok: true });
});

/** Les plantes de la pièce ne sont pas supprimées : elles repassent « sans pièce ». */
roomsRoutes.delete("/:id", (c) => {
  const room = owned(c.get("householdId"), c.req.param("id"));
  if (!room) return c.json({ error: "Pièce introuvable" }, 404);
  db.delete(rooms).where(eq(rooms.id, room.id)).run();
  return c.json({ ok: true });
});
