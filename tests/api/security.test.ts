import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { WEB_DIST } from "../ui/helpers.js";
import { anonymous, bootstrapAlice } from "../helpers/client.js";
import { TestServer } from "../helpers/server.js";

describe("en-têtes de sécurité", () => {
  let s: TestServer;
  before(async () => {
    s = await TestServer.start();
    await bootstrapAlice(s);
  });
  after(() => s.cleanup());

  const pages = ["/health", "/api/setup", "/api/me", "/api/inconnu", ...(existsSync(WEB_DIST) ? ["/", "/login", "/manifest.webmanifest", "/sw.js"] : [])];

  for (const path of pages) {
    it(`${path} : en-têtes présents`, async () => {
      const h = (await anonymous(s).get(path)).headers;
      assert.equal(h.get("x-content-type-options"), "nosniff");
      assert.equal(h.get("x-frame-options"), "DENY");
      assert.equal(h.get("strict-transport-security"), "max-age=31536000");
      assert.equal(h.get("referrer-policy"), "strict-origin-when-cross-origin");
      assert.match(h.get("permissions-policy") ?? "", /camera=\(\)/);
      assert.ok(h.get("content-security-policy"), "CSP");
      assert.equal(h.get("x-powered-by"), null);
    });
  }

  it("la politique CSP est stricte : rien d'autre que notre origine, pas de script ni de style en ligne, jamais intégrable dans une autre page", async () => {
    const csp = (await anonymous(s).get("/api/setup")).headers.get("content-security-policy")!;
    const d = new Map(csp.split(";").map((p) => p.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    assert.deepEqual(d.get("default-src"), ["'self'"]);
    assert.deepEqual(d.get("script-src"), ["'self'"]);
    assert.deepEqual(d.get("style-src"), ["'self'"]);
    assert.deepEqual(d.get("connect-src"), ["'self'"]);
    assert.deepEqual(d.get("frame-ancestors"), ["'none'"]);
    assert.deepEqual(d.get("object-src"), ["'none'"]);
    assert.ok(!/unsafe-(inline|eval)/.test(csp), "ni unsafe-inline ni unsafe-eval");
    assert.ok(d.get("img-src")!.includes("blob:"), "aperçu d'une photo choisie");
  });
});
