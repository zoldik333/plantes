import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Service worker : src/sw.ts, publié sous /sw.js (même URL et même portée que l'ancien, les abonnements push y sont liés).
    // Pas de script d'enregistrement injecté en ligne (CSP) : l'enregistrement est dans src/lib/offline.ts.
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: false,
      manifest: false, // on garde public/manifest.webmanifest
      injectManifest: {
        rollupFormat: "iife",
        // Coque de l'app : pages, scripts, styles, icônes, UNE seule graisse de police (sous-ensemble latin) pour rester léger.
        globPatterns: ["index.html", "assets/*.{js,css}", "*.png", "manifest.webmanifest", "assets/*latin-wght-normal*.woff2"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
  build: {
    // Jamais de police en data: URI (la CSP n'autorise que font-src 'self') ; les autres petits fichiers restent inclus.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
  server: {
    // `pnpm dev` : l'API tourne sur :3000, le front sur :5173.
    proxy: { "/api": "http://localhost:3000" },
  },
});
