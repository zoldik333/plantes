import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, anonymous, bootstrapAlice, meId } from "../helpers/client.js";
import { KEY, TestServer } from "../helpers/server.js";

describe("authentification, foyer, invitations", () => {
  let s: TestServer;
  let alice: Client;
  let token: string;
  let camille: Client;
  before(async () => {
    s = await TestServer.start();
  });
  after(() => s.cleanup());

  it("avant tout compte, l'installation est proposée", async () => {
    assert.deepEqual((await anonymous(s).get("/api/setup")).json, { needsBootstrap: true });
  });

  it("le premier compte exige la clé d'installation", async () => {
    const body = { name: "Alice", email: "alice@plantes.test", password: "motdepasse-1234" };
    assert.equal((await anonymous(s).post("/api/signup", body)).status, 403, "sans clé");
    assert.equal((await anonymous(s).post("/api/signup", { ...body, bootstrapKey: "pas-la-bonne-cle-12" })).status, 403, "mauvaise clé");
  });

  it("le premier compte crée le foyer et ouvre une session", async () => {
    alice = new Client(s.url);
    const r = await alice.post("/api/signup", { name: "Alice", email: "alice@plantes.test", password: "motdepasse-1234", bootstrapKey: KEY });
    assert.equal(r.status, 200);
    assert.ok(r.headers.getSetCookie().some((c) => c.includes("session_token")), "cookie de session");
    assert.deepEqual((await anonymous(s).get("/api/setup")).json, { needsBootstrap: false });
    const me = await alice.get("/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.json.user.name, "Alice");
    assert.equal(me.json.household.members.length, 1);
  });

  it("sans session : 401, et une route /api inconnue répond en JSON 404", async () => {
    assert.equal((await anonymous(s).get("/api/me")).status, 401);
    assert.equal((await anonymous(s).get("/api/push/public-key")).status, 401);
    const r = await anonymous(s).get("/api/nimportequoi");
    assert.equal(r.status, 404);
    assert.ok(r.json?.error);
  });

  it("l'inscription est fermée : ni sans invitation, ni par la route de Better Auth", async () => {
    const body = { name: "Intrus", email: "intrus@plantes.test", password: "motdepasse-1234" };
    assert.equal((await anonymous(s).post("/api/signup", { ...body, bootstrapKey: KEY })).status, 403, "la clé ne sert qu'au premier compte");
    assert.equal((await anonymous(s).post("/api/auth/sign-up/email", body)).status, 404, "route Better Auth bloquée");
  });

  it("les données du compte sont validées", async () => {
    const inv = (await alice.post("/api/household/invitations")).json.url.split("/").pop();
    const ok = { name: "X", email: "x@plantes.test", inviteToken: inv };
    assert.equal((await anonymous(s).post("/api/signup", { ...ok, password: "court" })).status, 400, "mot de passe de 5 caractères");
    assert.equal((await anonymous(s).post("/api/signup", { ...ok, password: "motdepasse-1234", email: "pas-un-mail" })).status, 400, "e-mail invalide");
    assert.equal((await anonymous(s).post("/api/signup", { ...ok, password: "motdepasse-1234", name: "" })).status, 400, "prénom vide");
  });

  it("une invitation est à usage unique et nomme la personne qui invite", async () => {
    const created = await alice.post("/api/household/invitations");
    assert.equal(created.status, 200);
    assert.match(created.json.url, new RegExp(`^${s.url}/join/`));
    token = created.json.url.split("/").pop();
    const peek = await anonymous(s).get(`/api/invitations/${token}`);
    assert.equal(peek.status, 200);
    assert.equal(peek.json.invitedBy, "Alice");

    camille = new Client(s.url);
    assert.equal((await camille.post("/api/signup", { name: "Camille", email: "camille@plantes.test", password: "autre-mdp-5678", inviteToken: token })).status, 200);
    assert.equal((await anonymous(s).post("/api/signup", { name: "T", email: "t3@plantes.test", password: "autre-mdp-5678", inviteToken: token })).status, 403, "réutilisée");
    assert.equal((await anonymous(s).get(`/api/invitations/${token}`)).status, 404, "l'aperçu d'une invitation utilisée");
    const members = (await camille.get("/api/me")).json.household.members.map((m: { name: string }) => m.name).sort();
    assert.deepEqual(members, ["Alice", "Camille"], "même foyer");
  });

  it("une invitation expirée est refusée", async () => {
    const t = (await alice.post("/api/household/invitations")).json.url.split("/").pop();
    s.db((db) => db.prepare("update invitations set expires_at = ? where used_at is null").run(Date.now() - 1000));
    assert.equal((await anonymous(s).get(`/api/invitations/${t}`)).status, 404);
    assert.equal((await anonymous(s).post("/api/signup", { name: "T", email: "t4@plantes.test", password: "autre-mdp-5678", inviteToken: t })).status, 403);
  });

  it("un e-mail déjà pris échoue sans consommer l'invitation", async () => {
    const t = (await alice.post("/api/household/invitations")).json.url.split("/").pop();
    const r = await anonymous(s).post("/api/signup", { name: "Bis", email: "camille@plantes.test", password: "autre-mdp-5678", inviteToken: t });
    assert.equal(r.status, 422);
    assert.equal((await anonymous(s).get(`/api/invitations/${t}`)).status, 200, "invitation toujours valide");
  });

  it("une requête d'écriture venant d'une autre origine est refusée", async () => {
    assert.equal((await alice.post("/api/household/invitations", undefined, { origin: "https://evil.example" })).status, 403);
    assert.equal((await alice.post("/api/household/invitations", undefined, { origin: s.url })).status, 200, "notre origine passe");
  });

  it("mot de passe oublié : lien généré par un autre membre, à usage unique, qui révoque les sessions", async () => {
    const camilleId = await meId(camille);
    assert.equal((await alice.post(`/api/household/members/${await meId(alice)}/reset-link`)).status, 400, "pas pour soi-même");
    assert.equal((await anonymous(s).post(`/api/household/members/${camilleId}/reset-link`)).status, 401);
    const link = await alice.post(`/api/household/members/${camilleId}/reset-link`);
    assert.equal(link.status, 200);
    const t = link.json.url.split("/").pop();

    assert.equal((await anonymous(s).post("/api/reset-password", { token: t, password: "court" })).status, 400, "mot de passe trop court");
    assert.equal((await anonymous(s).post("/api/reset-password", { token: t, password: "nouveau-mdp-9999" })).status, 200);
    assert.equal((await anonymous(s).post("/api/reset-password", { token: t, password: "encore-un-mdp-1" })).status, 404, "usage unique");
    assert.equal((await camille.get("/api/me")).status, 401, "ancienne session révoquée");
    assert.equal((await anonymous(s).post("/api/auth/sign-in/email", { email: "camille@plantes.test", password: "autre-mdp-5678" })).status, 401, "ancien mot de passe");
    assert.equal((await anonymous(s).post("/api/auth/sign-in/email", { email: "camille@plantes.test", password: "nouveau-mdp-9999" })).status, 200, "nouveau mot de passe");
  });

  it("un lien de réinitialisation expiré est refusé", async () => {
    const camilleId = s.db((db) => (db.prepare("select id from user where email='camille@plantes.test'").get() as { id: string }).id);
    const t = (await alice.post(`/api/household/members/${camilleId}/reset-link`)).json.url.split("/").pop();
    s.db((db) => db.prepare("update password_resets set expires_at = ? where used_at is null").run(Date.now() - 1000));
    assert.equal((await anonymous(s).post("/api/reset-password", { token: t, password: "nouveau-mdp-0000" })).status, 404);
  });

  it("on ne peut pas lancer un lien de réinitialisation pour quelqu'un d'un autre foyer", async () => {
    assert.equal((await alice.post("/api/household/members/inexistant/reset-link")).status, 404);
  });
});

describe("limiteur d'inscription", () => {
  let s: TestServer;
  before(async () => {
    s = await TestServer.start();
  });
  after(() => s.cleanup());

  it("au-delà de 10 tentatives en 10 minutes depuis la même adresse : 429", async () => {
    const codes: number[] = [];
    const sameIp = anonymous(s);
    for (let i = 0; i < 12; i++) {
      codes.push((await sameIp.post("/api/signup", { name: "A", email: `a${i}@plantes.test`, password: "motdepasse-1234", bootstrapKey: "mauvaise-cle-123456" })).status);
    }
    assert.deepEqual(codes.slice(0, 10), Array(10).fill(403));
    assert.deepEqual(codes.slice(10), [429, 429]);
  });

  it("le compteur est par adresse : une autre adresse n'est pas bloquée", async () => {
    const r = await anonymous(s).post("/api/signup", { name: "A", email: "z@plantes.test", password: "motdepasse-1234", bootstrapKey: "mauvaise-cle-123456" });
    assert.equal(r.status, 403);
  });
});

describe("premier compte : cas limites", () => {
  let s: TestServer;
  before(async () => {
    s = await TestServer.start();
  });
  after(() => s.cleanup());

  it("deux premiers comptes simultanés : un seul foyer est créé", async () => {
    const mk = (email: string) => anonymous(s).post("/api/signup", { name: "P", email, password: "motdepasse-1234", bootstrapKey: KEY });
    const [a, b] = await Promise.all([mk("p1@plantes.test"), mk("p2@plantes.test")]);
    assert.deepEqual([a.status, b.status].sort(), [200, 403], "le second échoue : il faut maintenant une invitation");
    assert.equal(s.db((db) => (db.prepare("select count(*) n from households").get() as { n: number }).n), 1);
    assert.equal(s.db((db) => (db.prepare("select count(*) n from user").get() as { n: number }).n), 1, "pas de compte orphelin");
  });

  it("le tout premier compte puis un deuxième foyer : impossible par l'API", async () => {
    const alice = await bootstrapAlice(s, "alice2@plantes.test").catch(() => null);
    assert.equal(alice, null, "la clé d'installation ne rouvre pas la création de foyer");
  });
});
