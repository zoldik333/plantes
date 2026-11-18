import { mkdirSync } from "node:fs";
import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { classifyAiFailure, messageFor, redactSecrets } from "./errors.js";
import { AiProviderError, type AiProvider, type CareSheetResult, type Photo } from "./provider.js";
import { CARE_SHEET_SYSTEM_PROMPT, buildCareSheetPrompt } from "./prompts.js";
import { CareSheet, careSheetJsonSchema } from "@plantes/shared";

interface Options {
  /** Alias ("sonnet", "opus", "haiku") ou nom complet du modèle. */
  model: string;
  /** Dossier vide servant de répertoire de travail à Claude Code (aucun fichier n'y est lu). */
  workDir: string;
  debug?: boolean;
  /** Durée maximale d'un appel (ms) : au-delà, le sous-processus est interrompu. */
  timeoutMs?: number;
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

    const abortController = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, this.opts.timeoutMs ?? 180_000);

    let outcome: StreamOutcome;
    try {
      outcome = await consumeStream(
        query({
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
            abortController,
            env,
            outputFormat: { type: "json_schema", schema: careSheetJsonSchema },
          },
        }),
        // Un jeton invalide ne se rétablira pas : inutile d'attendre les nouvelles tentatives.
        () => abortController.abort(),
        this.opts.debug,
      );
    } finally {
      clearTimeout(timer);
    }

    const { structured, resultText, failure, exceptionMessage } = outcome;
    if (failure || exceptionMessage !== undefined || abortController.signal.aborted) {
      throw failureError(outcome, timedOut);
    }
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

/** Erreur typée d'un échec ; les jetons éventuellement cités dans les textes sont masqués dans `details`. */
export function failureError(outcome: StreamOutcome, timedOut: boolean): AiProviderError {
  const { failure, exceptionMessage, assistantErrors, texts } = outcome;
  const code = classifyAiFailure({ assistantErrors, texts, exceptionMessage, timedOut });
  const details = {
    failure,
    assistantErrors: assistantErrors.map(redactSecrets),
    texts: texts.map(redactSecrets),
    exception: exceptionMessage === undefined ? undefined : redactSecrets(exceptionMessage),
  };
  return new AiProviderError(messageFor(code), details, code);
}

export interface StreamOutcome {
  structured?: unknown;
  resultText?: string;
  /** Sous-type du résultat en échec, ou « is_error » (sous-type « success » mais is_error true). */
  failure?: string;
  /** Message de l'exception levée par l'itérateur (le SDK en lève une après un résultat en erreur). */
  exceptionMessage?: string;
  /** Champs `error` des messages assistant et des `api_retry`. */
  assistantErrors: string[];
  /** Textes des messages assistant et du résultat. */
  texts: string[];
}

/**
 * Lit le flux du SDK et en tire le résultat ET les signaux d'échec. Ne lève jamais : l'exception de l'itérateur
 * est rapportée dans `exceptionMessage`. `onAuthRetry` est appelée dès le premier `api_retry` d'authentification.
 */
export async function consumeStream(messages: AsyncIterable<SDKMessage>, onAuthRetry: () => void, debug = false): Promise<StreamOutcome> {
  const out: StreamOutcome = { assistantErrors: [], texts: [] };
  try {
    for await (const m of messages) {
      if (debug && m.type === "system" && m.subtype === "init") {
        console.log(`[ai] init: model=${m.model} tools=${JSON.stringify(m.tools)} auth=${m.apiKeySource}`);
      }
      if (m.type === "system" && m.subtype === "api_retry") {
        const error = String(m.error ?? "");
        if (error) out.assistantErrors.push(error);
        if (error === "authentication_failed") onAuthRetry();
      }
      if (m.type === "assistant") {
        if (m.error) out.assistantErrors.push(String(m.error));
        for (const block of m.message.content) {
          if (block.type === "text") out.texts.push(block.text);
        }
      }
      if (m.type === "result") {
        if (m.subtype !== "success") {
          out.failure = m.subtype;
        } else {
          if (typeof m.result === "string") out.texts.push(m.result);
          // Attention : un échec d'authentification arrive avec subtype « success » mais is_error true.
          if (m.is_error === true) {
            out.failure = "is_error";
          } else {
            out.structured = m.structured_output;
            out.resultText = m.result;
            if (debug) console.log(`[ai] result: turns=${m.num_turns} duration=${m.duration_ms}ms`);
          }
        }
      }
    }
  } catch (err) {
    out.exceptionMessage = err instanceof Error ? err.message : String(err);
  }
  return out;
}
