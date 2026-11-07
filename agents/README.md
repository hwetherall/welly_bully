# Bulldogs OS — AI Agent Catalog

This directory owns every AI-powered workflow in Bulldogs OS. Rule of thumb from
`plan.md` §4 (P2) and `DECISIONS.md` D5: **AI assists internal humans; it never
touches player PII and never contacts a prospect automatically.** Every agent
output is a draft that a human reviews before any use.

## How the agents here map to Mistral offerings

| Mistral offering | Role in Bulldogs OS | Where it shows up |
| --- | --- | --- |
| **Mistral Vibe (coding agent)** | Builds and reviews the code in this repo (build/review loops, refactors, test runs). It is a development tool, not a runtime component, and never sees player data. | This repo's build process; `pm/` workflow templates |
| **InsForge AI gateway = OpenRouter (incl. Mistral models)** | Runtime inference **inside** server-side workflows. The edge function calls `https://openrouter.ai/api/v1/chat/completions` with the project key (`OPENROUTER_API_KEY`, provisioned via `npx -y @insforge/cli ai setup`, stored as an InsForge secret). Mistral-first model policy per D5. | `agents/coordinator-digest/weekly-digest.ts` |
| **Mistral Studio Apps / Google ADK** | Later deployment options for packaged agents (per `DECISIONS.md` D1/D5): Studio Apps if it becomes available for this account; Google ADK as a separate learning artifact. Not a V1 dependency. | Future; see `DECISIONS.md` |

## Catalog

| Agent | Path | What it does | Data policy | Status |
| --- | --- | --- | --- | --- |
| **Coordinator weekly digest** | `agents/coordinator-digest/` | Weekly (proposed Mon 08:00 America/Denver) edge function that aggregates trailing-7-day counts from `action_queue` / `enquiries` / `tasks` / `notification_jobs` / `attendance` and drafts a human-reviewed digest row in `public.digest_runs` (`status: 'draft'`). | **Aggregate counts only.** No names, emails, phones, or free-text notes ever reach the LLM. No automated sending to prospects — the digest goes to the internal coordinator only, after human review. | Scaffolded; see `coordinator-digest/DESIGN.md` and `test-invoke.md` |

## Standing safety rules for every agent in this directory

1. **Aggregate-only inputs to any LLM.** Counts, rates, and bucketed stats — never
   row-level player data. If a future agent needs row-level context, it must be
   explicitly approved and documented in its DESIGN.md first.
2. **Human-reviewed outputs.** Agent output lands in a `*_runs`-style table with
   `status: 'draft'`. A human sets `reviewed_by` / moves status. Nothing is sent,
   published, or shown to prospects automatically.
3. **No real outreach.** No emails, SMS, WhatsApp, or drip campaigns from agents
   (plan §4 principle 6, D4).
4. **Synthetic data only in dev** (D7). Never load real personal data into a dev
   agent run.
5. **Secrets stay server-side.** `OPENROUTER_API_KEY`, `API_KEY` etc. live in
   InsForge secrets and are read via `Deno.env.get()` inside edge functions — never
   in frontend code or committed files.
6. **Graceful degradation.** If the AI gateway is unconfigured or fails, the agent
   still records its run (with input stats) and leaves `draft = null` for a human.
