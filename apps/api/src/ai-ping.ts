// Vérifie que l'IA répond : génère la fiche de « Pothos » (sans photo) avec le fournisseur configuré.
// Met aussi à jour l'état persistant de l'IA (retour à « ok » après un renouvellement réussi).
// Usage : pnpm --filter @plantes/api ai:ping   (codes de sortie : 0 ok, 2 jeton invalide, 3 autre échec, 4 compte)
import { createAiProvider } from "./ai/index.js";
import { pingOutcome } from "./ai-status.js";

const { code, message } = await pingOutcome(createAiProvider());
(code === 0 ? console.log : console.error)(message);
process.exit(code);
