// Vérifie que l'IA répond : génère la fiche de « Pothos » (sans photo) avec le fournisseur configuré.
// Usage : pnpm --filter @plantes/api ai:ping   (codes de sortie : 0 ok, 2 jeton invalide, 3 autre échec, 4 compte)
import { createAiProvider, AiProviderError } from "./ai/index.js";

const ai = createAiProvider();
try {
  const { durationMs } = await ai.generateCareSheet({ plantName: "Pothos" });
  console.log(`✓ La génération fonctionne (${(durationMs / 1000).toFixed(1)} s)`);
} catch (err) {
  if (err instanceof AiProviderError && err.code === "auth") {
    console.error("✗ Jeton Claude invalide ou expiré");
    process.exit(2);
  }
  if (err instanceof AiProviderError && err.code === "account") {
    console.error("✗ Compte Claude suspendu ou souci de facturation");
    process.exit(4);
  }
  // Seul le message (déjà lisible, sans secret) est affiché, jamais les détails ni l'environnement.
  console.error(`✗ ${err instanceof AiProviderError ? err.message : "Échec inattendu de la génération"}`);
  process.exit(3);
}
