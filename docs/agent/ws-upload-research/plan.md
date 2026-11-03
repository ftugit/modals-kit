# WS upload architecture research — ACTIVE PLAN v2

Topic: choosing between immediate-WS upload and HTTP-preflight→WS, and designing a
mathematically bounded lifetime policy for the socket.

Scope: **research and design proposal only**. No production code changes, no deploy,
no DB reset. Prototype experiments only in a scratch copy.

Baseline revision: HEAD `8c0d16b` (working copy updated from `d099248`).
Task text: `docs/agent/ws-upload-research/task.md`.
Findings: `docs/agent/ws-upload-research/verified-findings.md` (§1–§24).

## ACTIVE PLAN v2
- [x] 0. Establish baseline: HEAD/git status, locate WS subsystem, env surface
- [x] 1. Update the local working copy (was stale at `d099248`) and re-verify what changed
- [x] 2. Dispatch independent research fragments sized for a 128k context budget
- [x] 3. Independently verify every load-bearing claim against code by the lead
- [x] 4. Resolve the architecture question: immediate WS vs HTTP preflight vs alternatives
- [x] 5. Derive the lifetime/deadline policy: TTL, data wait, pause, early cancellation
- [x] 6. Enumerate the `env` surface to add or rethink
- [x] 7. Write the final Russian answer to the owner
- [x] 8. Update `progress.md` and keep the research artifacts in the tree
Next: hand the answer to the owner; no code changes were made or are proposed here.

## Superseded subagent note
- v1 planned six subagents (A–F) plus a `reports/` collection step. `reports/` stayed
  empty — no subagent wrote a file, so their intermediate output was lost and every
  claim had to be re-verified by the lead in person. The plan now records the
  verification-by-lead as the source of truth rather than a collection step.

## SUPERSEDED
- v1 (2026-11-03): six-subagent split with a `reports/` merge step. Abandoned because
  the reports were never persisted; direct re-verification proved cheaper and more
  trustworthy.
