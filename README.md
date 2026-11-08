# Denver Bulldogs — Bulldogs OS (welly_bully)

Recruitment & retention operating system for the Denver Bulldogs Australian Rules Football Club.
Product source of truth: [`plan.md`](./plan.md). Architecture decisions: [`DECISIONS.md`](./DECISIONS.md). Task board: [`TASKS.md`](./TASKS.md).

## Stack

- **Backend:** InsForge project `denver-bulldogs` (Postgres + auth + edge functions + AI gateway + schedules). Linked at repo root (`.insforge/project.json`, gitignored). Manage via `npx -y @insforge/cli ...` (see the `insforge-cli` skill).
- **Frontend:** `app/` — Vite + React + TanStack Router + Tailwind 3.4, uses `@insforge/sdk`.
- **Edge functions:** `functions/` — deployed with `npx -y @insforge/cli functions deploy <slug> --file <path>`.
- **Agents / AI workflows:** `agents/` — e.g. the coordinator weekly digest (scheduled edge function + InsForge AI gateway).
- **Data:** `migrations/` (schema + RLS, applied with `db migrations up --all`), `seeds/` (synthetic test data only).

## Run (dev)

```bash
# 1. Backend is already linked at repo root. Inspect it:
npx -y @insforge/cli current

# 2. Apply schema + seed synthetic data (idempotent-ish; safe on fresh project):
npx -y @insforge/cli db migrations up --all
# seeds are applied by seeds/seed_synthetic.sql via `db query` (see TASKS.md)

# 3. Frontend:
cd app
cp .env.example .env        # fill VITE_INSFORGE_URL / VITE_INSFORGE_ANON_KEY (values in ../.env.local)
npm install
npm run dev
```

## Test

```bash
# WF-01 workflow tests (requires deployed submit-enquiry function):
cd app && npm test          # frontend unit tests
node tests/wf01.test.mjs    # enquiry flow: happy path, idempotency, validation, rate limit, anon invoke, alert
node tests/mailer.test.mjs  # notification queue worker (dry-run drain, audit)
node tests/crm.test.mjs     # Sprint 2 CRM RPCs with signed-in dev users (permissions, reassign, stats)
node tests/import.test.mjs  # Sprint 3 roster import preview/confirm + returning-player reconciliation

# Drain the notification queue manually (dry-run unless EMAIL_DRY_RUN=false is approved):
npx -y @insforge/cli functions invoke process-notification-jobs --method POST
```

## Safety rules (from plan §13)

No deployment, domain change, real email send, real personal-data import, or external integration without explicit approval from Harry/club committee. Synthetic data only until then.
