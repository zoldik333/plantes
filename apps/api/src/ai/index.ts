import { ClaudeAgentSdkProvider } from "./claude-agent-sdk.js";
import { FakeProvider } from "./fake.js";
import type { AiProvider } from "./provider.js";

export * from "./provider.js";
export * from "@plantes/shared";

/** Choix du fournisseur par variable d'environnement : AI_PROVIDER=claude-agent-sdk (défaut). */
export function createAiProvider(): AiProvider {
  const provider = process.env.AI_PROVIDER ?? "claude-agent-sdk";
  switch (provider) {
    case "claude-agent-sdk":
      return new ClaudeAgentSdkProvider({
        model: process.env.AI_MODEL ?? "sonnet",
        workDir: process.env.AI_WORKDIR ?? "/tmp/plantes-ai",
        debug: process.env.AI_DEBUG === "1",
        timeoutMs: Number(process.env.AI_TIMEOUT_MS) || undefined,
      });
    case "fake": // tests uniquement : aucune requête à l'IA
      return new FakeProvider(Number(process.env.AI_FAKE_DELAY_MS) || 0);
    default:
      throw new Error(`Fournisseur IA inconnu : ${provider}`);
  }
}
