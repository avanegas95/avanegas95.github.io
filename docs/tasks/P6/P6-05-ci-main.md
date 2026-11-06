# P6-05: CI runs on pushes to main
Role: developer-lite · Model: sonnet · Depends on: —

## Goal
`main` is the production branch since the P6 cutover (Vercel builds Production from it), but `quality.yml` only runs on pushes to `feat/blob` and on PRs. After this task, a push to `main` runs the fast tier too.

## Read first
- CLAUDE.md
- `.github/workflows/quality.yml` (the header comment explains the two tiers)

## Files you own
- `.github/workflows/quality.yml`

## Behaviour / rules
1. `on.push.branches` becomes `[main, feat/blob]`. Pushes keep getting the fast tier (the existing `github.event_name == 'push'` conditions already do this; don't change them).
2. Update the header comment so it says pushes to `main` and `feat/blob` run the fast tier, and that `main` is the production branch.
3. Concurrency stays per SHA for pushes, so a fast-forward of `main` to a commit that `feat/blob` already ran gets its own group. That's fine: don't try to dedupe.
4. Don't touch `deploy.yml` (the Pages workflow; CLAUDE.md rule 12) or any other workflow.

## Tests required
- [ ] `npx yaml-lint`-style sanity: `node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/quality.yml','utf8'))"` succeeds (the `yaml` package is already a dependency; if not, use `npx --yes yaml valid`).
- [ ] If a unit test already parses workflow files (`grep -rl quality.yml tests/`), extend it to assert `main` is in the push branches.

## Done when
- [ ] Only `quality.yml` changed. Branch `task/P6-05-ci-main` pushed (cut from `feat/blob`).

## Out of scope
Branch protection, required checks, the full tier on main, deploy.yml.
