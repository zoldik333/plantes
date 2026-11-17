import type { Context } from "hono";
import type { ZodType } from "zod";

/** Lit et valide le corps JSON. Renvoie soit les données, soit la réponse 400 à retourner telle quelle. */
export async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<{ data: T } | { res: Response }> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (parsed.success) return { data: parsed.data };
  const message = parsed.error.issues[0]?.message ?? "Données invalides";
  return { res: c.json({ error: message, details: parsed.error.issues }, 400) };
}
