import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import webpush from "web-push";

const API_DIR = resolve(import.meta.dirname, "../../apps/api");
const vapid = webpush.generateVAPIDKeys();

/** Clé d'installation des serveurs de test (POC_ACCESS_KEY). */
export const KEY = "cle-installation-de-test-1234";

export interface ServerOptions {
  /** Délai de l'IA factice (ms). */
  aiDelayMs?: number;
  /** Heures de rappel ; vide (défaut) = scheduler désactivé, les tests appellent runReminders eux-mêmes. */
  reminderHours?: string;
  env?: Record<string, string>;
  /** Réutiliser un dossier de données existant (redémarrage). */
  dataDir?: string;
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolvePort(port));
    });
  });
}

/** Serveur de l'API lancé pour un test : port libre, base temporaire, IA factice, notifications écrites dans un fichier. */
export class TestServer {
  private proc!: ChildProcess;
  private output = "";
  private constructor(
    readonly url: string,
    readonly port: number,
    readonly dataDir: string,
    readonly dryRunFile: string,
    private readonly opts: ServerOptions,
  ) {}

  static async start(opts: ServerOptions = {}): Promise<TestServer> {
    const port = await freePort();
    const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), "plantes-test-"));
    const dryRunFile = join(dataDir, "..", `push-${port}.jsonl`);
    writeFileSync(dryRunFile, "");
    const s = new TestServer(`http://localhost:${port}`, port, dataDir, dryRunFile, opts);
    await s.spawnProcess();
    return s;
  }

  private async spawnProcess(): Promise<void> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(this.port),
      DATA_DIR: this.dataDir,
      APP_URL: this.url,
      BETTER_AUTH_SECRET: "secret-de-test-".padEnd(40, "x"),
      POC_ACCESS_KEY: KEY,
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      AI_PROVIDER: "fake",
      AI_FAKE_DELAY_MS: String(this.opts.aiDelayMs ?? 0),
      REMINDER_HOURS: this.opts.reminderHours ?? "",
      PUSH_DRY_RUN_FILE: this.dryRunFile,
      WEB_DIR: resolve(API_DIR, "../web/dist"),
      ...this.opts.env,
    };
    delete env.CLAUDE_CODE_OAUTH_TOKEN; // un test ne doit jamais consommer l'abonnement
    delete env.ANTHROPIC_API_KEY;
    this.output = "";
    // Node directement (pas le lanceur `tsx`, qui crée un processus fils) : un kill -9 tue bien le serveur.
    this.proc = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: API_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
    this.proc.stdout!.on("data", (d) => (this.output += d));
    this.proc.stderr!.on("data", (d) => (this.output += d));
    for (let i = 0; i < 120; i++) {
      if (this.proc.exitCode !== null) throw new Error(`Le serveur s'est arrêté au démarrage :\n${this.output}`);
      try {
        if ((await fetch(`${this.url}/health`)).ok) return;
      } catch {
        /* pas encore prêt */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Le serveur n'a pas démarré en 30 s :\n${this.output}`);
  }

  /** Sortie standard et d'erreur du serveur depuis son dernier démarrage. */
  get logs(): string {
    return this.output;
  }

  async stop(): Promise<void> {
    if (this.proc.exitCode !== null) return;
    this.proc.kill("SIGTERM");
    await new Promise((r) => this.proc.once("exit", r));
  }

  /** Arrêt brutal (kill -9) : simule une coupure de courant. */
  async kill(): Promise<void> {
    if (this.proc.exitCode !== null) return;
    this.proc.kill("SIGKILL");
    await new Promise((r) => this.proc.once("exit", r));
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.spawnProcess();
  }

  /** Relance un serveur arrêté (même dossier de données), avec d'éventuelles variables d'environnement modifiées. */
  async startAgain(env: Record<string, string> = {}): Promise<void> {
    Object.assign(this.opts.env ??= {}, env);
    await this.spawnProcess();
  }

  /** Accès direct à la base (pour préparer ou vérifier un état). */
  db<T>(fn: (db: Database.Database) => T): T {
    const db = new Database(join(this.dataDir, "plantes.db"));
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  /** Notifications « envoyées » (mode simulation). */
  pushes(): { endpoint: string; userId: string; payload: { title: string; body: string; url: string } }[] {
    return readFileSync(this.dryRunFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }

  clearPushes(): void {
    writeFileSync(this.dryRunFile, "");
  }

  async cleanup(): Promise<void> {
    await this.stop();
    rmSync(this.dataDir, { recursive: true, force: true });
    if (existsSync(this.dryRunFile)) rmSync(this.dryRunFile);
  }
}
