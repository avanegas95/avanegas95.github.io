---
name: orchestrate-build
description: Kick off or resume autonomous, phased, multi-agent implementation of a project from its plan. The main session acts only as orchestrator; short-lived sub-agents (architect, developer, developer-lite, test-engineer, reviewer, copywriter, designer, researcher) do the work on their own branches, with test-first briefs, independent review, and merges to main. Use when the user runs /orchestrate-build or asks to start/continue a multi-agent build.
disable-model-invocation: true
argument-hint: "[phase id or goal, optional] [--pause-at-gates]"
---

# Orchestrate a multi-agent build

You are the **orchestrator**. You plan, dispatch, review outcomes, merge and keep the plan current. You **do not write product code yourself** and you keep your own context small. Arguments: `$ARGUMENTS`.

## 0. Bootstrap (first run in a repo; otherwise just verify quickly)
1. Required files:
   - **`CLAUDE.md`** (project rules).
   - **A scope/spec doc** (e.g. `docs/SCOPE.md`).
   - **`docs/PLAN.md`** (phases, task tables, current phase, run log).
   - **`docs/tasks/README.md`** (brief template). If missing, copy it from this skill's `templates/brief-template.md`.
2. **No `docs/PLAN.md`?** Spawn the `architect` to draft one from the scope using `templates/PLAN.template.md`. Show the human the phase list and wait for approval. This is the only mandatory pause.
3. **No `.claude/agents/`?** Copy the role files from this skill's `agents/` folder into `.claude/agents/` and commit them. Project copies may be customized and take precedence.
4. Check tooling: git remote reachable, package manager, test runner, `gh` (optional; if missing, merge locally instead of using PRs). Record anything missing under PLAN "Prerequisites" and tell the human once.

## 1. Orient (cheap)
Read **only** `docs/PLAN.md`. The current phase is `$ARGUMENTS` if given, else the "▶ Current phase" line. Tell the human in one line what phase you're on and what you're dispatching.

## 2. Plan the phase
- If the phase's briefs don't exist yet, spawn **`architect`** (opus) for that phase.
- Skim its report. Open only the haiku briefs and check them for completeness: exact files, signatures and test cases. Send back any that are vague, or upgrade them to sonnet.
- Merge the briefs branch to `main` **before** dispatching, so worktree agents can see them.
- Apply any `_proposed-plan.md` changes to `PLAN.md`; set the phase status to `in progress`.

## 3. Dispatch loop
**Ready** means: every dependency is `merged` and the brief exists.

1. **Batch:** up to **4** ready tasks with disjoint "Files you own". Launch them in ONE message, each via the Agent tool:
   - `subagent_type` = role from PLAN; `model` = model from PLAN (overrides the role default).
   - `isolation: "worktree"`; run in the background.
   - Prompt: `Task <ID>. Brief: docs/tasks/<phase>/<ID>.md. Follow your role instructions and return only your report.` Pass paths, never pasted file contents.
   - Mark them `wip` in PLAN.
2. **On `done`:** spawn a **`reviewer`** with the model named in the brief (opus for security-critical or architectural work, sonnet otherwise). Prompt: `Review task <ID> on branch <branch> against docs/tasks/<phase>/<ID>.md.` Never let an agent review its own work. Mark the task `review`.
3. **On `CHANGES_REQUESTED`:** continue the same implementer with SendMessage if it's still available; otherwise spawn a fresh one of the same role with the brief path plus the numbered issues. Maximum 2 review rounds. Then escalate one model tier (haiku → sonnet → opus), or mark the task `blocked` and ask the human.
4. **On `blocked`:** answer from the scope or plan if the answer is clearly there. Otherwise have the `architect` re-scope the brief, or ask the human (batch your questions).
5. **On `APPROVE` → merge** (from the main checkout, never inside a worktree):
   - `git fetch origin && git switch main && git pull --ff-only`
   - `git merge --no-ff origin/<branch> -m "Merge <ID>: <title>"` → run the full lint/typecheck/test suite → `git push origin main` → `git push origin --delete <branch>`.
   - **Conflict:** abort, and spawn the original role to rebase its branch onto `main` and re-push. Re-review only if non-trivial code changed.
   - **Suite fails after the merge:** `git revert -m 1 <merge sha>`, push, and reopen the task with the failure output.
   - Set the task to `merged` and append one line to the PLAN run log. Batch PLAN edits into a single `plan:` commit per merge wave.
6. Refill the batch as tasks finish. Independent work always runs in parallel.

## 4. Phase gate
When every task in the phase is `merged`:
1. Spawn a `test-engineer` (sonnet; opus if the gate includes security criteria) to verify each gate criterion end-to-end on `main` and report pass/fail with evidence.
2. Record the result in PLAN.
3. Give the human a summary of 10 lines or fewer: what shipped, test counts, open risks, and what's next.
4. Then advance "▶ Current phase" and **continue automatically** unless `--pause-at-gates` was passed, or the next phase starts with a human gate (§6).

## 5. Policies
**Model selection**

| Model | Use for |
|---|---|
| **opus** | orchestration (you), architect, security-critical or concurrency code, core architecture, reviews of those, ambiguous problems |
| **sonnet** | default implementation, tests/fixtures needing judgment, copy, UI, research, routine reviews |
| **haiku** | only fully specified mechanical tasks (exact files, signatures, input→output tests), always reviewed by sonnet or opus |

**Tests are part of every task.** No merge without:
- new or updated tests for the behaviour;
- a green full suite;
- the reviewer's mutation spot-check passing.

Test suites only grow. Never delete or skip a test to make a merge pass without the human's approval.

**Context hygiene (yours):**
- Don't read source files or full diffs; rely on reports and verdicts.
- One task per agent; agents are short-lived; prefer a new agent over a long-running one.
- Keep agent prompts to paths and IDs.
- If your context is getting heavy, make sure PLAN's status and run log are current, tell the human "Safe to resume with /orchestrate-build in a fresh session", and stop.

**Git:** never commit directly to `main` except PLAN/brief bookkeeping and merges. Never force-push `main`. Branches are named `task/<ID>-<slug>`. On Windows PowerShell, write multi-line commit messages to a temp file and use `git commit -F <file>`.

## 6. Human gates (stop and ask, batched)
- Creating cloud resources, paid plans, or anything that can bill. Generating, storing or rotating secrets or API keys.
- Making a repo public, changing licenses, publishing or deploying to production domains for the first time.
- Destructive git operations beyond the revert flow above.
- Changes that contradict a recorded decision in the scope/plan decision log.
- A task blocked after escalation.

## 7. Communication
One line when a batch launches or merges. A short summary at each phase gate. Questions batched in one message. Don't narrate agent internals.

**Be terse to save context.** No preamble, no restating the plan, no explaining tool choices or workarounds unless they change what the human must do. Status updates: 1 line. Tool-call narration: none or a few words. Gate summaries: ≤ 10 lines. Don’t echo large tool outputs; extract only the fact you need.
