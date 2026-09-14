# Team Capacity Hub

A small shared staffing board for a consulting team. It shows who has capacity, what demand is coming in, and who is allocated where without turning into a full resource-management system.

## What it does

- Shared consultant roster backed by Postgres/Supabase.
- Email/password sign-up and sign-in.
- First-login **Join the team** flow so colleagues add themselves before using the staffing board, or claim an existing roster entry with the same email.
- Consultant fields: name, email, level, role, skills/topics, working capacity.
- Demand fields: project/topic/RfP, client, dates, required effort, skills/topics, status and notes.
- Drag a consultant onto a demand to open the allocation dialog and choose the allocation percentage.
- Date-aware capacity: the board can show availability for a selected date and only counts active/committed demands whose dates overlap it.
- Over-allocation warnings without blocking intentional exceptions.
- Shared changes arrive immediately through Supabase Realtime, with 15-second polling and window-focus refresh as a fallback.
- **Insights** focused on actionable staffing issues: utilization, free capacity, overbooking, unstaffed demand and status distribution.

## Simple permission model

This version intentionally keeps permissions minimal:

- unauthenticated visitors cannot read or write team data;
- any authenticated user can view and edit the shared roster, demands and allocations;
- there is no admin/invite hierarchy yet.

That is appropriate for a small trusted team. If this becomes a larger or sensitive production system, add organization membership and role-based policies before storing sensitive staffing/client data.

## Data model

The database has three core tables:

- `consultants` — profile, skills, working capacity, optional linked auth user.
- `demands` — project/topic/RfP details, status, dates, required effort and skills/topics.
- `allocations` — consultant ↔ demand with a percentage allocation.

The UI uses simpler status labels without changing the stored values: **Pipeline**, **Confirmed**, **Active**, and **Closed**. Confirmed and Active work reserve capacity; Pipeline and Closed do not.

`allocations` are separate records rather than embedded inside a demand, which keeps staffing data consistent and queryable. Row-level security is enabled; only the authenticated role has CRUD privileges.

## Tech stack

- TanStack Start + React + TypeScript
- TanStack Query
- Supabase/Postgres + Supabase Auth
- Tailwind CSS v4 + shadcn/ui/Radix
- Recharts

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

Then open `http://localhost:8080`.

## Database setup outside the existing Lovable project

The original Lovable project already has its Supabase database provisioned. For a new Supabase project, apply both migrations in order:

```text
drizzle/migrations/0000_collaboration_foundation.sql
drizzle/migrations/0001_usability_and_realtime.sql
```

The second migration adds demand skills and publishes the three shared tables to `supabase_realtime` when that publication is available.

Then place that project's public URL and publishable key in `.env`.

Do **not** put a Supabase service-role/secret key into frontend environment variables.

## Sharing with the team

For the existing hosted project, share the deployed app URL. A colleague can:

1. create an account;
2. confirm their email if the Supabase project requires confirmation;
3. after sign-in they are sent directly to **Join the team**;
4. add themselves to the roster, or claim a pre-created team profile with the same email;
5. return to the Board, where shared changes update automatically.

For source-code handoff, share the repository or a source ZIP from Lovable/GitHub. The deployed app intentionally does not expose a source-download endpoint.

## Scripts

- `bun dev` — development server
- `bun run build` — production build
- `bun run build:dev` — development-mode build
- `bun run lint` — ESLint
- `bun run format` — Prettier
