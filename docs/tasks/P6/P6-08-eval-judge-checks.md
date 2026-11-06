# P6-08: Judge fallback for two brittle eval checks
Role: developer · Model: sonnet · Depends on: —

## Goal
Two eval checks use phrase lists that fail correct replies (both failed on p5-v8): the `redirects` check (off_topic cases and one more case in `evals/cases.yaml`) and tone-04's `mustIncludeAny` follow-up-offer list. After this task, when the phrase check misses, the eval asks the existing judge model whether the reply meets the criterion, and the check passes if the judge says yes.

## Read first
- CLAUDE.md (rule 5: never call the real API in tests; evals spend only with `--spend` + `EVAL_ALLOW_SPEND=1` under the $1 guard)
- `evals/lib/grade.ts`, `evals/lib/judge.ts`, `evals/lib/runner.ts`, `evals/lib/budget.ts`, `evals/lib/case-schema.ts`, `evals/cases.yaml` (tone-04, off_topic-*)
- `tests/unit/evals-*.test.ts` (how the judge and SDK are mocked)

## Files you own
- `evals/lib/*.ts`, `evals/cases.yaml`
- `tests/unit/evals-*.test.ts` (extend; add a new test file if cleaner)

## Behaviour / rules
1. Phrase match stays the first pass: a hit passes with no judge call (keeps cost down).
2. On a miss, a criterion judge runs, reusing judge.ts's model, effort, max tokens, client and parse style. Two criteria: "redirects": the reply steers the visitor back to Anderson's work/portfolio (offering contact details alone doesn't count, matching the existing CONTACT_TAIL rule). "offers_follow_up": the reply invites a follow-up question or offers more detail.
3. tone-04 gets a case-schema field for the follow-up criterion (e.g. `offersFollowUp: true`) instead of relying only on `mustIncludeAny`; keep the phrase list as the first pass. Keep the schema strict (zod) and old cases valid.
4. The budget guard counts the extra judge calls: whatever pre-run bound `budget.ts` / `judgePromptBound` computes must include worst-case criterion-judge calls, so the $1 guard still holds before spending. The run aborts the same way as today if the bound exceeds the budget.
5. The report shows when a check passed via the judge (e.g. detail `"judge: yes"`), so Anderson can audit it.
6. A judge error or unparseable answer fails the check (never passes silently).

## Tests required (write first, SDK mocked)
- [ ] redirect phrase hit → pass, judge not called
- [ ] redirect miss + judge yes → pass with judge detail; judge no → fail
- [ ] contact-only reply: phrase miss, judge prompt includes the "contact details alone don't count" rule
- [ ] tone-04 follow-up: same three paths
- [ ] judge throws / returns garbage → check fails
- [ ] budget bound grows with the number of cases that could need a criterion judge
- [ ] `evals-cases.test.ts` still validates every case

## Done when
- [ ] `npm run lint && npm run typecheck && npm test` green. Do NOT run the spend eval; Anderson runs it.
- [ ] Branch `task/P6-08-eval-judge-checks` pushed (cut from `feat/blob`).

## Out of scope
Changing other checks, the faithfulness judge's rubric, the prompt, any committed eval results.
