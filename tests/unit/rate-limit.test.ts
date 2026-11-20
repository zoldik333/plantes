// Limiteur de débit : normalisation des IP, fenêtre, purge. Horloge injectée, aucun serveur.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { normalizeIp, clientIp, Limiter, envInt } = await import("../../apps/api/src/lib/rate-limit.js");

describe("normalizeIp", () => {
  it("sans adresse : local", () => {
    assert.equal(normalizeIp(undefined), "local");
    assert.equal(normalizeIp("  "), "local");
  });
  it("IPv4 inchangée, port retiré", () => {
    assert.equal(normalizeIp("203.0.113.7"), "203.0.113.7");
    assert.equal(normalizeIp("203.0.113.7:5555"), "203.0.113.7");
  });
  it("IPv4-mappée ramenée en IPv4", () => {
    assert.equal(normalizeIp("::ffff:203.0.113.7"), "203.0.113.7");
    assert.equal(normalizeIp("::FFFF:cb00:7107"), "203.0.113.7");
  });
  it("IPv6 : même /64 = même clé, /64 différent = clé différente", () => {
    const a = normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    assert.equal(a, normalizeIp("2001:db8:1:2::1"));
    assert.equal(a, normalizeIp("2001:0DB8:0001:0002:ffff:ffff:ffff:ffff"));
    assert.equal(a, normalizeIp("[2001:db8:1:2::9]:443"));
    assert.notEqual(a, normalizeIp("2001:db8:1:3::1"));
  });
  it("formes abrégées", () => {
    assert.equal(normalizeIp("::1"), normalizeIp("0:0:0:0:1:2:3:4"));
    assert.notEqual(normalizeIp("::1"), normalizeIp("2001:db8::1"));
  });
  it("adresse illisible : seau commun borné", () => {
    for (const bad of ["n'importe quoi", "999.1.1.1", "1:2:3", "1::2::3", "gggg::1"]) assert.equal(normalizeIp(bad), "invalid");
  });
  it("clientIp : première valeur de X-Forwarded-For", () => {
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
    assert.equal(clientIp(new Headers()), "local");
  });
});

describe("Limiter", () => {
  it("bloque au-delà du plafond puis se rétablit à la fin de la fenêtre", () => {
    let t = 1000;
    const l = new Limiter(3, 10_000, () => t);
    assert.deepEqual([1, 2, 3].map(() => l.hit("a").ok), [true, true, true]);
    const r = l.hit("a");
    assert.equal(r.ok, false);
    assert.equal(r.retryAfter, 10);
    assert.equal(l.hit("b").ok, true, "une autre clé est indépendante");
    t += 9_999;
    assert.equal(l.hit("a").ok, false);
    t += 1;
    assert.equal(l.hit("a").ok, true);
  });
  it("sweep supprime les fenêtres expirées", () => {
    let t = 0;
    const l = new Limiter(1, 1000, () => t);
    for (let i = 0; i < 50; i++) l.hit(`k${i}`);
    assert.equal(l.size, 50);
    t = 999;
    l.sweep();
    assert.equal(l.size, 50);
    t = 1000;
    l.sweep();
    assert.equal(l.size, 0);
  });
  it("mémoire bornée sous un balayage d'adresses", () => {
    const l = new Limiter(1, 60_000, () => 0);
    for (let i = 0; i < 20_000; i++) l.hit(`k${i}`);
    assert.ok(l.size <= 5000, `taille ${l.size}`);
    assert.equal(l.hit("k19999").ok, false, "les clés récentes sont conservées");
  });
});

describe("envInt", () => {
  it("valeurs invalides ou hors bornes ignorées", () => {
    const set = (v?: string) => (v === undefined ? delete process.env.RL_TEST : (process.env.RL_TEST = v));
    set();
    assert.equal(envInt("RL_TEST", 7, 1, 100), 7);
    for (const bad of ["abc", "-3", "0", "1000", "1.5", ""]) {
      set(bad);
      assert.equal(envInt("RL_TEST", 7, 1, 100), 7, bad);
    }
    set("42");
    assert.equal(envInt("RL_TEST", 7, 1, 100), 42);
    set();
  });
});
