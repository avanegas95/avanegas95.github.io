# P5-01: Port audit (v3 → v1)
Role: architect · Model: opus · Depends on: P5-00 · Status: done (2026-10-23, read-only)

Source: private `portfolio-v3@main` (read-only). Target: `feat/blob` (v1 `main` 9197cce + agent docs). Nothing below is copied from v3's `docs/review`, `docs/research` or `evals/results`; those stay private.

## Module map
| v3 path | v1 location | Task | Notes |
|---|---|---|---|
| `astro.config.mjs` (vercel adapter, `assetsInlineLimit: 0`, `inlineStylesheets: "never"`) | merge into v1 `astro.config.mjs` (keep `react()`, aliases, `site`) | P5-02 | v1 uses `inlineStylesheets: "auto"`; see CSP conflict |
| `vercel.json` (resume 302, BotID rewrites, headers) | `vercel.json` (new) | P5-02 | CSP must be widened for v1 (below) |
| `package.json` deps/scripts, `.nvmrc` 24 | v1 `package.json`, `.nvmrc` | P5-02 | one owner for every phase dependency |
| `src/lib/{moods,prompt,kb,pii,chat-events}.ts` | same paths | P5-03a | v1 `src/lib/` already has `types.ts`, `utils.ts`, `fade-in.ts`, `blog-tags.ts`: no name clash |
| `src/content/knowledge/**` + `knowledge`/`projects` collections | same; add to v1 `src/content.config.ts` beside `blog` | P5-03a | KB copy is public-safe (it is the published KB) |
| `scripts/{pii-guard,kb-count-tokens}.ts` | same | P5-03a | run as `node x.ts` (type stripping) → needs Node 24 |
| `src/lib/server/*`, `src/pages/api/{chat,health}.ts` | same | P5-03b | + N-2 `waitUntil` |
| `src/components/blob/*`, `src/scripts/blob/*`, `src/scripts/botid-init.ts`, `src/styles/blob*.css`, `src/pages/dev/[page].astro`, `src/lib/dev-pages.ts` | same | P5-04a/b | restyle to v1 tokens; panel → speech bubble |
| `src/components/sections/*`, `BaseLayout`, `ThemeToggle`, `public/theme-init.js`, v3 `global.css` | **not ported** | n/a | v1 keeps its own sections, layout and dark-only theme |
| `src/pages/quality.astro`, `src/lib/quality.ts`, `src/data/quality/evals.json`, `tests/**/quality*` | **dropped** (G5) | n/a | |
| `src/pages/{orbithop,privacy}` | v1 already has them | P5-05 guards | legacy contract |
| `vitest.config.ts`, `playwright.config.ts`, `lighthouserc.json` | same | P5-02 (configs) / P5-05 (gates) | drop `/quality/` URL |
| `scripts/check-client-bundle.ts` | same, **re-scoped** | P5-05 | see conflict 4 |
| `.github/workflows/quality.yml` | new `.github/workflows/quality.yml` (PR + `feat/blob` pushes only) | P5-05 | never touch `deploy.yml` |
| `evals/**` (minus results, report publishing) | `evals/` | P5-06 | `evals/results/` already gitignored |
| `tests/unit/*`, `tests/e2e/*`, `tests/fixtures/*` | split by owning task | each task | drop quality, theme-toggle, home-content/home-layout (v3 sections) |

## Conflicts and decisions
1. **Node**: v1 `.nvmrc` 22, `engines >=22.12`; v3 and Vercel use 24, and v3 scripts rely on native `.ts` execution. → P5-02 moves to 24. `deploy.yml` reads `.nvmrc`, but it only runs on `main`, so live Pages is unaffected until P6.
2. **Toolchain versions**: v1 TS 5.9 / ESLint 9 / no Prettier in lint; v3 TS 6.0 / ESLint 10 / `prettier --check` in lint. → Keep v1's ESLint 9 + TS 5.9 for now (no repo-wide reformat); add `typecheck` and `test` scripts; ported files must pass v1's config. Prettier check is scoped to ported paths only.
3. **CSP vs v1 page**: v3's `script-src 'self'; style-src 'self'` breaks v1: `is:inline` scripts in `Layout.astro` (fade-in flag, speculation rules), 36 inline `style=` attributes (mostly animation delays), `inlineStylesheets: "auto"`, and the Formspree contact form (`connect-src`/`form-action` to `formspree.io`). → P5-02 ships a v1-compatible CSP (hashes for the two inline scripts, `style-src 'self' 'unsafe-inline'`, Formspree allowed), and a test pins it.
4. **Bundle budget**: v3's checker measures the whole homepage JS graph; v1's React islands (`DotPattern`, `SectionEyebrow`, shiny text) exceed 25 KB on their own. → P5-05 re-scopes the budget to the Blob island entry graph; React chunks are excluded from the 25 KB budget but still scanned for forbidden strings.
5. **Accent**: v1 is dark-only with teal `--sec #64ffda` on navy `#0a192f`; Blob's approved accent is blue (`#60a5fa` dark). SCOPE §9 "one accent" can't hold as-is. → P5-04a puts Blob behind one `--blob` token (default blue); open question for Anderson.
6. **Theme**: v1 has no light theme or toggle; SCOPE §9 asks for both. → Out of P5; Blob ships its dark values only.
7. **Section anchors**: the scrubber allowlist (decision 2026-10-13) has `#about #experience #projects #skills #contact`; v1 has `#home #experiences #projects #contact` (+ `/blog/`). → P5-03b swaps in v1's anchors and the prompt's link list follows; orchestrator records a decision-log row.
8. **Content collections**: v1 `content.config.ts` exports `{ blog }`; add `knowledge` and `projects` (v3 names) without touching `blog`. v1's `src/data/projects.ts` is unrelated and stays.
9. **KB vs v1 content** (→ P5-07, new DISCREPANCIES rows, never resolved by agents): hero says "Senior SQA Engineer with 7 years" (D-03, D-07); "TestRails" (D-09); Jenkins/Buildkite (D-11); location "Boston, MA" (D-05); **v1 has a working Formspree contact form** (bears on D-13); `site.md` describes a single-page site with light/dark themes (v1 has a blog and is dark-only); unmerged `feature/projects-section` adds Paychira, AI Digest, State of Ecosystems, Orbit Hop, avanegas.com cards (D-12).
10. **`/privacy` is Orbit Hop's policy** (legacy contract), so Blob's privacy note needs its own path → `/blob-privacy/` (P5-08), added to the scrubber allowlist (P5-03b).
11. **Resume PDF**: v1 still ships `public/Anderson_Vanegas_Resume.pdf`; Vercel redirects run before the filesystem, but the local `serve` used by E2E and Lighthouse would still serve it. → P5-02 deletes the file on `feat/blob` (rule 7); live `main` is Anderson's call (PLAN open risk).
12. **Upstash key prefix** `pv3:` stays (decision 2026-10-13); no migration.
