// weekly-digest — coordinator weekly digest agent (plan P2, DECISIONS D5).
// WHY: first AI workflow in Bulldogs OS. Aggregates trailing-7-day COUNTS only
// (never names/emails/phones/notes) and asks an LLM via the InsForge AI gateway
// (OpenRouter, Mistral-first) to DRAFT an internal weekly digest. The draft is
// stored in public.digest_runs with status 'draft' for human review. This
// function never sends anything to anyone and never writes player PII to a
// prompt. See DESIGN.md for the full spec.
//
// Deploy:  npx -y @insforge/cli functions deploy weekly-digest --file agents/coordinator-digest/weekly-digest.ts
// Invoke:  npx -y @insforge/cli functions invoke weekly-digest

import { createAdminClient } from 'npm:@insforge/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Model policy: Mistral-first (D5). Primary is cheap/small; fallbacks are tried
// in order. Override the primary with the OPENROUTER_DIGEST_MODEL secret if needed.
const PRIMARY_MODEL = Deno.env.get('OPENROUTER_DIGEST_MODEL') ?? 'mistralai/mistral-small-2603';
const FALLBACK_MODELS = ['mistralai/mistral-medium-3-5', 'openai/gpt-4o-mini'];
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const WINDOW_DAYS = 7;
const MAX_ROWS = 2000; // WHY: bound every list read (SDK bandwidth rules); dev-scale data is tiny

interface InputStats {
  window: { since: string; until: string; days: number };
  new_enquiries: number;
  enquiries_by_stage: Record<string, number>;
  enquiries_by_utm_source: Record<string, number>;
  overdue_open_tasks: number;
  attempted_within_48h: { eligible: number; attempted: number; pct: number | null };
  first_attendance_count: number;
  notification_jobs_by_status: Record<string, number>;
  note?: string;
}

function countBy<T>(rows: T[], key: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// WHY: all reads are column-named and bounded; admin client (project_admin) bypasses
// RLS exactly like submit_enquiry (D3). Only aggregates leave this function.
async function collectStats(admin: ReturnType<typeof createAdminClient>, since: string, until: string): Promise<InputStats> {
  // Enquiries in window — we need id + created_at transiently (in memory only) to
  // compute the 48h attempt rate; ids are never sent to the model or stored.
  const { data: enquiries, error: enqErr } = await admin.database
    .from('enquiries')
    .select('id, created_at, stage, utm_source')
    .gte('created_at', since)
    .lte('created_at', until)
    .limit(MAX_ROWS);
  if (enqErr) throw new Error(`enquiries read failed: ${enqErr.message}`);

  // Overdue open/attempted tasks straight from the action_queue view (derived 'overdue').
  const { count: overdueCount, error: queueErr } = await admin.database
    .from('action_queue')
    .select('task_id', { count: 'exact' })
    .eq('overdue', true)
    .limit(1);
  if (queueErr) throw new Error(`action_queue read failed: ${queueErr.message}`);

  // Documented contact attempts (interactions) — used only to compute the 48h rate.
  const { data: interactions, error: intErr } = await admin.database
    .from('interactions')
    .select('enquiry_id, created_at')
    .gte('created_at', since)
    .not('enquiry_id', 'is', null)
    .limit(MAX_ROWS);
  if (intErr) throw new Error(`interactions read failed: ${intErr.message}`);

  const H48 = 48 * 3600 * 1000;
  let attempted = 0;
  for (const e of enquiries ?? []) {
    const enqAt = new Date(e.created_at as string).getTime();
    const hit = (interactions ?? []).some(
      (i) => i.enquiry_id === e.id && new Date(i.created_at as string).getTime() <= enqAt + H48
    );
    if (hit) attempted++;
  }
  const eligible = (enquiries ?? []).length;

  // First-ever attendances in window: attendance rows in window whose person has no
  // earlier attendance before the window.
  const { data: attNew, error: attErr } = await admin.database
    .from('attendance')
    .select('person_id, checked_in_at')
    .gte('checked_in_at', since)
    .lte('checked_in_at', until)
    .limit(MAX_ROWS);
  if (attErr) throw new Error(`attendance read failed: ${attErr.message}`);
  const { data: attPrior, error: attPriorErr } = await admin.database
    .from('attendance')
    .select('person_id')
    .lt('checked_in_at', since)
    .limit(MAX_ROWS);
  if (attPriorErr) throw new Error(`prior attendance read failed: ${attPriorErr.message}`);
  const hadPrior = new Set((attPrior ?? []).map((a) => a.person_id as string));
  const firstTimers = new Set(
    (attNew ?? []).filter((a) => !hadPrior.has(a.person_id as string)).map((a) => a.person_id as string)
  );

  // Notification delivery health (queue-only until mailer approval, D4).
  const { data: jobs, error: jobsErr } = await admin.database
    .from('notification_jobs')
    .select('status, created_at')
    .gte('created_at', since)
    .lte('created_at', until)
    .limit(MAX_ROWS);
  if (jobsErr) throw new Error(`notification_jobs read failed: ${jobsErr.message}`);

  return {
    window: { since, until, days: WINDOW_DAYS },
    new_enquiries: eligible,
    enquiries_by_stage: countBy(enquiries ?? [], (e) => (e.stage as string) ?? 'unknown'),
    enquiries_by_utm_source: countBy(enquiries ?? [], (e) => (e.utm_source as string) ?? '(none)'),
    overdue_open_tasks: overdueCount ?? 0,
    attempted_within_48h: {
      eligible,
      attempted,
      pct: eligible > 0 ? Math.round((attempted / eligible) * 100) : null,
    },
    first_attendance_count: firstTimers.size,
    notification_jobs_by_status: countBy(jobs ?? [], (j) => (j.status as string) ?? 'unknown'),
  };
}

const SYSTEM_PROMPT = [
  'You draft the internal weekly digest for the Denver Bulldogs recruitment coordinator.',
  'You receive AGGREGATE statistics only — no names, emails, phone numbers, or free-text notes.',
  'Never invent people, numbers, or events; if a stat is missing or null, say so.',
  'The draft is reviewed by a human before anyone acts on it, and nothing is ever sent to a prospect.',
  'Write plain, volunteer-friendly markdown, at most ~250 words.',
].join(' ');

function userPrompt(stats: InputStats): string {
  return [
    `Draft this week's coordinator digest for the Denver Bulldogs from these AGGREGATE stats (trailing ${stats.window.days} days, ${stats.window.since.slice(0, 10)} to ${stats.window.until.slice(0, 10)}):`,
    '',
    '```json',
    JSON.stringify(stats, null, 2),
    '```',
    '',
    'Use exactly these sections:',
    '## Headline numbers',
    '## Funnel & 48h SLA  (new enquiries, % attempted within 48h, overdue open tasks)',
    '## Outcomes  (first training attendances this week)',
    '## Watch items  (queued/failed notification jobs)',
    '## Suggested focus for the week  (2-3 concrete, human-actionable items for volunteers)',
  ].join('\n');
}

// Transport 1 — direct OpenRouter call (shape per skill docs ai/overview.md +
// ai/chat-completions.md), used when the OPENROUTER_API_KEY secret is present.
async function draftViaOpenRouter(
  model: string,
  stats: InputStats
): Promise<{ draft: string; model: string } | null> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) return null;
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // OpenRouter ranking headers (optional, harmless if ignored):
      'HTTP-Referer': 'https://github.com/denver-bulldogs/bulldogs-os',
      'X-Title': 'Bulldogs OS coordinator digest',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(stats) },
      ],
      max_tokens: 800,
      temperature: 0.3,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const draft = body?.choices?.[0]?.message?.content;
  if (!draft || typeof draft !== 'string') return null;
  return { draft, model: body?.model ?? model };
}

