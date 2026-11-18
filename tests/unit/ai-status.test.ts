// État de l'IA, notifications aux propriétaires et surveillance du jeton : horloge injectée, base temporaire.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import webpush from "web-push";

const DIR = mkdtempSync(join(tmpdir(), "plantes-unit-ai-"));
const keys = webpush.generateVAPIDKeys();
process.env.DATA_DIR = DIR;
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.PUSH_DRY_RUN_FILE = join(DIR, "push.jsonl");
delete process.env.CLAUDE_TOKEN_CREATED;
writeFileSync(process.env.PUSH_DRY_RUN_FILE, "");

const { db } = await import("../../apps/api/src/db/instance.js");
const { PushService } = await import("../../apps/api/src/push.js");
const { AiProviderError } = await import("../../apps/api/src/ai/provider.js");
const { getAiStatus, initAiStatus, ownerOf, recordGenerationOutcome, runTokenWatch, tokenInfo, currentAiState } = await import("../../apps/api/src/ai-status.js");
const { pingOutcome } = await import("../../apps/api/src/ai-status.js");
const { heartbeatTarget } = await import("../../apps/api/src/reminders.js");

after(() => rmSync(DIR, { recursive: true, force: true }));
const d = (iso: string) => new Date(iso);
const raw = db.sqlite;

// h1 : u1 (arrivé en premier) et u2 ; h2 : u3 ; h3 : deux membres arrivés au même instant (le plus petit identifiant gagne).
const addHousehold = (id: string, members: [string, number][]) => {
  raw.prepare("insert into households(id,name,created_at) values(?,?,?)").run(id, id, 1);
  for (const [u, joined] of members) {
    raw.prepare("insert into user(id,name,email) values(?,?,?)").run(u, u, `${u}@t.test`);
    raw.prepare("insert into household_members(user_id,household_id,joined_at) values(?,?,?)").run(u, id, joined);
    raw.prepare("insert into push_subscriptions(endpoint,p256dh,auth,user_id,created_at) values(?,?,?,?,?)").run(`https://push.test/${u}`, "p", "a", u, 1);
  }
};
addHousehold("h1", [["u2", 2000], ["u1", 1000]]);
addHousehold("h2", [["u3", 5000]]);
addHousehold("h3", [["u5", 7000], ["u4", 7000]]);
const push = new PushService(db);
initAiStatus(push);

const sent = () =>
  readFileSync(process.env.PUSH_DRY_RUN_FILE!, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { userId: string; payload: { title: string; body: string; url: string } });
const OWNERS = ["u1", "u3", "u4"];
const recipients = () => sent().map((m) => m.userId).sort();
const titles = () => [...new Set(sent().map((m) => m.payload.title))];
const fail = (code: "auth" | "account" | "usage_limit" | "overloaded" | "timeout" | "other") => new AiProviderError("x", undefined, code);

beforeEach(() => {
  raw.prepare("delete from system_state").run();
  writeFileSync(process.env.PUSH_DRY_RUN_FILE!, "");
  delete process.env.CLAUDE_TOKEN_CREATED;
});

describe("tokenInfo", () => {
  it("expiration = création + 365 jours, jours restants calendaires (Paris)", () => {
    process.env.CLAUDE_TOKEN_CREATED = "2026-01-10";
    assert.deepEqual(tokenInfo(d("2026-11-18T10:00:00Z")), { expiresAt: "2027-01-10", daysLeft: 53, created: "2026-01-10" });
  });
  it("le jour compte à Paris : 23 h 30 UTC = déjà le lendemain", () => {
    process.env.CLAUDE_TOKEN_CREATED = "2026-01-10";
    assert.equal(tokenInfo(d("2026-11-17T23:30:00Z"))?.daysLeft, 53);
    assert.equal(tokenInfo(d("2026-11-17T22:30:00Z"))?.daysLeft, 54);
  });
  it("dernier jour = 0, dépassé = négatif", () => {
    process.env.CLAUDE_TOKEN_CREATED = "2026-01-01";
    assert.equal(tokenInfo(d("2027-01-01T12:00:00Z"))?.daysLeft, 0);
    assert.equal(tokenInfo(d("2027-01-04T12:00:00Z"))?.daysLeft, -3);
  });
  it("année bissextile : 365 jours exactement", () => {
    process.env.CLAUDE_TOKEN_CREATED = "2027-03-01";
    assert.equal(tokenInfo(d("2027-03-01T12:00:00Z"))?.expiresAt, "2028-02-29");
  });
  it("variable absente ou invalide : null", () => {
    assert.equal(tokenInfo(d("2026-11-18T10:00:00Z")), null);
    for (const bad of ["", "hier", "2026-13-40", "2026-02-30", "18/11/2026", "2026-1-1"]) {
      process.env.CLAUDE_TOKEN_CREATED = bad;
      assert.equal(tokenInfo(d("2026-11-18T10:00:00Z")), null, bad);
    }
  });
});

