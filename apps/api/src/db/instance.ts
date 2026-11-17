import { openDb } from "./index.js";

export const DATA_DIR = process.env.DATA_DIR ?? "./data";

/** Instance unique de la base, partagée par le serveur et la config d'authentification. */
export const db = openDb(DATA_DIR);
