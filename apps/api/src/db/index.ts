import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof openDb>;

/** Ouvre la base SQLite (créée si besoin) et applique les migrations en attente. */
export function openDb(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(`${dataDir}/plantes.db`);
  // WAL : lectures pendant une écriture ; busy_timeout : attend au lieu d'échouer sur un verrou.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  return Object.assign(db, { sqlite });
}

export { schema };
