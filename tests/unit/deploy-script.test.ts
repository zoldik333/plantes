// scripts/deploy.sh : silencieux quand rien ne change, bavard sur un changement ou une erreur, journal plafonné.
// Vrai dépôt git (avec un dépôt distant local) et faux `docker` : on ne touche à rien de réel.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";

const SCRIPT = resolve(import.meta.dirname, "../../scripts/deploy.sh");

describe("scripts/deploy.sh", () => {
  let root: string;
  let clone: string;
  let home: string;
  let bin: string;
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "pipe" }).toString();

  before(() => {
    root = mkdtempSync(join(tmpdir(), "plantes-deploy-"));
    const bare = join(root, "remote.git");
    clone = join(root, "clone");
    home = join(root, "home");
    bin = join(root, "bin");
    for (const d of [home, bin]) mkdirSync(d);
    git(root, "init", "--bare", "-b", "main", bare);
    git(root, "clone", bare, clone);
    mkdirSync(join(clone, "scripts"));
    copyFileSync(SCRIPT, join(clone, "scripts/deploy.sh"));
    git(clone, "add", "-A");
    git(clone, "commit", "-m", "init");
    git(clone, "push", "origin", "HEAD:main");
    git(clone, "branch", "--set-upstream-to=origin/main");
    // Faux docker : `compose up` affiche FAKE_UP et sort avec FAKE_UP_CODE ; le reste réussit sans rien dire.
    writeFileSync(join(bin, "docker"), `#!/bin/sh\nif [ "$2" = "up" ]; then printf '%s\\n' "$FAKE_UP"; exit \${FAKE_UP_CODE:-0}; fi\nexit 0\n`);
    chmodSync(join(bin, "docker"), 0o755);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  const run = (up: string, code = 0) =>
    spawnSync("sh", [join(clone, "scripts/deploy.sh")], {
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, FAKE_UP: up, FAKE_UP_CODE: String(code) },
      encoding: "utf8",
    });

  it("rien ne change : aucune sortie (le journal ne grossit pas)", () => {
    const r = run(" Container plantes-app-1 Running \n Container plantes-caddy-1 Running ");
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "");
    assert.equal(r.stderr.trim(), "");
  });

  it("un conteneur est recréé : le changement est journalisé, avec les versions", () => {
    const r = run(" Container plantes-app-1 Recreate \n Container plantes-app-1 Started ");
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} déploiement [0-9a-f]{7} → [0-9a-f]{7}/);
    assert.match(r.stdout, /Recreate/);
  });

  it("le code a changé sur le dépôt distant : il est récupéré et le déploiement le dit", () => {
    const other = join(root, "autre");
    git(root, "clone", join(root, "remote.git"), other);
    writeFileSync(join(other, "nouveau.txt"), "x");
    git(other, "add", "-A");
    git(other, "commit", "-m", "changement");
    git(other, "push", "origin", "HEAD:main");
    const r = run(" Container plantes-app-1 Recreate ");
    assert.equal(r.status, 0);
    const [from, to] = [...r.stdout.matchAll(/déploiement ([0-9a-f]{7}) → ([0-9a-f]{7})/g)][0].slice(1);
    assert.notEqual(from, to, "le code a bien avancé");
    assert.equal(git(clone, "rev-parse", "--short", "HEAD").trim(), to);
  });

  it("échec de docker compose : code de sortie non nul et message d'erreur", () => {
    const r = run("pull access denied", 1);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /ÉCHEC du déploiement/);
    assert.match(r.stdout, /pull access denied/);
  });

  it("le journal de plus de 1 Mo est ramené à quelques lignes, sur place", () => {
    const log = join(home, "plantes-deploy.log");
    writeFileSync(log, ("une ligne de journal assez longue pour faire du volume\n").repeat(30_000));
    assert.ok(statSync(log).size > 1_048_576);
    run(" Container plantes-app-1 Running ");
    assert.ok(statSync(log).size < 100_000, `journal réduit (${statSync(log).size} octets)`);
  });
});
