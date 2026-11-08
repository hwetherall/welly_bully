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

## D9 — Keys & env contract
- **Date:** 2026-11-07
- **Decision:** All keys live in gitignored root `.env.local`: `NEXT_PUBLIC_INSFORGE_URL`, `NEXT_PUBLIC_INSFORGE_ANON_KEY`, `INSFORGE_API_KEY` (server-only scripts/tests), `VIBE_API_KEY` (Mistral), `OPENROUTER_API_KEY` (server-only; provisioned via `npx -y @insforge/cli ai setup`). Frontend reads `VITE_INSFORGE_URL` / `VITE_INSFORGE_ANON_KEY` from `app/.env.local` (same values, Vite prefix). Edge functions read project **secrets** (`INSFORGE_BASE_URL`, `API_KEY`, `ANON_KEY`) via `Deno.env` — never copy raw keys into function code. AI inference in functions uses the backend Model Gateway (`admin.ai.chat.completions`) so the OpenRouter key never needs to be copied into function secrets.

## D10 — Hosting: InsForge for V1; Mistral Studio Apps = paid production upgrade path (pending Harry's confirmation)
- **Date:** 2026-11-08
- **Research (docs.mistral.ai/studio/apps + pricing coverage, Nov 2026):** Studio **Apps** scaffolds an app from presets — the `app` preset is TanStack Start frontend + FastAPI API + Postgres + workflow worker — run locally via `mistral dev` (Docker + MISTRAL_API_KEY), deployed by pushing to GitHub and `mistral deploy`. Studio provides hosting, auth, access control; agents/workflows/evals are first-class. **Entitlement:** "Your organization's plan must include Apps: on the Free plan, or Pro and Team without pay-as-you-go, you can see the deployment commands but can't create apps." Hosted deployments require the **pay-as-you-go or Enterprise plan** (public preview, quota-capped). No free tier for hosted Apps. (Could not be verified from the agent sandbox — outbound calls to api.mistral.ai are blocked; Harry to confirm org entitlement locally: `curl -H "Authorization: Bearer $VIBE_API_KEY" https://api.mistral.ai/v1/organizations/me`.)
- **Cost estimate (assumptions, not published prices):** Studio doesn't publish a standalone Apps price; it's metered PAYG. Low-traffic V1 (small compute + small Postgres + modest bandwidth) ≈ **$15–40/mo compute/hosting**, plus model tokens (weekly digest on mistral-small ≈ negligible; any chat features dominate — roughly $0.10–0.50 per 1M tokens) ≈ **$1–5/mo** → **total ≈ $30–80/mo**, vs **$0** on InsForge hobby plan. Enterprise is negotiated. Pro ($14.99/mo, $15 credits) is a console floor, not an Apps entitlement.
- **Decision (recommended):** V1 stays on **InsForge** (free hobby, us-west, familiar, already green). Code is portable by design (plain Postgres schema/SQL RPCs; React SPA; 4 edge functions ≈ FastAPI endpoints; digest agent ≈ Studio managed agent). If the club approves budget later, enable PAYG on the Mistral org and redeploy via `mistral deploy`; the digest agent is the first thing to port to a native Studio agent (best Mistral-native artifact for the film, alongside Vibe-built code + Mistral models in the gateway).
- **Data residency note:** Mistral hosts in the EU (GDPR/EU AI Act); InsForge project is us-west — deliberate choice for a Denver club's US player data.

## D11 — Advisor scan results and accepted risks (2026-11-08)
- **Fixed (migrations 9-10):** EXECUTE on all 18 app SECURITY DEFINER functions revoked from `PUBLIC`/`anon` (`submit_enquiry` is owner-only — intake goes through the edge function's admin key; role helpers remain `authenticated`-executable because RLS policies call them as the querying user). 24 FK/RLS indexes added. Advisor criticals: 36 → 0.
- **Accepted (intentional, left visible — not suppressed):** 17 `dangerous-function` warnings for SECURITY DEFINER RPCs callable by `authenticated` — every one self-checks permissions via `auth.uid()` and raises for unauthorized callers (tested in crm/import/calendar suites); `rls-select-only` on people/seasons/digest_runs — writes intentionally go through functions only; `rls-permissive` on roles/seasons/user_roles — non-sensitive reference data readable by club users by design; `unused-index` info items are expected on a low-traffic dev DB.

## Open (mirrors plan §12, block production only)
Existing site/domain, calendar source of truth, volunteer roster, sending email identity, historic rosters, club permission sign-off, hosting budget, pilot team — all pending committee answers. Defaults in plan §12 apply.
