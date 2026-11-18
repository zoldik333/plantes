// CLAUDE_TOKEN_CREATED invalide (alerte unique dans les journaux) et absence de fuite du jeton dans les erreurs.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it, mock } from "node:test";

const DIR = mkdtempSync(join(tmpdir(), "plantes-unit-hard-"));
process.env.DATA_DIR = DIR;
after(() => rmSync(DIR, { recursive: true, force: true }));

const { tokenInfo } = await import("../../apps/api/src/ai-status.js");
const { failureError } = await import("../../apps/api/src/ai/claude-agent-sdk.js");

describe("CLAUDE_TOKEN_CREATED invalide", () => {
  it("avertit une seule fois, sans afficher plus de 12 caractères", () => {
    const warn = mock.method(console, "warn", () => {});
    process.env.CLAUDE_TOKEN_CREATED = "sk-ant-oat01-" + "a".repeat(40);
    assert.equal(tokenInfo(new Date("2026-11-18T10:00:00Z")), null);
    assert.equal(tokenInfo(new Date("2026-11-18T10:00:00Z")), null);
    process.env.CLAUDE_TOKEN_CREATED = "2099-01-01";
    assert.equal(tokenInfo(new Date("2026-11-18T10:00:00Z")), null);
    assert.equal(warn.mock.callCount(), 1);
    const msg = String(warn.mock.calls[0].arguments[0]);
    assert.match(msg, /CLAUDE_TOKEN_CREATED/);
    assert.ok(msg.includes("sk-ant-oat01…"));
    assert.ok(!msg.includes("aaaa"));
    warn.mock.restore();
  });
});

describe("pas de fuite du jeton", () => {
  it("ni dans message, ni dans details, ni dans les journaux", () => {
    const token = "sk-ant-oat01-" + "x".repeat(40);
    const logs: string[] = [];
    const spies = (["error", "log", "warn"] as const).map((k) => mock.method(console, k, (...a: unknown[]) => void logs.push(a.map(String).join(" "))));
    const err = failureError(
      { assistantErrors: ["authentication_failed"], texts: [`Invalid token ${token}`], exceptionMessage: `boom ${token}`, failure: "is_error" },
      false,
    );
    console.error(err.message, err.details);
    const all = [err.message, JSON.stringify(err.details), ...logs].join("\n");
    assert.ok(!all.includes("x".repeat(20)), all);
    assert.ok(all.includes("sk-ant-…"));
    assert.equal(err.code, "auth");
    for (const s of spies) s.mock.restore();
  });
});
