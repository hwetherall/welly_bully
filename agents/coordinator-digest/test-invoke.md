# Testing the coordinator weekly digest

Dev project only (`denver-bulldogs`, us-west). No schedules, no emails, no PII.

## 1. Prerequisites

- AI gateway provisioned (done once): `npx -y @insforge/cli ai setup` → writes
  `OPENROUTER_API_KEY` to `.env.local` and activates the project Model Gateway.
  The edge function uses the **backend gateway proxy** (`/api/ai/chat/completion`
  via the admin client) by default, so no extra secret is required; if you add
  `OPENROUTER_API_KEY` as an InsForge secret, the function calls OpenRouter
  directly instead (documented OpenRouter shape).
- Backend secrets `INSFORGE_BASE_URL`, `API_KEY`, `ANON_KEY` already exist
  (reserved) — the function reads them via `Deno.env.get()`.

## 2. Deploy + invoke

```bash
cd /Users/harry/code/bully-web
npx -y @insforge/cli functions deploy weekly-digest --file agents/coordinator-digest/weekly-digest.ts
npx -y @insforge/cli functions list        # expect weekly-digest, status "active"
npx -y @insforge/cli functions invoke weekly-digest
```

## 3. Expected output shape

```json
{
  "ok": true,
  "digest_run_id": "<uuid>",
  "period": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "model": "mistralai/mistral-small-2603",
  "status": "draft",
  "draft_chars": 800,
  "ai_gateway": "ok",
  "input_stats": {
    "window": { "since": "...", "until": "...", "days": 7 },
    "new_enquiries": 7,
    "enquiries_by_stage": { "...": 0 },
    "enquiries_by_utm_source": { "...": 0 },
    "overdue_open_tasks": 0,
    "attempted_within_48h": { "eligible": 7, "attempted": 0, "pct": 0 },
    "first_attendance_count": 1,
    "notification_jobs_by_status": { "queued": 2 }
  }
}
```

If the gateway is unconfigured/failing, the same shape returns with
`"ai_gateway": "unavailable (draft=null, row kept for human review)"`,
`"model": null`, `"draft_chars": 0`, and `input_stats.note` set — exit code is
still 0 and a `digest_runs` row still exists (graceful degradation).

## 4. Verify the stored row

```bash
npx -y @insforge/cli db query "SELECT id, period_start, period_end, model, status, draft IS NOT NULL AS has_draft, jsonb_pretty(input_stats) FROM public.digest_runs ORDER BY created_at DESC LIMIT 1" --json
```

Expected: one row, `status = 'draft'`, `input_stats` contains only counts
(no names/emails/phones), `has_draft = true` when the gateway works.

## 5. Production schedule — DO NOT RUN without approval

See `DESIGN.md` §5 for the proposed `schedules create` command
(Monday 08:00 America/Denver, POST to `/functions/weekly-digest`).
