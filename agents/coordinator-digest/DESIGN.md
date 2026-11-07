# Coordinator Weekly Digest — Agent Design (plan P2, DECISIONS D5)

**Status:** scaffolded 2026-11-07 · first AI workflow in Bulldogs OS
**Implementation:** `weekly-digest.ts` (Deno edge function, slug `weekly-digest`)
**Output:** one row in `public.digest_runs` per run, always starting as `status: 'draft'`

> Why this shape: plan P2 asks for "responsible Mistral assistance for *internal*
> task summaries, always human-reviewed; do not send private player profiles to an
> LLM by default". So the LLM never sees player rows — only counts — and its text
> is a draft a human reviews. The club keeps a durable record of every run
> (`digest_runs`) so drafts are auditable and exportable (plan §9).

## 1. Inputs — AGGREGATE counts only, trailing 7 days

Computed server-side by the edge function with `createAdminClient` (project_admin,
bypasses RLS — same pattern as `submit_enquiry`, D3). Only the aggregates below are
ever serialized into the prompt or stored in `input_stats`.

| Stat | Source | Definition |
| --- | --- | --- |
| `new_enquiries` | `enquiries` | count where `created_at >= now() - 7 days` |
| `enquiries_by_stage` | `enquiries` | count grouped by `stage` (in window) |
| `enquiries_by_utm_source` | `enquiries` | count grouped by `utm_source` (null → `"(none)"`) |
| `overdue_open_tasks` | `action_queue` view | count where derived `overdue = true` (due_at < now, state open/attempted) |
| `attempted_within_48h` | `enquiries` + `interactions` | of enquiries in window, how many have a documented interaction within 48 h of `created_at`; reported as `{ eligible, attempted, pct }` (plan §7 primary operating metric) |
| `first_attendance_count` | `attendance` | distinct `person_id` whose **first-ever** attendance (`checked_in_at`) fell in the window (plan §7 primary outcome metric) |
| `notification_jobs_by_status` | `notification_jobs` | count grouped by `status` for jobs created in window (delivery health; queued-only until mailer is approved, D4) |

Reads are column-named and bounded (`.limit(...)`) per the SDK bandwidth rules;
dev scale is tiny, and the caps keep the shape safe as data grows.

## 2. Prompt template

- **System:** "You draft the internal weekly digest for the Denver Bulldogs
  recruitment coordinator. You receive AGGREGATE statistics only — no names,
  emails, or notes. Never invent people, numbers, or events. The draft is reviewed
  by a human before anyone acts on it; nothing is ever sent to a prospect. Write
  plain, volunteer-friendly markdown, max ~250 words."
- **User:** the `input_stats` JSON plus instructions to produce sections:
  `Headline numbers` · `Funnel & SLA` (48 h attempt rate, overdue tasks) ·
  `Outcomes` (first attendances) · `Watch items` (failed/queued notifications) ·
  `Suggested focus for the week` (2–3 concrete, human-actionable items).

## 3. Model choice + fallback

- Primary: **`mistralai/mistral-small-2603`** via the InsForge AI gateway
  (OpenRouter) — Mistral-first per D5, cheap and fast enough for a weekly
  summarization. Override with secret/env `OPENROUTER_DIGEST_MODEL`.
- Fallback chain (tried in order on HTTP error/empty draft):
  `mistralai/mistral-medium-3-5` → `openai/gpt-4o-mini`.
- Model IDs verified against `GET https://openrouter.ai/api/v1/models` on
  2026-11-07.
- **Gateway transports (tried in order per model):**
  1. Direct OpenRouter (`POST https://openrouter.ai/api/v1/chat/completions`,
     shape per `ai/overview.md` + `ai/chat-completions.md`) when the
     `OPENROUTER_API_KEY` secret is present in the function env.
  2. InsForge backend Model Gateway proxy (`POST {baseUrl}/api/ai/chat/completion`
     via the SDK admin client) — the project key stays inside InsForge, so no
     secret copying is needed. This is the default path in this dev project.
- **Graceful degradation:** if every model/transport fails, the function still
  inserts the `digest_runs` row with `input_stats`, `status: 'draft'`,
  `draft: null`, `model: null`, and an explanatory `input_stats.note`.

## 4. Output & human review flow

1. Function inserts into `public.digest_runs`:
   `period_start`, `period_end` (UTC dates of the 7-day window), `model`,
   `input_stats` (JSONB, aggregates only), `draft` (text or null),
   `status: 'draft'`. RLS: readable by staff; writes only via this function's
   admin key.
2. Coordinator opens the admin app, reads the draft, edits if needed, then sets
   `status: 'reviewed'` and `reviewed_by` (a follow-up admin UI action; out of
   scope for this scaffold).
3. `status: 'sent'` exists in the schema for future *internal* distribution —
   requires explicit approval; the agent itself **never sends anything**.

## 5. Schedule proposal — DO NOT RUN YET (deployment needs approval)

Weekly Monday 08:00 America/Denver. InsForge schedules use 5-field cron (no
seconds, no timezone field — evaluated in the scheduler's clock, typically UTC).
08:00 in Denver = **15:00 UTC during MST (early Nov–mid Mar)** and 14:00 UTC
during MDT; verify which clock `schedules` uses, then pick:

```bash
# Proposed (08:00 America/Denver while MST is in effect):
npx -y @insforge/cli schedules create \
  --name "coordinator-weekly-digest" \
  --cron "0 15 * * 1" \
  --url "https://z7nhzchw.us-west.insforge.app/functions/weekly-digest" \
  --method POST \
  --headers '{"Authorization": "Bearer ${{secrets.API_KEY}}"}'
# During daylight saving switch to: --cron "0 14 * * 1"
```

## 6. Safety rules (enforced in code + prompt)

- **Aggregate only:** the prompt and `input_stats` contain counts/rates — never
  names, emails, phones, free-text notes, or row IDs of people. (IDs of
  enquiries are used transiently in memory to compute the 48 h rate but are
  never sent to the model or stored.)
- **No automated sending to prospects:** the function writes only to
  `digest_runs`. It never touches `notification_jobs` and never calls
  `emails.send`.
- **Least privilege at runtime:** admin key used only inside the edge function;
  digest rows are staff-readable via RLS.
- **Synthetic data only in dev** (D7); no real emails are ever sent from this
  project without approval (D4).
- **Auditable:** every run is a `digest_runs` row, so the club owns the history.
