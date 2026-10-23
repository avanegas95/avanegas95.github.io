// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

import react from "@astrojs/react";
import vercel from "@astrojs/vercel";

// https://astro.build/config
export default defineConfig({
  site: "https://avanegas.com",
  base: "/",
  output: "static",
  adapter: vercel(),

  build: {
    inlineStylesheets: "auto",
  },

  vite: {
    plugins: [tailwindcss()],
    // CSP is script-src 'self': never inline bundled scripts (or small assets) into HTML.
    build: { assetsInlineLimit: 0 },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-dev-runtime",
        "clsx",
        "tailwind-merge",
      ],
    },
    resolve: {
      alias: {
        "@": "/src",
        "@components": "/src/components",
      },
    },
  },

  server: {
    host: true,
    port: 4321,
  },

  integrations: [react()],
});