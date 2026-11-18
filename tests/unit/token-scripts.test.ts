// scripts/apply-token.sh (node1) et scripts/rotate-token.sh (Mac) : renouvellement du jeton Claude.
// Hermétique : faux `docker` et faux `ssh` dans le PATH, dossiers temporaires, jetons factices. Aucun réseau.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const SCRIPTS = resolve(import.meta.dirname, "../../scripts");
const NOUVEAU = "sk-ant-oat01-NOUVEAUfactice_0123456789-abcdefXYZ";
const ANCIEN = "sk-ant-oat01-ANCIENfactice_9876543210-zyxwvuABC";
const AUJOURDHUI = new Date().toLocaleDateString("sv-SE"); // AAAA-MM-JJ, heure locale comme `date +%F`

const ENV_ORIGINAL = `# Configuration de l'app
PORT=3000

APP_URL=https://plantes.example.test
CLAUDE_CODE_OAUTH_TOKEN=${ANCIEN}
# commentaire au milieu
CLAUDE_TOKEN_CREATED=2025-11-16

POC_ACCESS_KEY=cle=avec=des=egal
`;

const mode = (f: string) => (statSync(f).mode & 0o777).toString(8);

describe("jeton Claude : scripts de renouvellement", () => {
  const racines: string[] = [];
  after(() => racines.forEach((r) => rmSync(r, { recursive: true, force: true })));

  // Arborescence factice : <racine>/scripts/*.sh, <racine>/.env, <racine>/bin/{docker,ssh}, <racine>/trace/.
  function monter() {
    const root = mkdtempSync(join(tmpdir(), "plantes-jeton-"));
    racines.push(root);
    const bin = join(root, "bin");
    const trace = join(root, "trace");
    mkdirSync(join(root, "scripts"));
    for (const d of [bin, trace]) mkdirSync(d);
    for (const s of ["apply-token.sh", "rotate-token.sh"]) copyFileSync(join(SCRIPTS, s), join(root, "scripts", s));
    // Faux docker : consigne ses arguments ; à chaque `up`, photographie .env ; `ps` répond FAKE_STATUS ; `exec` sort avec FAKE_PING_CODE.
    writeFileSync(
      join(bin, "docker"),
      `#!/bin/sh
echo "$*" >> "${trace}/docker-args"
case "$2" in
  up) n=$(ls "${trace}" | grep -c '^up-'); cp .env "${trace}/up-$n"; exit \${FAKE_UP_CODE:-0} ;;
  ps) echo "\${FAKE_STATUS:-Up 5 seconds (healthy)}"; exit 0 ;;
  exec) echo "sortie de ai-ping"; exit \${FAKE_PING_CODE:-0} ;;
esac
exit 0
`,
    );
    // Faux ssh : consigne les arguments (un par ligne) et l'entrée standard ; sort avec FAKE_SSH_CODE.
    writeFileSync(
      join(bin, "ssh"),
      `#!/bin/sh
for a in "$@"; do echo "$a" >> "${trace}/ssh-args"; done
cat > "${trace}/ssh-stdin"
exit \${FAKE_SSH_CODE:-0}
`,
    );
    for (const f of ["docker", "ssh"]) chmodSync(join(bin, f), 0o755);
    return { root, bin, trace };
  }

  let m: ReturnType<typeof monter>;
  let envFile: string;
  beforeEach(() => {
    m = monter();
    envFile = join(m.root, ".env");
  });

  const lancer = (script: string, entree: string, args: string[] = [], env: Record<string, string> = {}, path?: string) =>
    spawnSync("/bin/sh", [join(m.root, "scripts", script), ...args], {
      input: entree,
      encoding: "utf8",
      env: { PATH: path ?? `${m.bin}:${process.env.PATH}`, HOME: m.root, PLANTES_ATTENTE_SAIN: "2", ...env },
    });
  const apply = (entree: string, env: Record<string, string> = {}) => lancer("apply-token.sh", entree, [], env);
  const rotate = (entree: string, args: string[] = ["--stdin"], env: Record<string, string> = {}, path?: string) => lancer("rotate-token.sh", entree, args, env, path);
  const ecrireEnv = (contenu = ENV_ORIGINAL) => writeFileSync(envFile, contenu, { mode: 0o600 });
  const lire = (f: string) => readFileSync(f, "utf8");
  const dockerArgs = () => (existsSync(join(m.trace, "docker-args")) ? lire(join(m.trace, "docker-args")) : "");
  const sansLignesJeton = (s: string) => s.split("\n").filter((l) => !/^CLAUDE_(CODE_OAUTH_TOKEN|TOKEN_CREATED)=/.test(l));

  describe("apply-token.sh", () => {
    it("succès : nouveau jeton, date du jour, autres lignes identiques, droits 600, sauvegarde supprimée, rien de secret affiché", () => {
      ecrireEnv();
      const r = apply(`${NOUVEAU}\n`);
      assert.equal(r.status, 0, r.stderr);
      const apres = lire(envFile);
      assert.match(apres, new RegExp(`^CLAUDE_CODE_OAUTH_TOKEN=${NOUVEAU}$`, "m"));
      assert.match(apres, new RegExp(`^CLAUDE_TOKEN_CREATED=${AUJOURDHUI}$`, "m"));
      assert.ok(!apres.includes(ANCIEN));
      assert.deepEqual(sansLignesJeton(apres), sansLignesJeton(ENV_ORIGINAL), "autres lignes : mêmes octets, même ordre");
      assert.equal(apres.split("\n").length, ENV_ORIGINAL.split("\n").length, "pas de ligne en plus ni en moins");
      assert.equal(mode(envFile), "600");
      assert.ok(!existsSync(join(m.root, ".env.avant-jeton")), "sauvegarde supprimée");
      assert.deepEqual(readdirSync(m.root).filter((f) => f.startsWith(".env")), [".env"], "aucun fichier temporaire oublié");
      assert.match(r.stdout, /✓ Jeton renouvelé : les fiches fonctionnent\. Prochain renouvellement avant le \d{4}-\d{2}-\d{2}/);
      for (const [nom, sortie] of [["stdout", r.stdout], ["stderr", r.stderr], ["arguments docker", dockerArgs()]]) {
        assert.ok(!sortie.includes(NOUVEAU), `jeton absent de ${nom}`);
        assert.ok(!sortie.includes("sk-ant-"), `aucun jeton dans ${nom}`);
      }
      assert.match(dockerArgs(), /compose up -d app/);
      assert.match(lire(join(m.trace, "up-0")), new RegExp(NOUVEAU), "le conteneur est recréé avec le nouvel environnement");
    });

    it("lignes absentes : jeton et date ajoutés à la fin, le reste intact", () => {
      const sans = "PORT=3000\n# note\n\nAPP_URL=https://x.test\n";
      ecrireEnv(sans);
      const r = apply(`  ${NOUVEAU}  \r\n`);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(lire(envFile), `${sans}CLAUDE_CODE_OAUTH_TOKEN=${NOUVEAU}\nCLAUDE_TOKEN_CREATED=${AUJOURDHUI}\n`);
      assert.equal(mode(envFile), "600");
    });

    for (const [nom, entree] of [
      ["mauvais préfixe", "sk-ant-api03-SECRETFACTICEQUIDOITPASSERPARTOUT123"],
      ["trop court", "sk-ant-oat01-court"],
      ["caractères interdits", "sk-ant-oat01-SECRETFACTICE$$$$$$$$$$$$$$$$$$$$$$"],
      ["vide", ""],
    ] as const) {
      it(`jeton refusé (${nom}) : .env inchangé, aucun appel docker, contenu non répété`, () => {
        ecrireEnv();
        const r = apply(entree);
        assert.equal(r.status, 1);
        assert.equal(lire(envFile), ENV_ORIGINAL);
        assert.equal(dockerArgs(), "");
        assert.ok(!existsSync(join(m.root, ".env.avant-jeton")));
        assert.match(r.stderr, /format invalide/);
        if (entree) for (const sortie of [r.stdout, r.stderr]) assert.ok(!sortie.includes(entree.slice(12)), "contenu fourni non répété");
      });
    }

    it("vérification refusée (ai-ping sort 2) : .env restauré à l'identique, droits 600, conteneur recréé avec l'ancien environnement", () => {
      ecrireEnv();
      const r = apply(NOUVEAU, { FAKE_PING_CODE: "2" });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /refusé/);
      assert.match(r.stderr, /ancien jeton a été remis/);
      assert.equal(lire(envFile), ENV_ORIGINAL, "octet pour octet");
      assert.equal(mode(envFile), "600");
      assert.ok(!existsSync(join(m.root, ".env.avant-jeton")), "plus de copie de sauvegarde");
      assert.match(lire(join(m.trace, "up-0")), new RegExp(NOUVEAU), "1er up : nouveau jeton");
      assert.equal(lire(join(m.trace, "up-1")), ENV_ORIGINAL, "2e up : ancien environnement");
      for (const sortie of [r.stdout, r.stderr, dockerArgs()]) assert.ok(!sortie.includes(NOUVEAU));
    });

    it("vérification en échec (code 3) : message différent, restauration aussi", () => {
      ecrireEnv();
      const r = apply(NOUVEAU, { FAKE_PING_CODE: "3" });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /vérification a échoué \(code 3\)/);
      assert.doesNotMatch(r.stderr, /refusé/);
      assert.equal(lire(envFile), ENV_ORIGINAL);
      assert.equal(mode(envFile), "600");
    });

    it("conteneur jamais sain : échec propre, .env restauré", () => {
      ecrireEnv();
      const r = apply(NOUVEAU, { FAKE_STATUS: "Up 3 seconds (health: starting)" });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /pas devenu sain/);
      assert.equal(lire(envFile), ENV_ORIGINAL);
      assert.equal(mode(envFile), "600");
      assert.ok(!/exec/.test(dockerArgs()), "pas de vérification sur un conteneur malsain");
      assert.equal(lire(join(m.trace, "up-1")), ENV_ORIGINAL);
    });

    it("« unhealthy » n'est pas pris pour « healthy »", () => {
      ecrireEnv();
      const r = apply(NOUVEAU, { FAKE_STATUS: "Up 1 minute (unhealthy)" });
      assert.equal(r.status, 1);
      assert.equal(lire(envFile), ENV_ORIGINAL);
    });

    it(".env absent : erreur claire, rien créé, pas de docker", () => {
      const r = apply(NOUVEAU);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /\.env introuvable/);
      assert.ok(!existsSync(envFile));
      assert.deepEqual(readdirSync(m.root).filter((f) => f.startsWith(".env")), []);
      assert.equal(dockerArgs(), "");
    });
  });

  describe("rotate-token.sh", () => {
    it("jeton invalide : refusé AVANT tout appel ssh", () => {
      const r = rotate("sk-ant-oat01-trop-court");
      assert.equal(r.status, 1);
      assert.match(r.stderr, /format invalide/);
      assert.ok(!existsSync(join(m.trace, "ssh-args")), "ssh jamais appelé");
      assert.ok(!r.stderr.includes("trop-court"));
    });

    it("succès : jeton sur l'entrée standard de ssh, jamais en argument ; commande distante exacte", () => {
      const r = rotate(`${NOUVEAU}\n`);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(lire(join(m.trace, "ssh-stdin")), NOUVEAU, "jeton reçu sur stdin, sans retour à la ligne");
      const args = lire(join(m.trace, "ssh-args")).split("\n").filter(Boolean);
      assert.ok(!args.join(" ").includes("sk-ant-"), "jeton absent des arguments");
      assert.equal(args.at(-1), "cd ~/plantes && sh scripts/apply-token.sh");
      assert.equal(args.at(-2), "zoldik333@192.168.1.10");
      assert.ok(args.includes("BatchMode=yes") && args.includes(`${m.root}/.ssh/node1`));
      for (const sortie of [r.stdout, r.stderr]) assert.ok(!sortie.includes(NOUVEAU));
    });

    it("variables PLANTES_SSH / PLANTES_SSH_OPTS / PLANTES_DIR prises en compte", () => {
      const r = rotate(NOUVEAU, ["--stdin"], { PLANTES_SSH: "moi@hote", PLANTES_SSH_OPTS: "-p 2222", PLANTES_DIR: "autre" });
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(lire(join(m.trace, "ssh-args")).split("\n").filter(Boolean), ["-p", "2222", "moi@hote", "cd ~/autre && sh scripts/apply-token.sh"]);
    });

    it("le code de sortie de ssh est repris, et le .env local n'est pas touché", () => {
      writeFileSync(envFile, ENV_ORIGINAL);
      const r = rotate(NOUVEAU, ["--stdin", "--also-local"], { FAKE_SSH_CODE: "1" });
      assert.equal(r.status, 1);
      assert.equal(lire(envFile), ENV_ORIGINAL);
      assert.equal(rotate(NOUVEAU, ["--stdin"], { FAKE_SSH_CODE: "255" }).status, 255);
    });

    it("--also-local : .env local mis à jour (droits 600, autres lignes intactes)", () => {
      writeFileSync(envFile, ENV_ORIGINAL, { mode: 0o644 });
      const r = rotate(NOUVEAU, ["--stdin", "--also-local"]);
      assert.equal(r.status, 0, r.stderr);
      const apres = lire(envFile);
      assert.match(apres, new RegExp(`^CLAUDE_CODE_OAUTH_TOKEN=${NOUVEAU}$`, "m"));
      assert.match(apres, new RegExp(`^CLAUDE_TOKEN_CREATED=${AUJOURDHUI}$`, "m"));
      assert.deepEqual(sansLignesJeton(apres), sansLignesJeton(ENV_ORIGINAL));
      assert.equal(mode(envFile), "600");
      assert.deepEqual(readdirSync(m.root).filter((f) => f.startsWith(".env")), [".env"]);
      for (const sortie of [r.stdout, r.stderr]) assert.ok(!sortie.includes(NOUVEAU));
    });

    it("sans --stdin et sans `claude` : message d'aide explicite, aucun appel ssh", () => {
      const vide = join(m.root, "vide");
      mkdirSync(vide);
      for (const [o, d] of [["dirname", "/usr/bin"], ["cat", "/bin"]]) symlinkSync(`${d}/${o}`, join(vide, o)); // seuls outils nécessaires avant le message ; pas de `claude`
      const r = rotate("", [], {}, vide);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /« claude » est introuvable/);
      assert.match(r.stderr, /Installez Claude Code/);
      assert.ok(!existsSync(join(m.trace, "ssh-args")));
    });
  });
});
