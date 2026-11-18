import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Jamais de police en data: URI (la CSP n'autorise que font-src 'self') ; les autres petits fichiers restent inclus.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
  server: {
    // `pnpm dev` : l'API tourne sur :3000, le front sur :5173.
    proxy: { "/api": "http://localhost:3000" },
  },
});
