import eslintPluginAstro from "eslint-plugin-astro";
import tseslint from "typescript-eslint";
import globals from "globals";

export default [
  ...tseslint.configs.recommended,
  ...eslintPluginAstro.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    ignores: [
      "dist/",
      ".astro/",
      ".vercel/",
      ".agents/",
      "node_modules/",
      // eslint-plugin-astro parses the speculationrules JSON as JS; astro check still covers it.
      "src/layouts/Layout.astro",
    ],
  },
  {
    files: ["src/env.d.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
];
