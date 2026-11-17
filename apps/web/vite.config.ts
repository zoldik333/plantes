import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // `pnpm dev` : l'API tourne sur :3000, le front sur :5173.
    proxy: { "/api": "http://localhost:3000" },
  },
});
