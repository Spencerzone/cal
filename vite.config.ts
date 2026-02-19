import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const BASE = "/cal/"; // set to "/<repo>/" for GitHub Pages project sites

export default defineConfig({
  base: BASE,
  build: {
    sourcemap: true,
    minify: false,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "DayBook",
        short_name: "DayBook",
        start_url: BASE,
        scope: BASE,
        display: "standalone",
        background_color: "#0b0b0b",
        theme_color: "#0b0b0b",
        icons: [
          { src: `${BASE}pwa-192.png`, sizes: "192x192", type: "image/png" },
          { src: `${BASE}pwa-512.png`, sizes: "512x512", type: "image/png" }
        ]
      }
    })
  ]
});
