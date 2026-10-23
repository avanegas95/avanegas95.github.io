# P5 proposed task table (architect, 2026-10-23)

Changes vs PLAN's candidate list: P5-01 done (audit at `P5-01-port-audit.md`); P5-02 also owns **every** phase dependency and npm script (removes the `package.json` hotspot); P5-03 split into 03a (shared lib + KB + PII guard) and 03b (server + route + N-2); P5-04 split into 04a (port + restyle on `/dev/blob`), 04b (speech bubble) and 04c (home placement, **PENDING ANDERSON**). Max 4 agents in parallel.

| ID | Task | Role | Model | Reviewer | Depends on | Batch |
|---|---|---|---|---|---|---|
| P5-01 | Port audit | architect | opus | — | P5-00 | done |
| P5-02 | Vercel adapter, `vercel.json` (v1-compatible CSP, resume 302, BotID), Node 24, all deps/scripts, test configs | developer | sonnet | opus | P5-00 | 1 |
| P5-08 | `/blob-privacy/` note page | copywriter | sonnet | sonnet | P5-02 | 1→2* |
| P5-03a | Shared lib, KB, content collections, PII guard | developer | opus | opus | P5-02 | 2 |
| P5-05 | CI workflow, Blob-scoped bundle gate, legacy E2E, Lighthouse | test-engineer | sonnet | sonnet | P5-02, P5-03a | 3 |
| P5-03b | Chat server, controls, v1 anchors in allowlist, N-2 `waitUntil` | developer | opus | opus | P5-03a | 3 |
| P5-04a | Blob island port + v1 restyle on `/dev/blob` | designer | sonnet | opus | P5-03a | 3 |
| P5-07 | KB ↔ v1 site consistency, DISCREPANCIES rows, `site.md` | researcher | sonnet | sonnet | P5-03a | 3 |
| P5-04b | Speech-bubble replies replace the panel | designer | sonnet | opus | P5-04a | 4 |
| P5-06 | Internal evals port (no publishing) | developer | sonnet | opus | P5-03b | 4 |
| P5-09 | RUNBOOK (public-safe) + header check script (N-3) | developer | sonnet | opus | P5-03b, P5-05 | 4 |
| P5-04c | Mount Blob on `/` in the chosen placement | designer | sonnet | opus | P5-04b, **Anderson's pick** | 5 |

\* P5-08 needs only P5-02's Playwright config; start it alongside P5-03a in batch 2.

Batches: 1 = P5-02 · 2 = P5-03a, P5-08 · 3 = P5-03b, P5-04a, P5-05, P5-07 · 4 = P5-04b, P5-06, P5-09 · 5 = P5-04c → phase gate.

Shared-file notes for the orchestrator: `.gitignore` additions come from P5-05 as NOTES; `src/lib/prompt.ts` is created by 03a and only its link list edited by 03b (sequential); 04a/04b share Blob files (sequential); the scrubber allowlist change in 03b (v1 anchors + `/blob-privacy/`) needs a decision-log row.
