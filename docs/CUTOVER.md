# avanegas.com cutover: GitHub Pages → Vercel (P6)

> Public-safe. No project or team IDs, store names, env values or DNS record values from the Vercel UI go in this file. Anderson approves every step marked **[A]** in a message before anyone runs it (CLAUDE.md rule 12). Steps marked **[A-does]** are Anderson's to perform himself (dashboards, registrar).

## Where things stand (2026-11-06)
- avanegas.com is served by GitHub Pages from `main` (apex A records to GitHub, `www` CNAME to `avanegas95.github.io`). The registrar's DNS also carries email forwarding (MX + SPF TXT). **Those email records must not change.**
- The Vercel project exists and builds Previews from `feat/blob`. Every env var the code needs is set for Production and Preview. There is no production deployment and no custom domain yet. Deployment Protection covers every deployment except custom domains.
- Preview and Production share one Upstash store (N-1 open).
- **Trap:** `deploy.yml` on `main` builds and uploads `dist/`. `feat/blob` builds with the Vercel adapter into `.vercel/output/`, so after the merge the Pages workflow would fail. A failed Pages run leaves the last good Pages deployment live, but the workflow must be made manual-only in the same merge so nothing tries to redeploy a broken build.

## Order (each phase finishes before the next starts)

### Phase 0: release candidate (no outward change)
1. `feat/blob` green on the full CI tier (`gh workflow run quality --ref feat/blob`), including Lighthouse.
2. **[A-does]** Spend eval on the current prompt version passes the gate.
3. One real message to Blob on the latest Preview (CI mocks `/api/chat`).

### Phase 1: production prerequisites (dashboards, no DNS)
4. **[A-does]** N-1: create a separate Upstash database for Preview (eviction off) and connect it to the Preview environment only, so Preview traffic can't spend Production's rate-limit or budget keys. Then send one Preview message and check that the Production store's keys don't move.
5. **[A-does]** Rotate the test Anthropic key and the Preview bypass value. Production gets a fresh key in a dedicated workspace with its own monthly limit.
6. **[A-does]** Confirm the team spend alert and spend management, BotID on, Node 24.x, and the Production branch set to `main`.
7. **[A-does]** Lower the TTL on the apex A records and the `www` CNAME to 5 minutes, at least one old TTL (24 h is safe) before Phase 3.
8. **[A]** Close the stale Dependabot PRs #145–#149 on `main`; `feat/blob` already carries newer versions.

### Phase 2: production build on Vercel, before DNS
9. **[A]** Merge `feat/blob` into `main` (merge commit, no squash). In the same merge, `deploy.yml` becomes `workflow_dispatch` only (no `push` trigger). Pages keeps serving its last deployment, so avanegas.com doesn't change.
10. Vercel builds Production from `main`. Run the pre-DNS checks below against the production deployment URL (behind Deployment Protection, so use the bypass header or a signed-in browser).

### Phase 3: domain and DNS
11. **[A]** Add `avanegas.com` (primary) and `www.avanegas.com` (redirect to apex) to the Vercel project. Vercel then shows the records to set; copy them from the dashboard, never from this file.
12. **[A-does]** At the registrar, replace the four GitHub A records on the apex and the `www` CNAME with Vercel's records. Leave MX, SPF and any verification TXT records untouched.
13. Wait for Vercel to show the domain as valid and for its certificate to be issued. Then run the post-DNS checks.

### Phase 4: settle (about two weeks)
14. Watch Vercel runtime errors and logs, the spend dashboard and Search Console coverage.
15. **[A]** Retire Pages: delete `deploy.yml` and `CNAME`, and remove the custom domain from the Pages settings.
16. **[A-does]** Make the repo private (Pages stops serving private repos on GitHub Free, so this must come after step 12).
17. **[A]** Enable the nightly eval cron (internal results only, human gate). Retire the old `portfolio-v3` Vercel project's variables.

## Checks

### Pre-DNS (production deployment URL)
- `/`, `/blog/`, `/projects/paychira/`, `/blob-privacy/` return 200.
- `/orbithop`, `/orbithop/`, `/privacy`, `/privacy/` and `/app-ads.txt` return 200, with `app-ads.txt` byte-identical to the live one.
- `/Anderson_Vanegas_Resume.pdf` returns 200 `application/pdf` and is the public-safe PDF.
- `node scripts/ops/check-headers.mjs <url>` (RUNBOOK) passes, and `curl -sI <url>` shows no `X-Robots-Tag: noindex`.
- One real Blob message streams. A burst triggers the rate limit. The kill switch is tested on a branch-scoped Preview variable only, never on Production.

### Post-DNS (avanegas.com and www)
- Every pre-DNS check again on `https://avanegas.com`.
- `http://` → `https://` and `www` → apex both redirect with a 308 or 301.
- `dig avanegas.com MX` is unchanged and a test email still forwards.
- Search Console: the property is still verified, the sitemap resubmits and URL inspection fetches `/`.
- The AdMob app-ads.txt crawler status stays "found" (it can take a day to recrawl).

## Rollback (any time before step 16)
1. **[A-does]** Put the four GitHub A records and the `www` CNAME back at the registrar. Pages never stopped serving, and its custom domain setting stays until step 15.
2. With the low TTL, most visitors are back on Pages within minutes.
3. Leave the Vercel domain attached while debugging; it doesn't affect Pages.
After step 16 (repo private), rolling back needs the repo made public again, or a Vercel-side fix instead.
