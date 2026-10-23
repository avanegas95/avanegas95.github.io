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
      ".claude/",
      // TODO(P5): eslint-plugin-astro parses the speculationrules JSON block in Layout.astro as JS
      // and a parse error cannot be disabled inline. Fix by emitting it via
      // <script is:inline type="speculationrules" set:html={JSON.stringify(rules)} />, then
      // drop this ignore so the root layout is linted again. astro check still covers it.
      "src/layouts/Layout.astro",
      "node_modules/",
    ],
  },
  {
    files: ["src/env.d.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
];
