# Luna-first interpreter stage ledger

Branch: `feat/luna-first-interpreter`  
Baseline: `37a516a`  
Started: 2026-09-16

| Stage | Builder | Reviewers | Files changed | Tests / gate | Result | Commit |
| --- | --- | --- | --- | --- | --- | --- |
| 0 Baseline archaeology | Read-only Repository Archaeologist | Domain Semantics Reviewer; Security Boundary Reviewer | `LUNA_V2_BASELINE.md`; this ledger | 66 tests pass; build pass; 4 baseline TypeScript diagnostics; maps agree | PASS | pending |
| 1 Evaluation corpus | Stage 1 Eval/Test Engineer | Conversational UX Reviewer; Domain Semantics Reviewer | `src/evaluation/capacity-corpus.ts`; `src/evaluation/evaluator.ts`; `src/evaluation/evaluator.test.ts`; `src/evaluation/legacy-v1-adapter.ts`; `src/evaluation/state-aware-provider-adapter.ts`; `src/evaluation/runner.ts`; `package.json` | `bun test`: 76 pass; offline plumbing probe 2/2 and explicitly `NOT_RUN`; no-key runner exits 2 safely; `git diff --check` pass; 4 baseline TypeScript diagnostics unchanged | PASS after 5 repair iterations; both reviewers PASS with no findings | pending |
| 2 Semantic contracts | Semantic Contract Engineer | Domain Semantics Reviewer; Security Reviewer; Type/API Design Reviewer | `src/domain/capacity/assistant-semantic.ts`; `src/domain/capacity/assistant-semantic.test.ts` | `bun test`: 87 pass; focused semantic tests 11 pass / 88 assertions; 4 baseline TypeScript diagnostics unchanged; `git diff --check` pass | PASS after 2 repair iterations; all reviewers PASS with no findings | pending |
| 3 Luna tools and prompt | IBM Provider / Prompt Engineer | Model Behavior Reviewer; Security Reviewer; Architecture Coherence Reviewer | `src/server/capacity/assistant-tools.server.ts`; `src/server/capacity/assistant-prompt.server.ts`; corresponding tests | `bun test`: 98 pass; focused Stage 3 tests 22 pass / 443 assertions; build, focused lint, Prettier, and `git diff --check` pass; 4 baseline TypeScript diagnostics unchanged; no live IBM quality run | PASS after 2 repair iterations; all reviewers PASS with no findings; runtime wiring intentionally deferred | pending |
| 4 Semantic compiler | pending | Phase 2 Reviewer; Security Reviewer; Concurrency Reviewer | pending | pending | pending | pending |
| 5 Clarification state | pending | UX Reviewer; Security/Privacy Reviewer; Integration Reviewer | pending | pending | pending | pending |
| 6 V2 shadow/test integration | pending | Architecture Reviewer; Eval Reviewer; Security Reviewer | pending | pending | pending | pending |
| 7 Read cutover | pending | Domain Reviewer; UX Reviewer; Regression Reviewer | pending | pending | pending | pending |
| 8 Clarification/help cutover | pending | UX Reviewer; Architecture Reviewer; Security Reviewer | pending | pending | pending | pending |
| 9 Write preview cutover | pending | Phase 2 Reviewer; Security Reviewer; Concurrency Reviewer; UX Reviewer | pending | pending | pending | pending |
| 10 Relative write cutover | pending | Concurrency Reviewer; Phase 2 Reviewer; Security Reviewer | pending | pending | pending | pending |
| 11 V1 heuristic cleanup | pending | Architecture Reviewer; Regression Reviewer; Security Reviewer | pending | pending | pending | pending |
| 12 Conversational acceptance | pending | UX Reviewer; Domain Reviewer | pending | pending | pending | pending |
| 13 Independent final audit | pending | Architecture; Security/Trust Boundary; Domain/Regression Auditors | pending | pending | pending | pending |

Review policy: no stage advances with a BLOCKER/HIGH or a rejected mandatory
review. Local checkpoint commits are created only after the stage gate passes.
