// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
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

  integrations: [
    react(),
    // Public pages only: /dev/* is preview-only and /api/* is on-demand, neither is a page.
    sitemap({
      filter: (page) => !/\/(dev|api)(\/|$)/.test(new URL(page).pathname),
    }),
  ],
});
