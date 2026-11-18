// Logique d'arrosage et de rappels, horloge injectée : aucun serveur, aucune attente.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import webpush from "web-push";

const DIR = mkdtempSync(join(tmpdir(), "plantes-unit-"));
const keys = webpush.generateVAPIDKeys();
process.env.DATA_DIR = DIR;
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.PUSH_DRY_RUN_FILE = join(DIR, "push.jsonl");
writeFileSync(process.env.PUSH_DRY_RUN_FILE, "");

const { parisParts, addDays, diffDays, seasonOf } = await import("../../apps/api/src/lib/time.js");
const { computeWater, postponeDays, waterStatuses } = await import("../../apps/api/src/lib/watering.js");
const { db } = await import("../../apps/api/src/db/instance.js");
const { PushService } = await import("../../apps/api/src/push.js");
const { runReminders, reminderMessage, REMINDER_HOURS } = await import("../../apps/api/src/reminders.js");

after(() => rmSync(DIR, { recursive: true, force: true }));
const d = (iso: string) => new Date(iso);

describe("dates et fuseau (Europe/Paris)", () => {
  it("créneaux par défaut : 9 h et 18 h", () => assert.deepEqual(REMINDER_HOURS, [9, 18]));
  it("minuit à Paris, en hiver et en été", () => {
    assert.deepEqual(parisParts(d("2026-11-17T23:30:00Z")), { date: "2026-11-18", hour: 0, minute: 30 });
    assert.deepEqual(parisParts(d("2026-07-17T22:30:00Z")), { date: "2026-07-18", hour: 0, minute: 30 });
  });
  it("passage à l'heure d'été (29/03/2026) : l'heure 2 h n'existe pas", () => {
    assert.equal(parisParts(d("2026-03-29T00:59:00Z")).hour, 1);
    assert.equal(parisParts(d("2026-03-29T01:00:00Z")).hour, 3);
  });
  it("passage à l'heure d'hiver (25/10/2026) : 2 h 30 existe deux fois", () => {
    assert.equal(parisParts(d("2026-10-25T00:30:00Z")).hour, 2);
    assert.equal(parisParts(d("2026-10-25T01:30:00Z")).hour, 2);
  });
  it("calendrier : fin de février, nouvel an, changement d'heure", () => {
    assert.equal(addDays("2026-02-27", 3), "2026-03-02");
    assert.equal(addDays("2026-12-30", 3), "2027-01-02");
    assert.equal(diffDays("2026-03-28", "2026-03-30"), 2);
  });
  it("saisons : avril à septembre = été", () => {
    assert.deepEqual(["2026-03-31", "2026-04-01", "2026-09-30", "2026-10-01"].map(seasonOf), ["winter", "summer", "summer", "winter"]);
  });
});

describe("calcul de l'arrosage", () => {
  const NOW = d("2026-11-18T10:00:00Z");
  const base = { createdAt: d("2026-11-10T08:00:00Z"), lastWateredAt: null as Date | null, lastStillWetAt: null as Date | null, summerDays: 7, winterDays: 12 };

  it("« encore humide » repousse d'un quart de l'intervalle, de 2 à 7 jours", () => {
    assert.deepEqual([2, 7, 14, 30, 60].map(postponeDays), [2, 2, 4, 7, 7]);
  });
  it("jamais arrosée : compte depuis la création", () => {
    const w = computeWater(base, NOW);
    assert.deepEqual([w.dueDate, w.daysUntil, w.snoozed], ["2026-11-22", 4, false]);
  });
  it("en retard de 5 jours", () => {
    const w = computeWater({ ...base, lastWateredAt: d("2026-11-01T09:00:00Z") }, NOW);
    assert.deepEqual([w.dueDate, w.daysUntil], ["2026-11-13", -5]);
  });
  it("« encore humide » aujourd'hui : repoussé de 3 jours", () => {
    const w = computeWater({ ...base, lastWateredAt: d("2026-11-01T09:00:00Z"), lastStillWetAt: d("2026-11-18T09:00:00Z") }, NOW);
    assert.deepEqual([w.dueDate, w.daysUntil, w.snoozed], ["2026-11-21", 3, true]);
  });
  it("un « encore humide » antérieur au dernier arrosage est ignoré", () => {
    const w = computeWater({ ...base, lastWateredAt: d("2026-11-19T09:00:00Z"), lastStillWetAt: d("2026-11-18T09:00:00Z") }, d("2026-11-20T10:00:00Z"));
    assert.equal(w.snoozed, false);
  });
  it("un « encore humide » avant l'échéance n'a aucun effet", () => {
    const w = computeWater({ ...base, lastWateredAt: d("2026-11-15T09:00:00Z"), lastStillWetAt: d("2026-11-16T09:00:00Z") }, NOW);
    assert.deepEqual([w.dueDate, w.snoozed], ["2026-11-27", false]);
  });
  it("en été : l'intervalle d'été", () => {
    const w = computeWater({ ...base, lastWateredAt: d("2026-07-01T09:00:00Z") }, d("2026-07-05T10:00:00Z"));
    assert.deepEqual([w.intervalDays, w.dueDate], [7, "2026-07-08"]);
  });
  it("arrosé à 23 h 30 UTC = le lendemain à Paris : l'échéance part du lendemain", () => {
    assert.equal(computeWater({ ...base, lastWateredAt: d("2026-11-17T23:30:00Z") }, NOW).dueDate, "2026-11-30");
  });
});

