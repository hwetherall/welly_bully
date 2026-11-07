// functions/submit-enquiry.ts — WF-01 server side (plan.md §5, P0.2).
//
// WHY an edge function: anonymous visitors must never write tables directly
// (DECISIONS.md D3). This function validates + rate-limits the public form POST,
// then delegates the atomic write (person + enquiry + 48h task + notification
// job + audit) to RPC public.submit_enquiry using the project-admin API key,
// which bypasses RLS. Idempotency is enforced by enquiries.idempotency_key.
//
// Deploy: npx -y @insforge/cli functions deploy submit-enquiry --file functions/submit-enquiry.ts
// Invoke: POST {INSFORGE_BASE_URL}/functions/submit-enquiry  (public, no auth)
//
// Synthetic/dev use only — never point real personal data at this dev project.

import { createAdminClient } from 'npm:@insforge/sdk';

// Rate limit: max enquiries per ip_hash per rolling hour (plan §8 anti-abuse).
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const PATHWAYS = new Set(['mens', 'womens', 'mixed', 'social', 'volunteer']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function corsHeaders(): Record<string, string> {
  return {
    // Browser origin allow-list; tighten via ALLOWED_ORIGIN secret before launch.
    'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

// ip_hash = sha256(ip + API_KEY): never store the raw IP (schema comment on enquiries.ip_hash).
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

type Body = Record<string, unknown>;

// Optional string field: must be a string within maxLen when present.
function optString(body: Body, key: string, maxLen: number): { value: string | null; error?: string } {
  const v = body[key];
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== 'string' || v.length > maxLen) return { value: null, error: `${key}_invalid` };
  const trimmed = v.trim();
  return { value: trimmed === '' ? null : trimmed };
}

// Server-side validation (plan §8). Returns cleaned fields or a 400 error code.
function validate(body: Body): { fields: Record<string, unknown>; error?: string } {
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  if (!firstName) return { fields: {}, error: 'first_name_required' };
  if (firstName.length > 80) return { fields: {}, error: 'first_name_too_long' };

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) return { fields: {}, error: 'email_required' };
  if (email.length > 255 || !EMAIL_RE.test(email)) return { fields: {}, error: 'email_invalid' };

  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  if (!phone) return { fields: {}, error: 'phone_required' };
  if (phone.length < 6 || phone.length > 30) return { fields: {}, error: 'phone_invalid' };

  // Consent to be contacted is mandatory and must be an explicit boolean true (plan §9).
  if (body.consent !== true) return { fields: {}, error: 'consent_required' };

  let idempotencyKey = body.idempotencyKey;
  if (idempotencyKey === undefined || idempotencyKey === null || idempotencyKey === '') {
    idempotencyKey = crypto.randomUUID(); // one key per client submit attempt (plan WF-01)
  } else if (typeof idempotencyKey !== 'string' || idempotencyKey.length > 128) {
    return { fields: {}, error: 'idempotency_key_invalid' };
  }

  const pathway = body.pathway;
  if (pathway !== undefined && pathway !== null && !PATHWAYS.has(pathway as string)) {
    return { fields: {}, error: 'pathway_invalid' };
  }

  const preferredEventId = body.preferredEventId;
  if (preferredEventId !== undefined && preferredEventId !== null &&
      (typeof preferredEventId !== 'string' || !UUID_RE.test(preferredEventId))) {
    return { fields: {}, error: 'preferred_event_id_invalid' };
  }

  const opt: Record<string, string | null> = {};
  for (const [key, maxLen] of Object.entries({
    lastName: 80, experience: 500, questions: 2000, howHeard: 200,
    landingUrl: 2000, referrer: 2000, utmSource: 200, utmMedium: 200, utmCampaign: 200,
  })) {
    const r = optString(body, key, maxLen);
    if (r.error) return { fields: {}, error: r.error };
    opt[key] = r.value;
  }

  return {
    fields: {
      firstName, email, phone, idempotencyKey,
      pathway: (pathway as string) ?? null,
      preferredEventId: (preferredEventId as string) ?? null,
      ...opt,
    },
  };
}

export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  try {
    let body: Body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ error: 'invalid_body' }, 400);
    }

    // Honeypot: bots fill "company"; answer 200 fake-ok so they learn nothing.
    if (body.company) {
      return json({ ok: true, fake: true }, 200);
    }

    const { fields, error } = validate(body);
    if (error) return json({ error }, 400);
    const f = fields;

    const admin = createAdminClient({
      baseUrl: Deno.env.get('INSFORGE_BASE_URL')!,
      apiKey: Deno.env.get('API_KEY')!,
    });

    // Rate limit by hashed client IP over the last hour.
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    const ipHash = await sha256Hex(ip + (Deno.env.get('API_KEY') ?? ''));
    const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { data: recent, error: rlError } = await admin.database
      .from('enquiries')
      .select('id')
      .eq('ip_hash', ipHash)
      .gt('created_at', cutoff)
      .limit(RATE_LIMIT_MAX);
    if (rlError) return json({ error: 'rate_limit_check_failed', message: rlError.message }, 500);
    if ((recent ?? []).length >= RATE_LIMIT_MAX) {
      return json({ error: 'rate_limited' }, 429);
    }

    // Current season: prefer the latest-starting non-closed season; fall back to latest overall.
    const { data: seasons, error: seasonErr } = await admin.database
      .from('seasons')
      .select('id, year, starts_on, ends_on, state');
    if (seasonErr) return json({ error: 'season_lookup_failed', message: seasonErr.message }, 500);
    const open = (seasons ?? []).filter((s: { state: string }) => s.state !== 'closed');
    const pool = open.length > 0 ? open : (seasons ?? []);
    if (pool.length === 0) return json({ error: 'no_season' }, 500);
    pool.sort((a: { starts_on: string }, b: { starts_on: string }) => b.starts_on.localeCompare(a.starts_on));
    const season = pool[0];

    // Atomic WF-01 write via SQL RPC (idempotent on p_idempotency_key).
    const answers: Record<string, unknown> = {};
    if (f.preferredEventId) answers.preferredEventId = f.preferredEventId;
    if (f.experience) answers.experience = f.experience;
    if (f.pathway) answers.pathway = f.pathway;
    if (f.questions) answers.questions = f.questions;

    const { data: rpcData, error: rpcError } = await admin.database.rpc('submit_enquiry', {
      p_idempotency_key: f.idempotencyKey,
      p_first_name: f.firstName,
      p_last_name: f.lastName,
      p_email: f.email,
      p_phone: f.phone,
      p_consent: true,
      p_source: f.howHeard,
      p_landing_url: f.landingUrl,
      p_referrer: f.referrer ?? req.headers.get('referer'),
      p_utm_source: f.utmSource,
      p_utm_medium: f.utmMedium,
      p_utm_campaign: f.utmCampaign,
      p_answers: answers,
      p_ip_hash: ipHash,
      p_user_agent: (req.headers.get('user-agent') ?? '').slice(0, 512) || null,
      p_season_id: season.id,
    });
    if (rpcError) return json({ error: 'submit_failed', message: rpcError.message }, 500);

    // P0.4: internal alert to the assigned volunteer (never a message to the prospect).
    // Idempotent per enquiry so duplicate submissions don't re-alert.
    const rpc = rpcData as Record<string, unknown>;
    if (rpc?.assigned_to && rpc?.duplicate !== true) {
      const { data: member } = await admin.database
        .from('club_members')
        .select('email')
        .eq('id', rpc.assigned_to)
        .limit(1);
      if (member && member.length > 0) {
        await admin.database.from('notification_jobs').insert([{
          type: 'internal_alert',
          person_id: rpc.person_id,
          enquiry_id: rpc.enquiry_id,
          to_email: (member[0] as { email: string }).email,
          subject: 'New Bulldogs enquiry assigned to you — call within 48h',
          body: `A new enquiry (${String(rpc.person_id).slice(0, 8)}…) was assigned to you. Task: make_initial_call, due 48h after receipt. Log in to the admin app to call and log the outcome.`,
          idempotency_key: `alert:${String(rpc.enquiry_id)}`,
        }]);
      }
    }

    // Next published public event for the confirmation page (plan P0.1/P0.2).
    const { data: nextEvents, error: evErr } = await admin.database
      .from('events')
      .select('id,title,venue,venue_url,starts_at,ends_at,time_zone')
      .eq('status', 'published')
      .eq('audience', 'public')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(1);
    if (evErr) return json({ error: 'event_lookup_failed', message: evErr.message }, 500);

    return json({ ...rpc, next_event: nextEvents?.[0] ?? null }, 200);
  } catch (err) {
    return json({ error: 'internal_error', message: String(err) }, 500);
  }
}
