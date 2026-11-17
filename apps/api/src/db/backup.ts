import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import type { Db } from "./index.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP = 14;

/** Copie cohérente de la base (API de sauvegarde SQLite, sûre pendant les écritures). */
export async function backupNow(db: Db, dataDir: string): Promise<string> {
  const dir = `${dataDir}/backups`;
  mkdirSync(dir, { recursive: true });
  const dest = `${dir}/plantes-${new Date().toISOString().slice(0, 10)}.db`;
  await db.sqlite.backup(dest);
  const old = readdirSync(dir)
    .filter((f) => /^plantes-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .slice(0, -KEEP);
  for (const f of old) unlinkSync(`${dir}/${f}`);
  return dest;
}

/** Une sauvegarde au démarrage si celle du jour manque, puis une toutes les 24 h. */
export function scheduleBackups(db: Db, dataDir: string): void {
  const run = () =>
    backupNow(db, dataDir)
      .then((f) => console.log(`[db] sauvegarde ${f}`))
      .catch((err) => console.error("[db] sauvegarde échouée", err));
  const today = `${dataDir}/backups/plantes-${new Date().toISOString().slice(0, 10)}.db`;
  if (!existsSync(today)) void run();
  setInterval(run, DAY_MS).unref();
}
