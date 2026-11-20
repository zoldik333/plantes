// Limite de débit contre le vrai serveur : plafonds abaissés par l'environnement (RATE_LIMIT_*).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { TestServer } from "../helpers/server.js";

let s: TestServer;
const WINDOW = 1500;
before(async () => {
  s = await TestServer.start({ env: { RATE_LIMIT_GLOBAL_MAX: "5", RATE_LIMIT_GLOBAL_WINDOW_MS: String(WINDOW), RATE_LIMIT_AUTH_MAX: "2", RATE_LIMIT_AUTH_WINDOW_MS: "60000" } });
});
after(() => s.cleanup());

const call = (path: string, ip: string, method = "GET") =>
  fetch(s.url + path, { method, headers: { "x-forwarded-for": ip, ...(method !== "GET" && { origin: s.url, "content-type": "application/json" }) }, body: method === "GET" ? undefined : "{}" });
const statuses = async (n: number, path: string, ip: string, method?: string) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await call(path, ip, method)).status);
  return out;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("limite de débit globale", () => {
  it("429 + Retry-After au-delà du plafond, JSON en français, puis rétablissement", async () => {
    const ip = "203.0.113.10";
    const codes = await statuses(5, "/api/me", ip);
    assert.ok(codes.every((c) => c === 401), `attendu 401 (non connecté) : ${codes}`);
    const res = await call("/api/me", ip);
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get("retry-after")) >= 1);
    assert.equal(res.headers.get("ratelimit-limit"), "5");
    assert.equal(res.headers.get("ratelimit-remaining"), "0");
    assert.match((await res.json()).error, /Trop de requêtes/);
    await sleep(WINDOW + 200);
    assert.equal((await call("/api/me", ip)).status, 401);
  });

  it("deux IP distinctes sont indépendantes", async () => {
    await sleep(WINDOW + 200);
    assert.equal((await statuses(6, "/api/me", "203.0.113.20")).at(-1), 429);
    assert.equal((await call("/api/me", "203.0.113.21")).status, 401);
  });

  it("IPv4-mappée = même seau que l'IPv4 ; deux adresses du même /64 partagent le seau, un autre /64 non", async () => {
    await sleep(WINDOW + 200);
    await statuses(3, "/api/me", "203.0.113.30");
    assert.equal((await statuses(3, "/api/me", "::ffff:203.0.113.30")).at(-1), 429);
    await statuses(4, "/api/me", "2001:db8:aa:bb::1");
    assert.equal((await call("/api/me", "2001:db8:aa:bb:1234:5678:9abc:def0")).status, 401);
    assert.equal((await call("/api/me", "2001:db8:aa:bb:ffff::2")).status, 429);
    assert.equal((await call("/api/me", "2001:db8:aa:cc::1")).status, 401);
  });

  it("/health, statiques et images ne déclenchent pas de 429", async () => {
    await sleep(WINDOW + 200);
    const ip = "203.0.113.40";
    for (const path of ["/health", "/", "/index.html", "/api/photos/inconnue"]) {
      const codes = await statuses(60, path, ip);
      assert.ok(!codes.includes(429), `${path} : ${[...new Set(codes)]}`);
    }
    // Les images ont leur propre seau : les 60 requêtes ci-dessus n'ont pas épuisé le global.
    assert.equal((await call("/api/me", ip)).status, 401);
  });
});

describe("seaux stricts", () => {
  it("écritures /api/auth/* : plafond propre, lectures non concernées", async () => {
    await sleep(WINDOW + 200);
    const ip = "203.0.113.50";
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      codes.push((await call("/api/auth/sign-in/email", ip, "POST")).status);
      await sleep(WINDOW / 4 + 50); // reste sous le plafond global (5 par fenêtre)
    }
    assert.ok(!codes.slice(0, 2).includes(429), `${codes}`);
    assert.deepEqual(codes.slice(2), [429, 429]);
    assert.notEqual((await call("/api/auth/get-session", ip)).status, 429);
  });
});
