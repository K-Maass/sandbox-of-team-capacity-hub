# Team Capacity Hub

A shared staffing and capacity-planning application for a consulting team, with a production-gated natural-language assistant. The board tracks people, demand, allocations and forward capacity; the assistant translates conversational requests into typed reads or previewed changes without giving the model direct access to the database.

## What it does

- Shared consultant roster backed by Postgres/Supabase.
- Email/password sign-up and sign-in.
- First-login **Join the team** flow so colleagues add themselves before using the staffing board, or claim an existing roster entry with the same email.
- Consultant fields: name, email, level, role, skills/topics and working capacity.
- Simple **unavailable dates** for vacation, training or other full days when someone should not be staffable.
- Active/archived team lifecycle so people can leave the live roster without deleting staffing history.
- Demand fields: project/topic/RfP, client, dates, required effort, skills/topics, status, owner and notes.
- Drag a consultant onto a demand to open the allocation dialog and choose the allocation percentage.
- Date-aware capacity: the Board can show availability for a selected date and only counts active/committed demands whose dates overlap it.
- Pipeline staffing is kept separate from committed capacity. Turn on **Include pipeline** to see the scenario if tentative work lands.
- Interactive **Timeline** inside the Board with 4/8/12-week windows and Overview / People / Demand modes.
  - People rows show average weekday free capacity, committed load and pipeline exposure.
  - Demand rows show when work is active, percent staffed and remaining need.
  - Click a person to inspect work and unavailable dates in the visible window.
  - Click a demand to inspect owner, dates, required effort, staffing gap and allocated people.
- Over-allocation warnings without blocking intentional exceptions.
- Shared changes arrive immediately through Supabase Realtime, with 15-second polling and window-focus refresh as a fallback.
- **Insights** focused on actionable staffing issues: utilization, free capacity, overbooking, unstaffed demand and status distribution.

## Capacity Assistant

The repository's current `main` includes the **Luna V2** assistant path and the authenticated hosted runtime.

The design deliberately separates probabilistic language understanding from deterministic business execution:

```
user message
    │
    ▼
pre-provider security guard
    │
    ▼
Luna function/tool call
(semantic meaning only)
    │
    ▼
strict schema parsing
    │
    ▼
deterministic compiler
against authoritative server-loaded state
    │
    ├── read → deterministic query/presentation
    └── write → typed preview → explicit confirmation → mutation
```

### Safety and reliability boundaries

- The model produces **semantic intent only**; it never receives a database handle and never executes SQL.
- Tool output is schema-validated and compiled against authoritative application state on the server.
- Ambiguous people, demands, dates or conversational references enter a bounded clarification flow rather than being guessed.
- Writes are previewed and require explicit confirmation; stale previews/conflicting state are rejected.
- Pre-provider guards reject credential exfiltration, pasted secrets, raw SQL requests and confirmation-bypass attempts before they reach the model.
- Provider responses, request sizes and execution time are bounded; provider diagnostics are redacted.
- Hosted access is restricted to authenticated requests and an explicitly enabled Vercel production runtime.
- The repository includes a conversational evaluation corpus, generalization cases and synthetic acceptance coverage.

Run the assistant evaluation harness with:

```bash
bun run eval:capacity
```

This is the part of the project that turns the staffing board from a CRUD application into an AI systems project: the LLM is used where language ambiguity is useful, while state resolution and business effects remain deterministic and testable.

## Simple permission model

This version intentionally keeps permissions minimal:

- unauthenticated visitors cannot read or write team data;
- any authenticated user can view and edit the shared roster, unavailable dates, demands and allocations;
- there is no admin/invite hierarchy yet.

That is appropriate for a small trusted team. If this becomes a larger or sensitive production system, add organization membership and role-based policies before storing sensitive staffing/client data.

## Data model

The database has four core tables:

- `consultants` — profile, skills, working capacity, optional linked auth user and optional archive timestamp.
- `demands` — project/topic/RfP details, status, dates, required effort, skills/topics and optional owner consultant.
- `allocations` — consultant ↔ demand with a percentage allocation.
- `availability_blocks` — consultant, start/end date and an optional note for full-day unavailability.

The UI uses simpler status labels without changing the stored values: **Pipeline**, **Confirmed**, **Active**, and **Closed**.

- Confirmed and Active work reserve capacity.
- Pipeline allocations are visible but remain tentative until the user chooses to include them in the planning scenario.
- Closed work does not reserve capacity.

Archived people remain queryable for history but are excluded from live capacity and current demand staffing. Deleting permanently is only exposed from the archived team view.

## Timeline behavior

The Timeline is deliberately a planning lens rather than a second scheduling system.

- It uses the same consultants, demands, allocations and unavailable dates as the Board.
- The Board's **Capacity on** date is also the Timeline focus date.
- Weekly people cells use the average of Monday–Friday for the visible week.
- The 4/8/12-week selector changes only the planning window; it does not create new data.
- Clicking a week moves the focus date.
- Filters such as demand status/owner change which demand rows are displayed, but they do **not** change the capacity calculation for people.

## Tech stack

- TanStack Start + React + TypeScript
- TanStack Query
- Supabase/Postgres + Supabase Auth + Supabase Realtime
- Tailwind CSS v4 + shadcn/ui/Radix
- Recharts
- date-fns

No new runtime dependency was added for the planning extensions.

## Local setup

This project uses Bun in Lovable, but another modern package manager can also install the dependencies.

1. Copy `.env.example` to `.env` and provide the public Supabase project values:

```bash
cp .env.example .env
```

Required client values:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

The server-side equivalents used by generated Lovable helpers are also documented in `.env.example`.

2. Install dependencies:

```bash
bun install
```

3. Start the app:

```bash
bun dev
```

Then open `http://localhost:8080` or the port reported by Vite.

## Database setup outside the existing Lovable project

The existing Lovable project already has its Supabase database provisioned and the latest migration applied. For a new Supabase project, apply migrations in order:

```text
drizzle/migrations/0000_collaboration_foundation.sql
drizzle/migrations/0001_usability_and_realtime.sql
drizzle/migrations/0002_planning_extensions.sql
```

The migrations add demand skills, Realtime publication, unavailable dates, archived consultants and demand ownership.

Then place that project's public URL and publishable key in `.env`.

Do **not** put a Supabase service-role/secret key into frontend environment variables.

## Sharing with the team

For the existing hosted project, share the deployed app URL. A colleague can:

1. create an account;
2. confirm their email if the Supabase project requires confirmation;
3. after sign-in they are sent directly to **Join the team**;
4. add themselves to the roster, or claim a pre-created team profile with the same email;
5. add unavailable dates when relevant;
6. use Board for day-to-day staffing and Timeline for forward planning;
7. see shared changes update automatically.

For source-code handoff, share the repository or a source ZIP from Lovable/GitHub. The deployed app intentionally does not expose a source-download endpoint.

## Scripts

- `bun dev` — development server
- `bun run build` — production build
- `bun run build:dev` — development-mode build
- `bun run lint` — ESLint
- `bun run format` — Prettier
- `bun run eval:capacity` — run the assistant evaluation harness