describe("propriétaire et état par personne", () => {
  it("propriétaire = membre le plus ancien ; égalité : identifiant le plus petit", () => {
    assert.deepEqual(["h1", "h2", "h3"].map(ownerOf), ["u1", "u3", "u4"]);
    assert.equal(ownerOf("inconnu"), null);
  });
  it("getAiStatus : isOwner selon la personne, état initial « ok »", () => {
    const now = d("2026-11-18T10:00:00Z");
    process.env.CLAUDE_TOKEN_CREATED = "2026-01-10";
    assert.deepEqual(getAiStatus("u1", now), { status: "ok", problem: null, since: null, tokenExpiresAt: "2027-01-10", daysLeft: 53, isOwner: true });
    assert.equal(getAiStatus("u2", now).isOwner, false);
    assert.equal(getAiStatus("fantome", now).isOwner, false);
    delete process.env.CLAUDE_TOKEN_CREATED;
    assert.deepEqual([getAiStatus("u1", now).tokenExpiresAt, getAiStatus("u1", now).daysLeft], [null, null]);
  });
});

describe("machine à états des générations", () => {
  const T = d("2026-11-18T10:00:00Z");

  it("succès quand tout va bien : aucun effet, aucune notification", async () => {
    await recordGenerationOutcome(push, null, T);
    assert.equal(currentAiState().status, "ok");
    assert.equal(sent().length, 0);
  });

  it("échec d'authentification : « problem » + une seule notification, puis rien de plus", async () => {
    await recordGenerationOutcome(push, fail("auth"), T);
    const s = getAiStatus("u1", T);
    assert.deepEqual([s.status, s.problem, s.since], ["problem", "auth", T.toISOString()]);
    assert.deepEqual(recipients(), OWNERS);
    assert.deepEqual(titles(), ["⚠️ Les fiches ne se génèrent plus : le jeton Claude est invalide"]);
    assert.equal(sent()[0].payload.url, "/settings");

    await recordGenerationOutcome(push, fail("auth"), d("2026-11-18T10:05:00Z"));
    assert.equal(sent().length, 3, "pas de nouvelle notification");
    assert.equal(getAiStatus("u1", T).since, T.toISOString(), "since inchangé");
  });

  it("échec de compte : « problem/account » avec son propre texte", async () => {
    await recordGenerationOutcome(push, fail("account"), T);
    assert.equal(getAiStatus("u1", T).problem, "account");
    assert.match(titles()[0], /compte Claude/);
  });

  it("limite d'usage, surcharge, délai, autre échec et erreur quelconque : jamais de changement ni de notification", async () => {
    for (const code of ["usage_limit", "overloaded", "timeout", "other"] as const) await recordGenerationOutcome(push, fail(code), T);
    await recordGenerationOutcome(push, new Error("bug"), T);
    assert.equal(currentAiState().status, "ok");
    assert.equal(sent().length, 0);
    // et pendant un problème, ils ne le guérissent pas non plus
    await recordGenerationOutcome(push, fail("auth"), T);
    await recordGenerationOutcome(push, fail("usage_limit"), T);
    assert.equal(currentAiState().status, "problem");
    assert.equal(sent().length, 3);
  });

  it("succès après problème : retour à « ok » + notification de rétablissement", async () => {
    await recordGenerationOutcome(push, fail("auth"), T);
    writeFileSync(process.env.PUSH_DRY_RUN_FILE!, "");
    await recordGenerationOutcome(push, null, d("2026-11-18T11:00:00Z"));
    assert.deepEqual([currentAiState().status, currentAiState().problem, currentAiState().since], ["ok", null, null]);
    assert.deepEqual(recipients(), OWNERS);
    assert.deepEqual(titles(), ["✅ Les fiches fonctionnent de nouveau"]);
    await recordGenerationOutcome(push, null, d("2026-11-18T12:00:00Z"));
    assert.equal(sent().length, 3, "un second succès ne notifie pas");
  });

  it("notifications : propriétaires uniquement, foyers jamais mélangés", async () => {
    await recordGenerationOutcome(push, fail("auth"), T);
    const r = sent();
    assert.equal(r.some((m) => ["u2", "u5"].includes(m.userId)), false, "les autres membres ne reçoivent rien");
    assert.deepEqual(r.map((m) => m.userId).sort(), ["u1", "u3", "u4"], "un message par propriétaire, un par foyer");
  });

  it("sans service push (outil en ligne de commande) : l'état change quand même", async () => {
    await recordGenerationOutcome(null, fail("auth"), T);
    assert.equal(currentAiState().status, "problem");
    assert.equal(sent().length, 0);
  });
});

