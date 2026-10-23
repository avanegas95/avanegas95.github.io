# CLAUDE.md

Guidance for Claude Code in this repo. **`docs/SCOPE.md` is the source of truth** for product and architecture. It was carried over from portfolio-v3, so read "v3" as "this site with Blob". Read only the sections your task cites. `docs/PLAN.md` holds build status.

## Architecture in one paragraph
This is avanegas.com, the portfolio of Anderson Vanegas (Staff SQA Engineer). It's an Astro 7 site with Tailwind 4, TypeScript and React islands for its own sections. It currently deploys to GitHub Pages from `main`, and is moving to Vercel via `@astrojs/vercel` (PLAN P5/P6). Blob, the AI agent built and tested in the private repo portfolio-v3, is being ported in on branch `feat/blob`:
- **Blob** is a framework-free `<blob-agent>` custom element with square eyes and emoji moods. Its replies appear in a speech bubble (SCOPE §4.3).
- **The chat endpoint** is the single on-demand route, `src/pages/api/chat.ts`. It streams answers from the Anthropic API over SSE using the official `@anthropic-ai/sdk`; the launch model is Claude Haiku 5.5 at low effort.
- **Blob's knowledge** comes only from a curated knowledge base in `src/content/knowledge/`.
- **Upstash Redis** backs rate limits and the daily spend kill switch.

## Non-negotiable rules
1. **The knowledge base is the only source of facts for Blob.** Blob's prompt is built only from `src/content/knowledge/*.md`. Never feed the resume PDF, the site's `src/data/*.ts` or anything else into the prompt directly. When a KB fact and the site's own content disagree, add a row to `docs/DISCREPANCIES.md`.
2. **No PII beyond email, LinkedIn and GitHub.** No phone number or street address anywhere: not in the KB, prompts, fixtures, logs or public files. The PII/placeholder guard must pass, so never weaken it to make a build green.
3. **Secrets stay server-side.** `ANTHROPIC_API_KEY`, `KV_REST_API_URL`/`KV_REST_API_TOKEN` (Upstash via the Vercel integration) and `IP_HASH_SALT` come from env vars only. Never import server modules into client code, and never log secrets or request bodies. `vercel env pull` returns Sensitive vars as placeholders, so never rely on it for real keys.
4. **Every SCOPE §6 control stays on**: input limits, BotID, rate limits, spend kill switch, output scrubbing and the stream stall guard. Tests may disable a control only through an explicit test-only flag. Never use an env default for that.
5. **The real Anthropic API is never called in unit/E2E tests or CI on PRs.** Mock the SDK. Only `evals/` hits the real API, opt-in via `--spend` plus `EVAL_ALLOW_SPEND=1`, behind the $1 budget guard, and Anderson runs it. Eval results stay local: there is no public quality page, published report or committed `evals.json` (G5 was dropped).
6. **Claude API usage** follows SCOPE §5.3:
   - The model and effort come from env (`CHAT_MODEL`, `CHAT_EFFORT`).
   - Stream with the SDK.
   - Keep the system+KB prefix byte-stable for prompt caching (no timestamps or IDs in it).
   - No `budget_tokens`, no `thinking: disabled`, no assistant prefill, no forced `tool_choice`.
   - Check `stop_reason` (including `refusal`) before using content, and use the SDK's typed error classes.
7. **Legacy URLs are a contract** (SCOPE §2 G6):
   - `/orbithop`, `/privacy` and `/app-ads.txt` must keep returning 200, because the App Store and AdMob depend on them.
   - `/Anderson_Vanegas_Resume.pdf` must never 404 and must never serve the old PII-bearing PDF. On `feat/blob` it 302s to LinkedIn until a clean PDF exists.
   - E2E tests guard all of this.
8. **Performance and a11y budgets are gates**: Lighthouse ≥ 0.95 in all categories, axe clean, Blob island ≤ 25 KB gzip, and `prefers-reduced-motion` respected. Blob itself uses no UI framework; the site's existing React islands may stay.
9. **The mood enum is shared**: `src/lib/moods.ts` is imported by both server and client. Change it in one place and update its tests.
10. **This repo is public until the Vercel cutover.**
    - Never commit security findings, red-team notes, eval transcripts, infra or project IDs, or env values.
    - That material, and the resume source `docs/research/resume-v5.md`, live in the private sibling repo `/Users/anderson/Github Projects/portfolio-v3`. Read them there; never copy them here.
    - Never read anything under any `private/` folder.
11. **Fact conflicts go to `docs/DISCREPANCIES.md`.** Apply each row's interim rule, add new rows for new conflicts, and never resolve one yourself.
12. **Don't break the live site.** `main` deploys avanegas.com through GitHub Pages until P6.
    - Blob work lands on `feat/blob`, which Vercel builds as Previews.
    - Nothing touches DNS, `CNAME`, the Pages workflow or Vercel domains without Anderson's explicit approval.

## Multi-agent workflow
- Build status and the current phase live in `docs/PLAN.md`. **Only the orchestrator (main session) edits it.**
- Each task has a brief at `docs/tasks/<phase>/<task-id>.md` (template: `docs/tasks/README.md`). Implementers read `CLAUDE.md`, their brief and the cited SCOPE sections, and nothing else unless blocked.
- Role definitions live in `.claude/agents/`.
  - Task branches are named `task/<ID>-<slug>` and are cut from **`feat/blob`**.
  - Only the orchestrator merges, into `feat/blob`, after an independent review and a green suite.
- To kick off or resume, run `/orchestrate-build`.
- The porting source is the private `portfolio-v3` repo (read-only): the code under `src/`, `evals/`, `tests/` and `scripts/` there is reviewed and passing (2328 unit tests; P4 eval gate passed).

## Conventions
- TypeScript strict, with zod at every boundary (API input, content frontmatter, SSE payloads).
- Tests use Vitest for unit tests and Playwright Test for E2E (chromium, firefox, webkit), with `/api/chat` intercepted by fixtures. axe runs through `@axe-core/playwright`. The package manager is npm.
- Copy is friendly, concise, recruiter-readable and lightly punny. Blob speaks about Anderson in the third person.