// Transport 2 — InsForge backend Model Gateway proxy (POST /api/ai/chat/completion).
// WHY: the project OpenRouter key is managed by InsForge and never needs to be
// copied into a function secret; the admin client authenticates with API_KEY.
async function draftViaBackendGateway(
  admin: ReturnType<typeof createAdminClient>,
  model: string,
  stats: InputStats
): Promise<{ draft: string; model: string } | null> {
  const completion = await admin.ai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt(stats) },
    ],
    temperature: 0.3,
    maxTokens: 800,
  });
  const draft = completion?.choices?.[0]?.message?.content;
  if (!draft || typeof draft !== 'string') return null;
  return { draft, model: (completion as { model?: string }).model ?? model };
}

// WHY: graceful degradation — try each model on each available transport; if all
// fail, the caller still stores the run with draft=null for a human to write.
async function generateDraft(
  admin: ReturnType<typeof createAdminClient>,
  stats: InputStats
): Promise<{ draft: string | null; model: string | null; note?: string }> {
  const hasKey = Boolean(Deno.env.get('OPENROUTER_API_KEY'));
  for (const model of [PRIMARY_MODEL, ...FALLBACK_MODELS]) {
    const transports: Array<() => Promise<{ draft: string; model: string } | null>> = [];
    if (hasKey) transports.push(() => draftViaOpenRouter(model, stats));
    transports.push(() => draftViaBackendGateway(admin, model, stats));
    for (const attempt of transports) {
      try {
        const result = await attempt();
        if (result) return result;
      } catch (err) {
        console.error(`model ${model} failed:`, (err as Error).message); // try next transport/model
      }
    }
  }
  return { draft: null, model: null, note: 'AI gateway unavailable (no key and backend proxy failed); human-written digest required' };
}

export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const baseUrl = Deno.env.get('INSFORGE_BASE_URL');
    const apiKey = Deno.env.get('API_KEY');
    if (!baseUrl || !apiKey) {
      return new Response(JSON.stringify({ error: 'INSFORGE_BASE_URL / API_KEY secrets missing' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // WHY: admin client = project_admin, bypasses RLS; needed to read staff-only
    // tables and to insert into digest_runs (revoked from authenticated, D3).
    const admin = createAdminClient({ baseUrl, apiKey });

    const until = new Date();
    const since = new Date(until.getTime() - WINDOW_DAYS * 24 * 3600 * 1000);
    const periodStart = since.toISOString().slice(0, 10);
    const periodEnd = until.toISOString().slice(0, 10);

    const stats = await collectStats(admin, since.toISOString(), until.toISOString());
    const gen = await generateDraft(admin, stats);
    if (gen.note) stats.note = gen.note; // WHY: note lives inside input_stats JSONB (no schema change needed)

    // WHY: durable, auditable record of every run; status 'draft' = human review required.
    const { data: inserted, error: insErr } = await admin.database
      .from('digest_runs')
      .insert([{
        period_start: periodStart,
        period_end: periodEnd,
        model: gen.model,
        input_stats: stats,
        draft: gen.draft,
        status: 'draft',
      }])
      .select();
    if (insErr) throw new Error(`digest_runs insert failed: ${insErr.message}`);

    const row = inserted?.[0];
    return new Response(
      JSON.stringify({
        ok: true,
        digest_run_id: row?.id ?? null,
        period: { start: periodStart, end: periodEnd },
        model: gen.model,
        status: 'draft',
        draft_chars: gen.draft ? gen.draft.length : 0,
        ai_gateway: gen.draft ? 'ok' : 'unavailable (draft=null, row kept for human review)',
        input_stats: stats,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('weekly-digest failed:', err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
