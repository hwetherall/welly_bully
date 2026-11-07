// functions/process-notification-jobs.ts — notification queue worker (plan P0.3/P0.4, D4).
//
// Drains public.notification_jobs rows with status 'queued' (confirmation emails to
// prospects + internal_alert rows to volunteers). Real delivery goes through
// insforge.emails (transactional). Until the club approves a sending identity/domain,
// EMAIL_DRY_RUN=true (default) marks jobs 'dry_run' WITHOUT sending — the queue still
// drains so delivery status stays visible in the admin app.
//
// Retry policy: on error, attempts+1; back to 'queued' until attempts >= 3, then 'failed'
// (failed jobs stay visible — never silently dropped, plan WF-01.7).
//
// Deploy: npx -y @insforge/cli functions deploy process-notification-jobs --file functions/process-notification-jobs.ts
// Invoke: npx -y @insforge/cli functions invoke process-notification-jobs --method POST

import { createAdminClient } from 'npm:@insforge/sdk';

const BATCH = 25;
const MAX_ATTEMPTS = 3;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const baseUrl = Deno.env.get('INSFORGE_BASE_URL');
  const apiKey = Deno.env.get('API_KEY');
  if (!baseUrl || !apiKey) return json({ error: 'secrets missing' }, 500);

  // WHY default true: no real email without explicit approval (plan §13 / DECISIONS D4).
  const dryRun = (Deno.env.get('EMAIL_DRY_RUN') ?? 'true') !== 'false';
  const admin = createAdminClient({ baseUrl, apiKey });

  const { data: jobs, error: qErr } = await admin.database
    .from('notification_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(BATCH);
  if (qErr) return json({ error: 'queue_read_failed', message: qErr.message }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const job of jobs ?? []) {
    const attempts = (job.attempts ?? 0) + 1;
    let patch: Record<string, unknown> = { attempts };

    if (dryRun) {
      // Rendered but NOT sent — visible in admin as 'dry_run'.
      patch = { ...patch, status: 'dry_run', last_error: 'dry-run: EMAIL_DRY_RUN=true, content not sent' };
    } else {
      try {
        const { error: sendErr } = await admin.emails.send({
          to: job.to_email,
          subject: job.subject,
          html: `<pre style="font-family:inherit;white-space:pre-wrap">${job.body}</pre>`,
        });
        if (sendErr) throw new Error(sendErr.message);
        patch = { ...patch, status: 'sent', sent_at: new Date().toISOString(), last_error: null };
      } catch (err) {
        patch = {
          ...patch,
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'queued',
          last_error: String((err as Error).message).slice(0, 500),
        };
      }
    }

    const { error: upErr } = await admin.database
      .from('notification_jobs')
      .update(patch)
      .eq('id', job.id);
    if (upErr) {
      results.push({ id: job.id, ok: false, error: upErr.message });
      continue;
    }
    await admin.database.from('audit_events').insert([{
      actor_id: null,
      action: 'notification.processed',
      table_name: 'notification_jobs',
      record_id: job.id,
      after: patch,
    }]);
    results.push({ id: job.id, type: job.type, to: job.to_email, status: patch.status, attempts });
  }

  return json({ ok: true, dry_run: dryRun, processed: results.length, results });
}
