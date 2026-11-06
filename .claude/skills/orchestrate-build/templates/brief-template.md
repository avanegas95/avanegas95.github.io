# Task briefs

One brief per task at `docs/tasks/<phase>/<task-id>.md`, written by the **architect** agent at the start of each phase and approved by the orchestrator before dispatch. A brief is the *entire* context an implementer gets besides `CLAUDE.md`, so it must be self-sufficient and short (≤ 1 page).

**Briefs for `haiku` tasks must fill in every section below with no "TBD", including exact signatures and concrete test cases.** If that isn't possible, the task isn't ready for haiku; assign it to sonnet.

```markdown
# <TASK-ID>: <title>
Role: <developer|developer-lite|test-engineer|copywriter|designer|researcher> · Model: <haiku|sonnet|opus> · Depends on: <ids>

## Goal
One or two sentences: what exists after this task that didn't before.

## Read first
- CLAUDE.md
- docs/SCOPE.md §<n> (only the listed sections)
- <specific existing files, if any>

## Files you own (create/modify only these)
- path/to/file.ts
- path/to/file.test.ts

## Interfaces
Exact exported names, signatures and types the task must provide or consume.

## Behaviour / rules
Numbered, testable statements. Include false-positive conditions for checks.

## Tests required (write first)
- [ ] `<test name>`: input → expected output
- [ ] Fixture manifest entries: `<page>` mustFind/mustNotFind `<check ids>`
- [ ] Negative/edge cases: …

## Done when
- [ ] All listed tests exist and pass; `pnpm lint && pnpm typecheck && pnpm test` green
- [ ] No files touched outside "Files you own" (or listed under NOTES in the report)
- [ ] Branch `task/<TASK-ID>-<slug>` pushed

## Out of scope
Things the implementer must not do, even if tempting.
```
