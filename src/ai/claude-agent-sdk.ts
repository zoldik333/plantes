import { mkdirSync } from "node:fs";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AiProviderError, type AiProvider, type CareSheetResult, type Photo } from "./provider.js";
import { CARE_SHEET_SYSTEM_PROMPT, buildCareSheetPrompt } from "./prompts.js";
import { CareSheet, careSheetJsonSchema } from "./schema.js";

interface Options {
  /** Alias ("sonnet", "opus", "haiku") ou nom complet du modèle. */
  model: string;
  /** Dossier vide servant de répertoire de travail à Claude Code (aucun fichier n'y est lu). */
  workDir: string;
  debug?: boolean;
}

/**
 * Fournisseur basé sur le Claude Agent SDK, authentifié par l'abonnement Claude
 * (variable CLAUDE_CODE_OAUTH_TOKEN, obtenue avec `claude setup-token`).
 * Aucun outil n'est donné à Claude : c'est un simple appel au modèle.
 */
export class ClaudeAgentSdkProvider implements AiProvider {
  readonly name = "claude-agent-sdk";

  constructor(private readonly opts: Options) {
    mkdirSync(opts.workDir, { recursive: true });
  }

  async generateCareSheet({
    plantName,
    photo,
  }: {
    plantName: string;
    photo?: Photo;
  }): Promise<CareSheetResult> {
    const started = Date.now();
    const raw = await this.run(photo, buildCareSheetPrompt(plantName, !!photo));
    const parsed = CareSheet.safeParse(raw);
    if (!parsed.success) {
      throw new AiProviderError("La fiche renvoyée ne respecte pas le schéma", parsed.error.issues);
    }
    return { sheet: parsed.data, provider: this.name, durationMs: Date.now() - started };
  }

  private async run(photo: Photo | undefined, text: string): Promise<unknown> {
    const message: SDKUserMessage = {
      type: "user",
      message: {
        role: "user",
        content: [
          ...(photo
            ? [
                {
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: photo.mediaType,
                    data: photo.data.toString("base64"),
                  },
                },
              ]
            : []),
          { type: "text", text },
        ],
      },
      parent_tool_use_id: null,
    };

    // Les images exigent le mode "streaming input" : prompt = générateur de messages.
    async function* input(): AsyncGenerator<SDKUserMessage> {
      yield message;
    }

    // On retire ANTHROPIC_API_KEY pour être sûr de consommer l'abonnement et non l'API payante.
    // (L'option env REMPLACE l'environnement du sous-processus, d'où le spread.)
    const { ANTHROPIC_API_KEY: _ignored, ...env } = process.env;

    let structured: unknown;
    let resultText: string | undefined;
    let failure: string | undefined;

    try {
      for await (const m of query({
        prompt: input(),
        options: {
          model: this.opts.model,
          systemPrompt: CARE_SHEET_SYSTEM_PROMPT,
          tools: [],
          allowedTools: ["StructuredOutput"],
          // Ne charge ni ~/.claude ni les serveurs MCP du poste : seul l'outil de sortie structurée est exposé.
          settingSources: [],
          maxTurns: 4,
          cwd: this.opts.workDir,
          env,
          outputFormat: { type: "json_schema", schema: careSheetJsonSchema },
        },
      })) {
        if (this.opts.debug && m.type === "system" && m.subtype === "init") {
          console.log(`[ai] init: model=${m.model} tools=${JSON.stringify(m.tools)} auth=${m.apiKeySource}`);
        }
        if (m.type === "result") {
          if (m.subtype === "success") {
            structured = m.structured_output;
            resultText = m.result;
            if (this.opts.debug) {
              console.log(`[ai] result: turns=${m.num_turns} duration=${m.duration_ms}ms`);
            }
          } else {
            failure = m.subtype;
          }
        }
      }
    } catch (err) {
      throw new AiProviderError(`Échec de l'appel Agent SDK${failure ? ` (${failure})` : ""}`, String(err));
    }

    if (failure) throw new AiProviderError(`L'agent s'est arrêté en erreur : ${failure}`);
    if (structured !== undefined && structured !== null) return structured;

    // Repli : certaines configurations renvoient le JSON dans le texte final.
    const json = resultText?.match(/\{[\s\S]*\}/)?.[0];
    if (json) {
      try {
        return JSON.parse(json);
      } catch {
        /* on tombe sur l'erreur ci-dessous */
      }
    }
    throw new AiProviderError("Aucune sortie structurée reçue", resultText);
  }
}
