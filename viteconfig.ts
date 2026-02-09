import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// IMPORTANT for GitHub Pages:
// set base to "/<repo-name>/" (keep "/" if deploying to a custom domain root)
const BASE = "/cal/";

export default defineConfig({
  base: BASE,
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
          { src: `${BASE}pwa-512.png`, sizes: "512x512", type: "image/png" },
          {
            src: `${BASE}pwa-512.png`,
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        navigateFallback: `${BASE}index.html`,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "document",
            handler: "NetworkFirst",
            options: { cacheName: "pages" }
          }
        ]
      }
    })
  ]
});