describe("surveillance du jeton (runTokenWatch)", () => {
  const H = [9, 18];
  const run = (iso: string, hours = H) => runTokenWatch(push, d(iso), hours);
  const lastTitle = () => sent().at(-1)?.payload.title;

  it("seuils 30/14/7/3/1/0 : une fois chacun, aux seuls propriétaires", async () => {
    process.env.CLAUDE_TOKEN_CREATED = "2026-01-01"; // expire le 2027-01-01
    await run("2026-11-20T08:30:00Z"); // 42 jours : rien
    assert.equal(sent().length, 0);
    const steps: [string, string][] = [
      ["2026-12-02T08:30:00Z", "🔑 Le jeton Claude expire dans 30 jours"],
      ["2026-12-03T08:30:00Z", ""], // 29 : déjà prévenu pour le seuil 30
      ["2026-12-18T08:30:00Z", "🔑 Le jeton Claude expire dans 14 jours"],
      ["2026-12-25T08:30:00Z", "🔑 Le jeton Claude expire dans 7 jours"],
      ["2026-12-29T08:30:00Z", "🔑 Le jeton Claude expire dans 3 jours"],
      ["2026-12-31T08:30:00Z", "🔑 Le jeton Claude expire dans 1 jour"],
      ["2027-01-01T08:30:00Z", "🔑 Le jeton Claude a expiré"],
      ["2027-01-05T08:30:00Z", ""], // -4 : déjà prévenu
    ];
    for (const [when, title] of steps) {
      writeFileSync(process.env.PUSH_DRY_RUN_FILE!, "");
      await run(when);
      if (title) {
        assert.deepEqual(titles(), [title], when);
        assert.deepEqual(recipients(), OWNERS, when);
        assert.equal(sent()[0].payload.url, "/settings");
      } else assert.equal(sent().length, 0, when);
    }
  });

  it("jours sautés : le premier passage sous un seuil envoie ce seuil, avec le vrai nombre de jours", async () => {
    process.env.CLAUDE_TOKEN_CREATED = "2026-01-01";
    await run("2026-12-22T08:30:00Z"); // 10 jours : seuil 14
    assert.equal(lastTitle(), "🔑 Le jeton Claude expire dans 10 jours");
    await run("2026-12-23T08:30:00Z"); // 9 jours : toujours le seuil 14, déjà fait
    assert.equal(sent().length, 3);
  });

  it("une seule exécution par jour (jour de Paris)", async () => {
    process.env.CLAUDE_TOKEN_CREATED = "2026-01-01";
    await run("2026-12-02T08:00:00Z");
    assert.equal(sent().length, 3);
    // Même jour, jeton « renouvelé » entre-temps : l'exécution du jour est déjà faite
    process.env.CLAUDE_TOKEN_CREATED = "2025-12-04";
    await run("2026-12-02T17:00:00Z");
    assert.equal(sent().length, 3);
  });

  it("pas avant la première heure de rappel, ni si REMINDER_HOURS est vide", async () => {
    process.env.CLAUDE_TOKEN_CREATED = "2026-01-01";
    await run("2026-12-02T07:59:00Z"); // 8 h 59 à Paris
    assert.equal(sent().length, 0);
    await run("2026-12-02T12:00:00Z", []);
    assert.equal(sent().length, 0);
    await recordGenerationOutcome(null, fail("auth"), d("2026-12-01T12:00:00Z"));
    await run("2026-12-05T12:00:00Z", []);
    assert.equal(sent().length, 0, "ni relance de problème");
    await run("2026-12-02T08:00:00Z"); // 9 h 00 : c'est parti
    assert.equal(lastTitle(), "🔑 Le jeton Claude expire dans 30 jours");
  });

  it("les seuils recommencent après un renouvellement (CLAUDE_TOKEN_CREATED change)", async () => {
    process.env.CLAUDE_TOKEN_CREATED = "2026-01-01";
    await run("2026-12-02T08:30:00Z");
    assert.equal(sent().length, 3);
    process.env.CLAUDE_TOKEN_CREATED = "2026-12-03"; // nouveau jeton : expire le 2027-12-03
    writeFileSync(process.env.PUSH_DRY_RUN_FILE!, "");
    await run("2027-11-03T08:30:00Z"); // 30 jours
    assert.equal(lastTitle(), "🔑 Le jeton Claude expire dans 30 jours");
    assert.equal(sent().length, 3);
  });

  it("sans CLAUDE_TOKEN_CREATED : aucune alerte d'expiration", async () => {
    await run("2026-12-02T08:30:00Z");
    assert.equal(sent().length, 0);
  });

  it("relance toutes les 24 h tant que l'état est « problem »", async () => {
    await recordGenerationOutcome(push, fail("auth"), d("2026-11-18T12:00:00Z")); // 13 h à Paris
    assert.equal(sent().length, 3);
    await run("2026-11-19T11:00:00Z"); // 23 h plus tard
    assert.equal(sent().length, 3);
    await run("2026-11-19T12:00:00Z"); // 24 h
    assert.equal(sent().length, 6);
    assert.deepEqual(recipients(), ["u1", "u1", "u3", "u3", "u4", "u4"]);
    assert.match(lastTitle()!, /jeton Claude est invalide/);
    await run("2026-11-19T12:01:00Z");
    assert.equal(sent().length, 6, "pas de relance en double");
    await run("2026-11-20T12:00:00Z");
    assert.equal(sent().length, 9);
    // rétabli : plus de relance
    await recordGenerationOutcome(push, null, d("2026-11-20T13:00:00Z"));
    const n = sent().length;
    await run("2026-11-22T12:00:00Z");
    assert.equal(sent().length, n);
  });
});

