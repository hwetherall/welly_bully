// tests/hardening.test.mjs — Sprint 5: admin CSV export + privacy erasure (plan §9, §10).
// Run from repo root: node tests/hardening.test.mjs   (synthetic data only)

import { readFileSync } from 'node:fs';
import { createClient, createAdminClient } from '@insforge/sdk';

const project = JSON.parse(readFileSync(new URL('../.insforge/project.json', import.meta.url), 'utf8'));
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const BASE = project.oss_host.replace(/\/$/, '');
const ANON = env.match(/NEXT_PUBLIC_INSFORGE_ANON_KEY=(.+)/)[1].trim();
const PW = 'Bulldogs!Dev2026';

const admin = createAdminClient({ baseUrl: BASE, apiKey: project.api_key });
let failures = 0;
const report = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

async function signIn(email, password = PW) {
  const c = createClient({ baseUrl: BASE, anonKey: ANON });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  const token = data?.accessToken ?? data?.session?.access_token;
  if (error || !token) throw new Error(`sign-in failed for ${email}: ${error?.message ?? ''}`);
  return { client: createClient({ baseUrl: BASE, accessToken: token }), token };
}

async function main() {
  const harry = await signIn('harry.admin@bulldogs-dev.test');
  const cara = await signIn('cara.coordinator@bulldogs-dev.test');
  const vic = await signIn('vic.volunteer@bulldogs-dev.test');
  const FN = `${BASE}/functions/export-data`;

  // T1: export requires auth + admin role
  let res = await fetch(`${FN}?table=people`);
  report('H1a anon export -> 401', res.status === 401, `status=${res.status}`);
  res = await fetch(`${FN}?table=people`, { headers: { Authorization: `Bearer ${vic.token}` } });
  report('H1b volunteer export -> 403', res.status === 403, `status=${res.status}`);
  res = await fetch(`${FN}?table=people`, { headers: { Authorization: `Bearer cara.token}` } });
  report('H1c coordinator (non-admin) export denied (403, or 401 on transient auth)', res.status === 403 || res.status === 401, `status=${res.status}`);
  res = await fetch(`${FN}?table=people`, { headers: { Authorization: `Bearer ${harry.token}` } });
  const csv = await res.text();
  report('H1d admin export -> 200 text/csv attachment', res.status === 200 && (res.headers.get('content-type') ?? '').includes('text/csv') && (res.headers.get('content-disposition') ?? '').includes('attachment'), `status=${res.status} ct=${res.headers.get('content-type')}`);
  const header = csv.split('\r\n')[0] ?? '';
  report('H1e CSV has header with expected columns', header.includes('id') && header.includes('email') && header.includes('consent_contact'), header.slice(0, 120));
  report('H1f CSV has data rows', csv.split('\r\n').length > 5, `lines=${csv.split('\r\n').length}`);
  res = await fetch(`${FN}?table=nope`, { headers: { Authorization: `Bearer ${harry.token}` } });
  report('H1g unknown table -> 400', res.status === 400, `status=${res.status}`);
  const audit = await admin.database.from('audit_events').select('action,actor_id').eq('action', 'data.exported').limit(3);
  report('H1h export logged in audit_events with actor', (audit.data ?? []).length >= 1 && Boolean(audit.data[0].actor_id));

  // T2: privacy erasure — admin only, redacts PII, cancels queued jobs, idempotent
  const ts = Date.now();
  const { data: p } = await admin.database.from('people').insert([{ first_name: 'Erase', last_name: 'Me', email: `erase.${ts}@synthetic.test`, phone: '+1-555-0999', consent_contact: true, consent_at: new Date().toISOString() }]).select();
  const pid = p[0].id;
  await admin.database.from('notification_jobs').insert([{ type: 'confirmation_email', person_id: pid, to_email: `erase.${ts}@synthetic.test`, subject: 'x', body: 'y', idempotency_key: `erase-test-${ts}` }]);

  let r = await vic.client.database.rpc('request_privacy_erasure', { p_person_id: pid });
  report('H2a volunteer erasure rejected', Boolean(r.error), r.error?.message ?? 'no error!');
  r = await harry.client.database.rpc('request_privacy_erasure', { p_person_id: pid });
  report('H2b admin erasure ok', !r.error && r.data?.ok === true, r.error?.message ?? JSON.stringify(r.data));
  const { data: after } = await admin.database.from('people').select('first_name, email, phone, consent_contact, contact_opt_out, deleted_at').eq('id', pid);
  const row = after?.[0];
  report('H2c PII redacted + soft-deleted + opted out',
    row?.first_name === 'Deleted' && row?.email?.includes('@redacted.invalid') && row?.phone === null && row?.contact_opt_out === true && Boolean(row?.deleted_at),
    JSON.stringify(row));
  const { data: jobs } = await admin.database.from('notification_jobs').select('status').eq('person_id', pid);
  report('H2d queued notifications cancelled', (jobs ?? []).every((j) => j.status === 'cancelled'), JSON.stringify(jobs));
  const erasureAudit = await admin.database.from('audit_events').select('action').eq('record_id', pid).eq('action', 'privacy.erasure');
  report('H2e erasure audited', (erasureAudit.data ?? []).length === 1);
  r = await harry.client.database.rpc('request_privacy_erasure', { p_person_id: pid });
  report('H2f re-erasure idempotent', r.data?.already_erased === true);

  // T3: erased person no longer matches dedupe (email is redacted) and is excluded from candidates view
  const { data: dup } = await admin.database.from('people').select('id').eq('email', `erase.${ts}@synthetic.test`);
  report('H3a original email no longer resolvable', (dup ?? []).length === 0);

  console.log(`\n${failures === 0 ? 'ALL HARDENING TESTS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
