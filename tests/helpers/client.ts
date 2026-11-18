import { createHash, randomBytes } from "node:crypto";
import { KEY, type TestServer } from "./server.js";

export interface Res {
  status: number;
  headers: Headers;
  text: string;
  json: any;
  /** Corps brut (images). */
  body: Buffer;
}

let nextIp = 1;

/**
 * Client HTTP avec jeu de cookies : se comporte comme un navigateur (envoie `Origin` sur les écritures,
 * comme le font tous les navigateurs). Chaque client a sa propre adresse simulée (`X-Forwarded-For`,
 * écrasé par Caddy en production) : les limiteurs de débit par adresse ne se gênent pas entre clients.
 */
export class Client {
  private cookies = new Map<string, string>();
  readonly ip = `198.51.100.${nextIp++ % 250}`;
  constructor(readonly base: string) {}

  async request(method: string, path: string, opts: { json?: unknown; form?: FormData; headers?: Record<string, string> } = {}): Promise<Res> {
    const headers: Record<string, string> = { "x-forwarded-for": this.ip, ...(method !== "GET" && { origin: this.base }), ...opts.headers };
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form) body = opts.form;
    const res = await fetch(this.base + path, { method, headers, body, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (value === "" || /max-age=0/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const raw = Buffer.from(await res.arrayBuffer());
    const text = raw.toString("utf8");
    let json: any = undefined;
    try {
      json = JSON.parse(text);
    } catch {
      /* corps non JSON */
    }
    return { status: res.status, headers: res.headers, text, json, body: raw };
  }

  get = (path: string, headers?: Record<string, string>) => this.request("GET", path, { headers });
  post = (path: string, json?: unknown, headers?: Record<string, string>) => this.request("POST", path, { json, headers });
  patch = (path: string, json?: unknown) => this.request("PATCH", path, { json });
  delete = (path: string) => this.request("DELETE", path);
  upload = (path: string, file: Buffer | Uint8Array, filename = "photo.jpg", type = "image/jpeg") => {
    const form = new FormData();
    form.append("photo", new Blob([file as BlobPart], { type }), filename);
    return this.request("POST", path, { form });
  };
}

export const anonymous = (s: TestServer) => new Client(s.url);

/** Crée le premier compte (et le foyer) avec la clé d'installation. */
export async function bootstrapAlice(s: TestServer, email = "alice@plantes.test"): Promise<Client> {
  const c = new Client(s.url);
  const r = await c.post("/api/signup", { name: "Alice", email, password: "motdepasse-1234", bootstrapKey: KEY });
  if (r.status !== 200) throw new Error(`bootstrap impossible : ${r.status} ${r.text}`);
  return c;
}

/** Invite puis inscrit une personne dans le foyer de `inviter`, par le vrai parcours. */
export async function addMember(s: TestServer, inviter: Client, name: string, email: string): Promise<Client> {
  const inv = await inviter.post("/api/household/invitations");
  const token = inv.json.url.split("/").pop();
  const c = new Client(s.url);
  const r = await c.post("/api/signup", { name, email, password: "motdepasse-1234", inviteToken: token });
  if (r.status !== 200) throw new Error(`inscription impossible : ${r.status} ${r.text}`);
  return c;
}

/**
 * Crée un SECOND foyer et un membre dedans (impossible par l'API publique : un seul foyer par installation).
 * Sert aux tests d'isolation entre foyers. Insère le foyer et l'invitation en base, puis passe par le vrai signup.
 */
export async function bobInOtherHousehold(s: TestServer, aliceId: string): Promise<Client> {
  const token = randomBytes(24).toString("base64url");
  s.db((db) => {
    db.prepare("insert into households(id,name,created_at) values(?,?,?)").run("b".repeat(32), "Foyer B", Date.now());
    db.prepare("insert into invitations(id,token_hash,household_id,created_by,expires_at) values(?,?,?,?,?)").run(
      "i".repeat(8),
      createHash("sha256").update(token).digest("hex"),
      "b".repeat(32),
      aliceId,
      Date.now() + 3_600_000,
    );
  });
  const c = new Client(s.url);
  const r = await c.post("/api/signup", { name: "Bob", email: "bob@plantes.test", password: "motdepasse-1234", inviteToken: token });
  if (r.status !== 200) throw new Error(`inscription de Bob impossible : ${r.status} ${r.text}`);
  return c;
}

export const meId = async (c: Client): Promise<string> => (await c.get("/api/me")).json.user.id;