describe("heartbeatTarget", () => {
  it("« ok » : l'adresse telle quelle ; « problem » : /fail (format healthchecks.io)", () => {
    assert.equal(heartbeatTarget("https://hc-ping.com/abc", "ok"), "https://hc-ping.com/abc");
    assert.equal(heartbeatTarget("https://hc-ping.com/abc", "problem"), "https://hc-ping.com/abc/fail");
    assert.equal(heartbeatTarget("https://hc-ping.com/abc/", "problem"), "https://hc-ping.com/abc/fail");
  });
  it("conserve la query ; URL invalide renvoyée telle quelle", () => {
    assert.equal(heartbeatTarget("https://hc-ping.com/abc?x=1", "problem"), "https://hc-ping.com/abc/fail?x=1");
    assert.equal(heartbeatTarget("https://hc-ping.com/abc/?x=1", "problem"), "https://hc-ping.com/abc/fail?x=1");
    assert.equal(heartbeatTarget("https://hc-ping.com/abc?x=1", "ok"), "https://hc-ping.com/abc?x=1");
    assert.equal(heartbeatTarget("pas une url", "problem"), "pas une url");
  });
});

describe("pingOutcome (ai:ping)", () => {
  const okProvider = { name: "t", generateCareSheet: async () => ({ sheet: {} as never, provider: "t", durationMs: 1500 }) };
  const failing = (code: "auth" | "account" | "other") => ({ name: "t", generateCareSheet: async () => { throw new AiProviderError("x", undefined, code); } });
  it("succès : l'état « problem » repasse à « ok », sans notification", async () => {
    await recordGenerationOutcome(null, fail("auth"), d("2026-11-18T10:00:00Z"));
    assert.equal(currentAiState().status, "problem");
    const r = await pingOutcome(okProvider, d("2026-11-18T11:00:00Z"));
    assert.equal(r.code, 0);
    assert.equal(currentAiState().status, "ok");
    assert.equal(sent().length, 0);
  });
  it("échec auth / account : état « problem » et bon code de sortie", async () => {
    assert.equal((await pingOutcome(failing("auth"))).code, 2);
    assert.deepEqual([currentAiState().status, currentAiState().problem], ["problem", "auth"]);
    assert.equal((await pingOutcome(failing("account"))).code, 4);
    assert.equal(currentAiState().problem, "account");
  });
  it("autre échec : code 3, état inchangé", async () => {
    assert.equal((await pingOutcome(failing("other"))).code, 3);
    assert.equal(currentAiState().status, "ok");
  });
});
