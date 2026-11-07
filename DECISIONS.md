# DECISIONS.md — Bulldogs OS architecture decision record

Living record of architecture tradeoffs (per `plan.md` §11). Newest last. Each entry: decision, date, context, alternatives rejected, consequences.

## D1 — Backend: InsForge (plan's sanctioned fallback), not Mistral Studio Apps
- **Date:** 2026-11-07
- **Decision:** Build the backend on **InsForge** (Postgres + PostgREST + auth + edge functions + AI gateway + schedules), project `denver-bulldogs` (us-west), linked at repo root via `.insforge/project.json`.
- **Context:** `plan.md` §8 prefers a Mistral Studio App (TanStack Start + FastAPI + PostgreSQL) on Mistral Cloud. Mistral Studio Apps is **not available in this build environment** (no Studio Apps CLI/API access from the agent sandbox), so we take the plan's explicit fallback: "retain the frontend/API/database design and deploy to a conventional provider (e.g. InsForge)". Mistral remains (a) the coding agent (Vibe) and (b) the inference provider via the InsForge AI gateway (OpenRouter, which includes Mistral models).
- **Alternatives rejected:** FastAPI + separate Postgres host (more moving parts to operate for a volunteer club); Firebase (less exportable, plan prefers Postgres).
- **Consequences:** Schema is plain Postgres in `public` — exportable and portable. Core business logic lives in SQL RPC + edge functions, not platform-specific code. If Studio Apps becomes available, only the hosting layer changes.

## D2 — Frontend: Vite + React + TanStack Router SPA in `app/`
- **Date:** 2026-11-07
- **Decision:** Public site + admin app as one Vite/React SPA with TanStack Router (file-based routes), Tailwind CSS v3.4, `@insforge/sdk` client. Separate authorization boundaries: public routes vs `/admin/*` gated by InsForge auth + role checks.
- **Alternatives rejected:** TanStack Start full-stack (needs its own server runtime; InsForge edge functions already provide the server layer); Next.js (heavier, SSR not needed for V1).
- **Consequences:** `vercel.json`/SPA fallback for deployments; deploy via `insforge deployments deploy` later **with explicit approval** (plan §13).

## D3 — Data access: edge functions + SQL RPC for writes; RLS for reads
- **Date:** 2026-11-07
- **Decision:** Anonymous visitors get **no direct table writes**; signup flows through edge function `submit-enquiry` (API key = project_admin, bypasses RLS) which validates, rate-limits, and calls SQL RPC `public.submit_enquiry(...)` for an **atomic** create of person + enquiry + task + audit + notification_job. `anon` role gets `SELECT` only on published public `events`. All other tables: `authenticated` + RLS policies using `SECURITY DEFINER` role helpers (`public.has_role`, `public.assigned_to_me`).
- **Consequences:** PII never writable anonymously; idempotency via unique `enquiries.idempotency_key`; rate limiting via `ip_hash` count. Defense in depth per InsForge access-control reference (no recursive RLS; helpers pinned `SET search_path = pg_catalog, public, pg_temp`).

## D4 — Email: queue-only in code; no real sends without approval
- **Date:** 2026-11-07
- **Decision:** Confirmation emails are rows in `notification_jobs` (status `queued`, unique idempotency key). A mailer edge function (Sprint 1) will send via `insforge.emails` — **only after committee approval and provider/domain setup**. In dev, delivery is simulated/logged. Plan §13: no real messaging without explicit approval.

## D5 — AI workflows: InsForge AI gateway (OpenRouter incl. Mistral models), aggregate data only
- **Date:** 2026-11-07
- **Decision:** First AI workflow = internal **coordinator weekly digest** agent (`agents/coordinator-digest/`): scheduled InsForge edge function that aggregates counts (no PII) from the action queue and asks an LLM (Mistral via OpenRouter gateway) to draft a human-reviewed digest stored in `digest_runs`. **No private player profiles are sent to any LLM by default** (plan P2/§9). Dev-loop subagents (system-analyst / code guardian / product-counsel patterns from `pm/`) are used to build, not to touch player data.
- **Alternatives noted:** Google ADK agent (skills available) as a separate learning artifact/deployment path later; not a V1 dependency.

## D6 — Calendar: Bulldogs OS `events` table is the single authoritative source
- **Date:** 2026-11-07
- **Decision:** Per plan §12 default: one authoritative event source inside the app (existing club calendar source unknown). Public `.ics` feed + change workflow land in Sprint 4 (P1). Timezone `America/Denver` stored per event.

## D7 — Data: synthetic only until committee approves imports
- **Date:** 2026-11-07
- **Decision:** Sprint 0 seeds synthetic people/enquiries/events only (`seeds/`). No real personal data, no real emails, no production domain changes. Two synthetic admin/volunteer auth users for dev role access.

## D8 — Source layout
- **Date:** 2026-11-07
- **Decision:** Monorepo-lite at repo root: `plan.md`, `DECISIONS.md`, `TASKS.md`, `migrations/` (InsForge CLI), `seeds/`, `functions/` (edge function source), `app/` (Vite frontend), `agents/` (AI workflow agents), `tests/`, `pm/` (PM workflow templates).

## Open (mirrors plan §12, block production only)
Existing site/domain, calendar source of truth, volunteer roster, sending email identity, historic rosters, club permission sign-off, hosting budget, pilot team — all pending committee answers. Defaults in plan §12 apply.
