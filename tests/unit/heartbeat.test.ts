// Signal « je suis vivant » : jamais d'exception, jamais de blocage.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import webpush from "web-push";

const DIR = mkdtempSync(join(tmpdir(), "plantes-heartbeat-"));
const keys = webpush.generateVAPIDKeys();
process.env.DATA_DIR = DIR;
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
const { pingHeartbeat } = await import("../../apps/api/src/reminders.js");

describe("pingHeartbeat", () => {
  let srv: Server;
  let url: string;
  let hits: string[] = [];
  let mode: "ok" | "erreur" | "muet" = "ok";
  before(async () => {
    srv = createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      if (mode === "muet") return; // ne répond jamais
      res.statusCode = mode === "ok" ? 200 : 500;
      res.end("ok");
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/ping/abc`;
  });
  after(() => {
    srv.closeAllConnections();
    srv.close();
    rmSync(DIR, { recursive: true, force: true });
  });

  it("appelle l'URL et renvoie true quand le service répond", async () => {
    hits = [];
    assert.equal(await pingHeartbeat(url), true);
    assert.deepEqual(hits, ["GET /ping/abc"]);
  });
  it("renvoie false (sans exception) quand le service répond en erreur", async () => {
    mode = "erreur";
    assert.equal(await pingHeartbeat(url), false);
  });
  it("renvoie false (sans exception) quand le service est injoignable", async () => {
    assert.equal(await pingHeartbeat("http://127.0.0.1:1/ping"), false);
  });
  it("ne bloque jamais : un service muet est abandonné au délai fixé", async () => {
    mode = "muet";
    const t0 = Date.now();
    assert.equal(await pingHeartbeat(url, 300), false);
    assert.ok(Date.now() - t0 < 2000, `abandonné en ${Date.now() - t0} ms`);
  });
});
