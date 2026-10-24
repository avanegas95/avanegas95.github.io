# Blob ops runbook

How to operate Blob, the chat agent on avanegas.com. This file is public: it names environment variables but never holds values, IDs or dashboard links. Use your own dashboards and `<placeholders>` such as `<preview-url>`.

## 1. What runs where

| Piece                  | Where                              | Notes                                                                                                     |
| ---------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Site (static pages)    | Vercel (Previews from `feat/blob`) | GitHub Pages still serves production from `main` until P6.                                                |
| Chat endpoint          | Vercel function at `/api/chat`     | The only on-demand route. Order of checks: input, env, BotID, rate limits, daily budget, then the stream. |
| Model                  | Anthropic API                      | Chosen by `CHAT_MODEL` and `CHAT_EFFORT`.                                                                 |
| Rate limits and budget | Upstash Redis (Vercel integration) | Keys are `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Only hashed IPs are stored.                           |
| Bot protection         | Vercel BotID                       | Client challenge path is proxied by rewrites in `vercel.json`.                                            |
| Blob's knowledge       | `src/content/knowledge/*.md`       | The only source of facts in the prompt. Changing it needs a deploy.                                       |

Environment variables (names only): `ANTHROPIC_API_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `IP_HASH_SALT`, `CHAT_MODEL`, `CHAT_EFFORT`, `DAILY_BUDGET_USD`. Secrets are Sensitive in Vercel. `vercel env pull` returns placeholders for them, so never rely on it for real keys.

Vercel only applies an env change to **new** deployments. After any edit below, redeploy (or push a commit) and confirm on the new deployment.

## 2. Turn Blob off fast, and back on

**Off:** set `DAILY_BUDGET_USD=0` in the target environment, then redeploy.

What it does (from `src/lib/server/budget.ts` and `tests/unit/budget.test.ts`): a budget of 0 makes the budget check fail before any model call, so every request that gets past input, env, BotID and rate-limit checks receives HTTP 503 with error code `budget`. No Anthropic call is made, so nothing is spent. Blob shows its "napping" message and points visitors to contact. The static site is unaffected. Rate-limit counters still tick for those requests; that is harmless.

**Faster option for a real emergency:** revoke the key in the Anthropic Console (section 5). Every call then fails before the first token with HTTP 503 `unavailable` (a rejected key is treated as a broken configuration, not a transient error), with no redeploy needed. The visitor message is less friendly than the budget one.

**On:** set `DAILY_BUDGET_USD` back to the normal value (the project default is 1, meaning one US dollar a day) and redeploy. The variable accepts 0 to 50. An unset variable falls back to 1, so removing it does not leave Blob off.

The counter is per UTC day and resets by itself at 00:00 UTC. If today's spend already reached the budget, raising the budget re-opens Blob immediately; the counter is not reset.

## 3. Change the model or effort

1. Set `CHAT_MODEL` to one of the allowed models (`claude-haiku-5-5`, `claude-sonnet-5-5`) and/or `CHAT_EFFORT` to `low`, `medium` or `high`. Any other value makes the endpoint answer 503 `unavailable` (env invalid), so check spelling.
2. Redeploy. The system plus knowledge prefix is unchanged, but the prompt cache is per model, so the first few requests after a switch cost a little more.
3. Cost per question rises with a bigger model or higher effort. Re-check `DAILY_BUDGET_USD` against the new price list in `src/lib/server/pricing.ts`.
4. Before moving off the launch setting, run the evals for the candidate (section 8) and compare locally.

## 4. Rotate secrets

**`ANTHROPIC_API_KEY`**

1. Create a new key in the dedicated Anthropic workspace for this site.
2. Update the variable in Vercel (Production and Preview), then redeploy.
3. Confirm on the new deployment: `node scripts/smoke/chat-smoke.js <preview-url> --spend` (section 8) returns a `done` event.
4. Only then delete the old key in the Console.
5. If the old key may have leaked, do step 4 first and accept brief downtime.

**`IP_HASH_SALT`**

1. Generate a fresh random value of at least 32 bytes (for example with `openssl rand -hex 32`). Use different values for Production and Preview.
2. Update the variable and redeploy.
3. Effect: rate-limit buckets restart from zero because hashed IPs change. Nothing else depends on the salt.

Never paste a secret into chat, an issue, a commit or a log.

## 5. Spend controls (three layers)

1. **Per-IP and global rate limits:** 8 per minute and 60 per day per IP, 2,000 per day overall.
2. **Daily kill switch:** `DAILY_BUDGET_USD`, enforced in the app from estimated cost per response.
3. **Anthropic workspace spend limit:** a monthly cap on the workspace that owns this site's key, set in the Anthropic Console. This is the backstop if the app is misconfigured. Check that it is set after rotating keys or moving workspaces.

A spend alert is configured in the Vercel project. When it fires: look at the metrics logs (section 6), decide whether the traffic is real, and if not, turn Blob off (section 2).

## 6. Read logs

Open the project's runtime logs in Vercel and filter to the chat function. Each request writes one metrics line, `evt: "chat"`, with only: status, error code, mood, model, turn count, latency, time to first byte, token counts, cost in micro-USD, stop reason and error class. It never contains message text, IPs, session IDs or keys, and you should not add any.

Useful reads:

- Count of status 429 or 503 over a window: abuse or an outage.
- Sum of `costMicroUsd` for the day, against the budget.
- `errorClass` values for upstream failures.

## 7. What visitors see

| Status             | Code           | Meaning                                                                                                                                                                                                         | What to do                                                                                                        |
| ------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 405                | `invalid`      | Wrong method on `/api/chat` (the response carries `allow: POST`)                                                                                                                                                | Expected for GET and HEAD.                                                                                        |
| 429                | `rate_limited` | A rate limit was hit; response carries `retry-after` seconds                                                                                                                                                    | Normal for heavy use. Investigate only if global limit hits daily.                                                |
| 503                | `budget`       | Daily budget used up, or set to 0                                                                                                                                                                               | Wait for 00:00 UTC, or raise the budget (section 2).                                                              |
| 503                | `unavailable`  | Env missing or invalid, BotID or the Redis store unreachable (the app fails closed), or Anthropic rejected us for a config reason: bad or revoked key, no permission, unknown model, or the workspace spend cap | Check the env names in section 1, the Upstash integration, the key and the workspace cap. Retrying will not help. |
| 502                | `upstream`     | Transient Anthropic failure before the first token (connection, timeout, rate limit or server error). A failure or stall after streaming starts arrives as an SSE `error` event instead of a status             | Check Anthropic status; usually clears by itself.                                                                 |
| 403                | `bot`          | BotID rejected the client                                                                                                                                                                                       | Normal for scripts. For a real browser, check the BotID setup and the rewrites in `vercel.json`.                  |
| 400, 403, 413, 415 | `invalid`      | Input failed validation (length or shape limits)                                                                                                                                                                | Normal for bad clients.                                                                                           |

## 8. Scripts and evals

**Header check (free, safe any time):** `node scripts/ops/check-headers.mjs <preview-url>` sends HEAD/GET requests to `/`, `/api/chat` (expects 405) and the BotID challenge script (`<botid-path>/a-4-a/c.js`), and checks CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` and `X-Frame-Options` (`DENY`). The BotID path is a rewrite proxied to api.vercel.com, where Vercel applies only HSTS and not our `headers` rules (observed on the Preview), so there the script requires HSTS and a non-`text/html` response and checks nothing else. Exit 0 means pass. If the Preview is behind Vercel authentication, export the project's automation bypass value as `VERCEL_AUTOMATION_BYPASS_SECRET` first; the script sends it as a header and never prints it.

**Live chat smoke (spends real money, tiny):** `node scripts/smoke/chat-smoke.js <preview-url> --spend`. It refuses without `--spend` and refuses when `CI` is set. It prints event names, sizes and timings only. A `bot` result is possible, since a script is not a browser; that is a valid outcome, not a bug to bypass. Run it by hand, never from CI.

**Evals (Anderson only, local):**

- `npm run eval:dry` makes no API calls and checks the case files and wiring.
- A real run needs both `--spend` and `EVAL_ALLOW_SPEND=1`, and stays under the $1 budget guard: `EVAL_ALLOW_SPEND=1 node evals/run.ts --spend`.
- Results stay on your machine. Do not commit transcripts or reports, and do not publish them.

## 9. Incident steps

1. **Stop the bleeding.** Turn Blob off (section 2). If a key may have leaked, revoke it in the Anthropic Console as well.
2. **Look.** Read the metrics lines (section 6) for the window. Check Anthropic status and the workspace spend graph.
3. **Contain.** Rotate whatever may be exposed (section 4). A new `IP_HASH_SALT` also clears rate-limit state.
4. **Fix and verify.** Ship the fix to a Preview, run the header check and, if needed, one smoke request, then turn Blob back on.
5. **Record.** Add a short, non-sensitive note to `docs/PLAN.md` via the orchestrator. Keep details and any security findings in the private sibling repo, not here.

## 10. What not to do before P6

This repo is public and `main` serves the live site through GitHub Pages.

- Do not change DNS records, the `CNAME` file, the GitHub Pages workflow, or Vercel domains. Those need Anderson's explicit go-ahead as part of the P6 cutover.
- Do not merge Blob work to `main`. It lives on `feat/blob` and builds as Vercel Previews.
- Do not commit secrets, env values, project or database IDs, Preview URLs, eval output or security notes.
- Keep every control on: input limits, BotID, rate limits, the budget kill switch, output scrubbing and the stream stall guard. Tests may turn one off only through an explicit test-only flag, never through an env default.
