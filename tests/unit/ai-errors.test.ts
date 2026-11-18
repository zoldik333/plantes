// Classification des échecs de l'IA et lecture du flux du SDK : fonctions pures, aucun réseau.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyAiFailure, messageFor, type AiErrorCode } from "../../apps/api/src/ai/errors.js";
import { consumeStream } from "../../apps/api/src/ai/claude-agent-sdk.js";
import { AiProviderError } from "../../apps/api/src/ai/provider.js";

const E401 = "Failed to authenticate. API Error: 401 OAuth access token is invalid.";
const sig = (assistantErrors: string[] = [], texts: string[] = [], extra: { exceptionMessage?: string; timedOut?: boolean } = {}) => ({ assistantErrors, texts, ...extra });

describe("classifyAiFailure", () => {
  const cases: [string, ReturnType<typeof sig>, AiErrorCode][] = [
    ["séquence mesurée avec un jeton invalide", sig(["authentication_failed", "authentication_failed", "authentication_failed"], [E401, E401], { exceptionMessage: `Claude Code returned an error result: ${E401}` }), "auth"],
    ["champ error seul", sig(["authentication_failed"]), "auth"],
    ["OAuth token revoked", sig([], ["OAuth token revoked · Please run /login"]), "auth"],
    ["token has expired", sig([], ["API Error: 401 OAuth token has expired"]), "auth"],
    ["Login expired", sig([], ["Login expired · Please run /login"]), "auth"],
    ["Invalid authentication credentials", sig([], ["Invalid authentication credentials"]), "auth"],
    ["Not logged in", sig([], ["Not logged in · Please run /login"]), "auth"],
    ["signal d'auth dans l'exception seulement", sig([], [], { exceptionMessage: "Claude Code returned an error result: Not logged in" }), "auth"],
    ["compte suspendu", sig(["account_on_hold"]), "account"],
    ["facturation", sig(["billing_error"]), "account"],
    ["organisation non autorisée", sig(["oauth_org_not_allowed"]), "account"],
    ["limite de session : PAS auth", sig([], ["You've hit your session limit · resets 5pm"]), "usage_limit"],
    ["limite de session avec rate_limit", sig(["rate_limit"], ["You've hit your session limit · resets 5pm"]), "usage_limit"],
    ["usage limit", sig([], ["You've reached your usage limit"]), "usage_limit"],
    ["surcharge (champ)", sig(["overloaded"]), "overloaded"],
    ["erreur serveur (champ)", sig(["server_error"]), "overloaded"],
    ["surcharge (texte)", sig([], ["Server is temporarily limiting requests (not your usage limit)"]), "overloaded"],
    ["délai dépassé", sig([], [], { timedOut: true }), "timeout"],
    ["erreur générique sans signal d'auth", sig([], [], { exceptionMessage: "Claude Code process exited with code 1" }), "other"],
    ["aucun signal", sig(), "other"],
    ["erreur inconnue", sig(["unknown", "invalid_request"], ["Something went wrong"]), "other"],
    // Priorités : auth > account > usage_limit > overloaded > timeout
    ["auth l'emporte sur compte", sig(["account_on_hold", "authentication_failed"]), "auth"],
    ["compte l'emporte sur limite", sig(["rate_limit", "billing_error"]), "account"],
    ["limite l'emporte sur surcharge", sig(["overloaded"], ["session limit"]), "usage_limit"],
    ["surcharge l'emporte sur délai", sig(["overloaded"], [], { timedOut: true }), "overloaded"],
    ["auth l'emporte sur délai", sig(["authentication_failed"], [], { timedOut: true }), "auth"],
  ];
  for (const [name, input, expected] of cases) it(name, () => assert.equal(classifyAiFailure(input), expected));

  it("messages utilisateur en français", () => {
    assert.equal(messageFor("auth"), "Le jeton Claude n'est plus valide : il doit être renouvelé sur le serveur.");
    assert.equal(messageFor("account"), "Le compte Claude est suspendu ou a un souci de facturation.");
    assert.equal(messageFor("usage_limit"), "La limite d'usage de l'abonnement Claude est atteinte : réessaie plus tard.");
    assert.equal(messageFor("overloaded"), "Claude est surchargé : réessaie dans quelques minutes.");
    assert.equal(messageFor("timeout"), "Délai dépassé : l'IA n'a pas répondu à temps");
    assert.equal(messageFor("other"), "Échec de la génération : réessaie dans un moment.");
  });

  it("AiProviderError : code « other » par défaut", () => {
    assert.equal(new AiProviderError("x").code, "other");
    assert.equal(new AiProviderError("x", undefined, "auth").code, "auth");
  });
});

type SDKMessage = Parameters<typeof consumeStream>[0] extends AsyncIterable<infer M> ? M : never;

describe("consumeStream (flux du SDK)", () => {
  async function* stream(msgs: unknown[], thenThrow?: string): AsyncGenerator<SDKMessage> {
    for (const m of msgs) yield m as SDKMessage;
    if (thenThrow) throw new Error(thenThrow);
  }
  const assistantText = (text: string, error?: string) => ({ type: "assistant", error, message: { content: [{ type: "text", text }] } });

  it("séquence mesurée avec un jeton invalide : échec classé « auth », arrêt dès le premier api_retry", async () => {
    let aborts = 0;
    const out = await consumeStream(
      stream(
        [
          { type: "system", subtype: "init" },
          { type: "system", subtype: "api_retry", error: "authentication_failed" },
          { type: "system", subtype: "api_retry", error: "authentication_failed" },
          assistantText(E401, "authentication_failed"),
          { type: "result", subtype: "success", is_error: true, result: E401 },
        ],
        `Claude Code returned an error result: ${E401}`,
      ),
      () => aborts++,
    );
    assert.ok(out.failure, "un résultat is_error:true est un ÉCHEC, même avec subtype « success »");
    assert.equal(out.structured, undefined);
    assert.ok(out.exceptionMessage?.includes("401"));
    assert.equal(aborts, 2, "onAuthRetry appelée à chaque api_retry d'authentification");
    assert.equal(classifyAiFailure({ ...out }), "auth");
  });

  it("is_error:true sans exception ni autre signal : échec", async () => {
    const out = await consumeStream(stream([{ type: "result", subtype: "success", is_error: true, result: "boom" }]), () => {});
    assert.equal(out.failure, "is_error");
    assert.equal(out.structured, undefined);
  });

  it("succès normal : sortie structurée, aucun échec", async () => {
    const out = await consumeStream(stream([{ type: "result", subtype: "success", is_error: false, result: "{}", structured_output: { a: 1 } }]), () => {});
    assert.equal(out.failure, undefined);
    assert.deepEqual(out.structured, { a: 1 });
  });

  it("résultat d'un autre sous-type : échec", async () => {
    const out = await consumeStream(stream([{ type: "result", subtype: "error_max_turns" }]), () => {});
    assert.equal(out.failure, "error_max_turns");
  });

  it("limite d'abonnement : usage_limit, jamais auth", async () => {
    const out = await consumeStream(
      stream([assistantText("You've hit your session limit · resets 5pm", "rate_limit"), { type: "result", subtype: "success", is_error: true, result: "You've hit your session limit · resets 5pm" }], "Claude Code returned an error result: You've hit your session limit"),
      () => assert.fail("pas d'arrêt pour une limite d'usage"),
    );
    assert.equal(classifyAiFailure({ ...out }), "usage_limit");
  });
});
