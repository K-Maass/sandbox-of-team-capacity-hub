# Luna-first interpreter baseline

Recorded on 2026-09-16 before runtime changes, from `feat/capacity-ai` at
`37a516a` (`Harden Capacity Hub AI assistant review paths`). The implementation
branch is `feat/luna-first-interpreter`.

## Verification baseline

- Working tree was clean; `git diff --check` passed.
- `bun test`: 66 tests passed, 267 assertions.
- `bun run build`: passed.
- `bun x tsc --noEmit`: 4 pre-existing diagnostics in `src/routes/__root.tsx`,
  `src/routes/api/ai/smoke.ts` (2), and `src/routes/api/public/export/zip.tsx`.
- `bun run lint`: baseline failure (112 errors, 8 warnings), primarily existing
  Prettier violations outside the assistant work.
- `bun x prettier --check .`: baseline failure in 13 existing files.

## Current flow

```text
CapacityAssistant UI
  -> authenticated loopback API route
  -> bearer validation and user-scoped repository
  -> deterministic refusal/context checks
  -> Luna function call or local language shortcut
  -> CapacityIntent
  -> deterministic Phase 2 action/read service
  -> read result or write preview
  -> explicit confirmation
  -> fresh precondition validation and RLS-scoped mutation
```

Primary files:

- UI and client conversation state: `src/components/capacity-assistant.tsx`
- Intent, request, context, and response contracts:
  `src/domain/capacity/assistant.ts`
- Phase 2 typed actions and safety sequence:
  `src/server/capacity/actions.server.ts`
- Current orchestration, clarification choices, context revalidation, and
  deterministic rendering: `src/server/capacity/assistant.server.ts`
- Current model tools, parser, refusal guards, date manifest, and provider
  invocation: `src/server/capacity/assistant-interpreter.server.ts`
- User-scoped Supabase access: `src/server/capacity/repository.server.ts`
- IBM Responses adapter: `src/lib/ibm-ai.server.ts`
- Authenticated request boundary: `src/routes/api/ai/capacity.ts`

## What remains authoritative

- Domain rules, calculations, date/range semantics, and deterministic rendering.
- Consultant/demand/availability resolution and database ambiguity candidates.
- Typed Phase 2 reads and writes.
- Preview generation, explicit confirmation, fresh preconditions, state
  fingerprints, stale replacement previews, and mutation.
- Authentication, request bounds, safe provider projection, credential/privacy
  protection, RLS-scoped repository access, and user identity.

The current domain semantics are inclusive ISO date ranges; point capacity is
date-based, range aggregates use Monday-Friday working days, open-ended demand
dates overlap a query when their known boundary permits it, Won/In Progress are
committed, Incoming is pipeline, Lost is non-consuming, and archived or
unavailable consultants have zero effective capacity. Skills are exact,
case-insensitive matches after normalization. Existing `todayIsoDate` uses the
runtime's local timezone while range iteration is UTC; V2 preserves this
behavior rather than inventing a new calendar authority.

## What moves to Luna and the compiler

- Luna: natural-language meaning, conversational follow-ups, semantic
  references (`self`, current context, names), semantic time concepts, typed
  clarification, unsupported classification, help/conversation, and
  multiple-change classification.
- Compiler: semantic references to authoritative current records, self
  resolution, date arithmetic, canonical defaults, ambiguity handling, and
  adaptation into existing `ReadAction`/`ProposedAction`/relative operations.

Luna receives only bounded user text plus safe labels and semantic context. It
does not receive credentials, JWTs, raw authoritative IDs, rows, SQL, query
objects, or mutation authority.

## Heuristics to retire after V2 proves itself

The current interpreter contains phrase-specific branches for sparse demand
creation, combined profile updates, self-capacity reads/writes, team and
consultant follow-ups, compound-change refusal, unsupported language, and date
phrase context. V2 must replace product-language parsing with one strict
semantic outcome path. The pre-provider security/privacy guard, schema
validation, authoritative resolution, deterministic rendering, and Phase 2
safety checks remain.

## Known baseline risks / deferred items

- Current RLS is intentionally broad trusted-team authorization; it is not a
  production multi-organization/RBAC design.
- The direct typed-action endpoint does not stream-limit the request body; this
  program focuses on the Luna endpoint and must not weaken its bounds.
- No authenticated live Supabase E2E, deployment, MCP, Orchestrate, persistent
  transcript, undo, or compound execution is in scope.