describe("rappels : créneaux, doublons, relance, foyers", () => {
  const raw = db.sqlite;
  const sheet = (s: number, w: number) => JSON.stringify({ watering: { intervalDaysSummer: s, intervalDaysWinter: w } });
  const addHousehold = (id: string, users: string[]) => {
    raw.prepare("insert into households(id,name,created_at) values(?,?,?)").run(id, id, Date.now());
    for (const u of users) {
      raw.prepare("insert into user(id,name,email) values(?,?,?)").run(u, u, `${u}@t.test`);
      raw.prepare("insert into household_members(user_id,household_id,joined_at) values(?,?,?)").run(u, id, Date.now());
    }
  };
  const addPlant = (id: string, h: string, name: string, care: string | null, created: string) =>
    raw.prepare("insert into plants(id,household_id,name,care_sheet,created_at) values(?,?,?,?,?)").run(id, h, name, care, d(created).getTime());
  const addSub = (endpoint: string, user: string | null) =>
    raw.prepare("insert into push_subscriptions(endpoint,p256dh,auth,user_id,created_at) values(?,?,?,?,?)").run(endpoint, "p", "a", user, 1);
  const event = (id: string, plant: string, h: string, user: string, type: string, at: string) =>
    raw.prepare("insert into care_events(id,plant_id,household_id,user_id,type,created_at) values(?,?,?,?,?,?)").run(id, plant, h, user, type, d(at).getTime());
  const sent = () => readFileSync(process.env.PUSH_DRY_RUN_FILE!, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const clearSent = () => writeFileSync(process.env.PUSH_DRY_RUN_FILE!, "");
  const J = "2026-11-18"; // 9 h Paris = 08:00Z (hiver)
  let push: InstanceType<typeof PushService>;

  it("mise en place : 3 foyers, 6 plantes, 4 abonnements, 1 abonnement sans compte", () => {
    addHousehold("h1", ["u1", "u2"]);
    addHousehold("h2", ["u3"]);
    addHousehold("h3", ["u4"]); // une plante à arroser, aucun appareil abonné
    addPlant("p-calathea", "h1", "Calathea", sheet(7, 12), "2026-11-01T08:00:00Z");
    addPlant("p-pothos", "h1", "Pothos", sheet(7, 12), "2026-11-01T08:00:00Z");
    addPlant("p-ficus", "h1", "Ficus", sheet(7, 12), "2026-11-15T08:00:00Z"); // échue le 27/11
    addPlant("p-nofiche", "h1", "Sans fiche", null, "2026-10-01T08:00:00Z");
    addPlant("p-h2", "h2", "Monstera", sheet(7, 12), "2026-11-01T08:00:00Z");
    addPlant("p-h3", "h3", "Cactus", sheet(7, 12), "2026-11-01T08:00:00Z");
    addSub("https://push.test/u1-a", "u1");
    addSub("https://push.test/u1-b", "u1");
    addSub("https://push.test/u2", "u2");
    addSub("https://push.test/u3", "u3");
    push = new PushService(db);
    addSub("https://push.test/orphelin", null); // ajouté APRÈS le démarrage (la purge n'a lieu qu'au démarrage) : jamais ciblé
  });

  it("waterStatuses : seules les plantes avec fiche, seulement celles du foyer", () => {
    const st = waterStatuses("h1", d(`${J}T10:00:00Z`));
    assert.deepEqual([...st.keys()].sort(), ["p-calathea", "p-ficus", "p-pothos"]);
    assert.equal(st.get("p-calathea")?.daysUntil, -5);
    assert.equal(st.get("p-ficus")?.daysUntil, 9);
  });

  it("avant 9 h : rien", async () => {
    assert.deepEqual(await runReminders(push, d(`${J}T07:59:00Z`)), []);
  });

  it("9 h : un message regroupé par personne, vers ses seuls appareils, sans fuite entre foyers", async () => {
    const r = await runReminders(push, d(`${J}T08:00:00Z`));
    assert.deepEqual(r.map((x) => [x.householdId, x.plants, x.devices]).sort(), [["h1", 2, 3], ["h2", 1, 1], ["h3", 1, 0]]);
    const m = sent();
    assert.equal(m.length, 4);
    const h1 = m.filter((x) => x.userId === "u1" || x.userId === "u2");
    assert.deepEqual([...new Set(h1.map((x) => x.payload.title))], ["💧 2 plantes à arroser"]);
    assert.deepEqual([...new Set(h1.map((x) => x.payload.body))], ["Calathea, Pothos"], "noms triés ; ni la plante sans fiche ni le Ficus");
    assert.deepEqual(m.filter((x) => x.userId === "u3").map((x) => [x.payload.title, x.payload.body]), [["💧 1 plante à arroser", "Monstera"]]);
    assert.equal(m.some((x) => x.endpoint.includes("orphelin")), false, "un abonnement sans compte n'est jamais ciblé");
    assert.equal(m.some((x) => x.userId === "u4"), false);
    assert.deepEqual(raw.prepare("select count(*) n from reminder_log where slot=?").get(`${J}#9`), { n: 3 });
  });

  it("pas de doublon dans le même créneau", async () => {
    clearSent();
    assert.deepEqual(await runReminders(push, d(`${J}T08:30:00Z`)), []);
    assert.deepEqual(await runReminders(push, d(`${J}T09:59:00Z`)), []);
    assert.equal(sent().length, 0);
  });

  it("relance de 18 h : seulement ce qui reste à arroser", async () => {
    event("e1", "p-calathea", "h1", "u1", "watered", `${J}T14:00:00Z`); // u1 arrose
    event("e2", "p-pothos", "h1", "u2", "still_wet", `${J}T15:00:00Z`); // u2 : encore humide
    const r = await runReminders(push, d(`${J}T17:00:00Z`));
    assert.deepEqual(r.map((x) => [x.householdId, x.plants]).sort(), [["h2", 1], ["h3", 1]], "h1 n'est plus relancé");
    assert.deepEqual(sent().map((x) => [x.userId, x.payload.body]), [["u3", "Toujours à arroser : Monstera"]]);
    assert.deepEqual(raw.prepare("select plant_count n from reminder_log where slot=? and household_id='h1'").get(`${J}#18`), { n: 0 });
  });

  it("le lendemain à 9 h : de nouveau un rappel, sans h1 (rien à arroser)", async () => {
    clearSent();
    const r = await runReminders(push, d("2026-11-19T08:05:00Z"));
    assert.deepEqual(r.map((x) => x.householdId).sort(), ["h2", "h3"]);
  });

  it("serveur éteint à 9 h : rattrapé jusqu'à 3 h après, puis abandonné", async () => {
    event("e3", "p-pothos", "h1", "u1", "watered", "2026-11-19T12:00:00Z");
    clearSent();
    const caught = await runReminders(push, d("2026-11-20T10:59:00Z")); // 11 h 59 à Paris
    assert.deepEqual(caught.map((x) => x.householdId).sort(), ["h2", "h3"]);
    assert.deepEqual(await runReminders(push, d("2026-11-21T11:00:00Z")), [], "12 h 00 : trop tard");
    assert.deepEqual(raw.prepare("select count(*) n from reminder_log where slot like '2026-11-21%'").get(), { n: 0 }, "un créneau abandonné n'est pas noté");
  });

  it("deux exécutions simultanées n'envoient chaque rappel qu'une seule fois", async () => {
    clearSent();
    const single = await runReminders(push, d("2026-12-02T08:00:00Z")); // jour de référence : une seule exécution
    const expected = sent().length;
    assert.ok(expected > 0, "il y a bien des rappels à envoyer ce jour-là");
    clearSent();
    const [a, b] = await Promise.all([runReminders(push, d("2026-12-03T08:00:00Z")), runReminders(push, d("2026-12-03T08:00:00Z"))]);
    assert.equal(sent().length, expected, "autant de messages qu'avec une seule exécution, pas le double");
    assert.equal(a.length + b.length, single.length, "chaque foyer est traité une seule fois au total");
  });

  it("heure d'été et d'hiver : le rappel part toujours à 9 h de Paris", async () => {
    addPlant("p-dst", "h2", "Fougère", sheet(7, 12), "2026-03-01T08:00:00Z");
    clearSent();
    assert.ok((await runReminders(push, d("2026-03-29T07:00:00Z"))).length > 0, "29/03/2026 : 07 h 00 UTC");
    clearSent();
    assert.ok((await runReminders(push, d("2026-10-25T08:00:00Z"))).length > 0, "25/10/2026 : 08 h 00 UTC");
  });

  it("le message : accords et plafond de 4 noms", () => {
    assert.equal(reminderMessage(["A", "B", "C", "D", "E", "F"], false).body, "A, B, C, D et 2 autres");
    assert.equal(reminderMessage(["A", "B", "C", "D", "E"], false).body, "A, B, C, D et 1 autre");
    assert.equal(reminderMessage(["A"], true).title, "💧 1 plante à arroser");
  });
});
