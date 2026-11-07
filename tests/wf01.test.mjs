// tests/wf01.test.mjs — WF-01 server-side tests (plan.md §5).
// Run from repo root: npm run test:wf01  (node tests/wf01.test.mjs)
//
// Exercises the deployed public edge function POST {base}/functions/submit-enquiry
// and asserts DB side effects via the admin client. Synthetic data only:
// every idempotency key is prefixed "wf01-test-" and emails use @synthetic.test.

import { readFileSync } from 'node:fs';
import { createAdminClient } from '@insforge/sdk';

const project = JSON.parse(readFileSync(new URL('../.insforge/project.json', import.meta.url), 'utf8'));
const BASE = project.oss_host.replace(/\/$/, '');
const FN_URL = `${BASE}/functions/submit-enquiry`;
const admin = createAdminClient({ baseUrl: BASE, apiKey: project.api_key });

const ts = Date.now();
let failures = 0;

function report(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function post(body, extraHeaders = {}) {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, json };
}

// Targeted admin read: SELECT <cols> FROM <table> WHERE col = val ...
async function query(table, cols, filters = []) {
  let q = admin.database.from(table).select(cols);
  for (const [col, val] of filters) q = q.eq(col, val);
  const { data, error } = await q;
  if (error) throw new Error(`${table} query failed: ${error.message}`);
  return data ?? [];
}

async function group(name, fn) {
  console.log(`\n--- ${name} ---`);
  try {
    await fn();
  } catch (err) {
    report(name, false, String(err?.message ?? err));
  }
}

// (1) Happy path: valid body -> 200 {ok:true, duplicate:false} + exactly one
// enquiry, one make_initial_call task due ~48h after enquiry creation, one job.
await group('T1 happy path', async () => {
  const key = `wf01-test-happy-${ts}`;
  const body = {
    firstName: 'Wff', lastName: 'Happy', email: `wf01.happy.${ts}@synthetic.test`,
    phone: '+1-555-0199', consent: true, pathway: 'mens', experience: 'none',
    questions: 'What should I bring?', howHeard: 'friend referral',
    preferredEventId: crypto.randomUUID(), idempotencyKey: key,
    landingUrl: 'https://bulldogs-dev.example/landing',
    utmSource: 'test', utmMedium: 'e2e', utmCampaign: 'wf01',
  };
  // unique doc IP per run so the shared rate-limit bucket doesn't leak between test runs
  const r = await post(body, { 'X-Forwarded-For': `192.0.2.${(ts % 200) + 1}` });
  report('T1a POST returns 200 ok:true duplicate:false',
    r.status === 200 && r.json?.ok === true && r.json?.duplicate === false,
    `status=${r.status} body=${JSON.stringify(r.json)}`);
  report('T1b response carries next_event key', r.json && 'next_event' in r.json,
    `next_event=${JSON.stringify(r.json?.next_event)}`);

  const enquiries = await query('enquiries', '*', [['idempotency_key', key]]);
  report('T1c exactly 1 enquiry with idempotency_key', enquiries.length === 1, `count=${enquiries.length}`);
  const enquiryId = r.json?.enquiry_id ?? enquiries[0]?.id;

  const tasks = await query('tasks', '*', [['enquiry_id', enquiryId], ['type', 'make_initial_call']]);
  report('T1d exactly 1 make_initial_call task for enquiry', tasks.length === 1, `count=${tasks.length}`);
  if (tasks.length === 1 && enquiries.length === 1) {
    const deltaMs = Date.parse(tasks[0].due_at) - (Date.parse(enquiries[0].created_at) + 48 * 3600e3);
    report('T1e task due_at within 60s of enquiry created_at + 48h', Math.abs(deltaMs) <= 60e3,
      `delta=${(deltaMs / 1000).toFixed(1)}s`);
  }

  const jobs = await query('notification_jobs', 'id', [['enquiry_id', enquiryId], ['type', 'confirmation_email']]);
  report('T1f exactly 1 confirmation_email job for enquiry (P0.3)', jobs.length === 1, `count=${jobs.length}`);
});

// (2) Idempotency: resending the same body returns duplicate:true, no new rows.
await group('T2 idempotency', async () => {
  const key = `wf01-test-happy-${ts}`; // same key as T1
  const body = {
    firstName: 'Wff', lastName: 'Happy', email: `wf01.happy.${ts}@synthetic.test`,
    phone: '+1-555-0199', consent: true, idempotencyKey: key,
  };
  const r = await post(body, { 'X-Forwarded-For': `192.0.2.${(ts % 200) + 1}` }); // same run bucket as T1
  report('T2a resend returns 200 duplicate:true',
    r.status === 200 && r.json?.ok === true && r.json?.duplicate === true,
    `status=${r.status} body=${JSON.stringify(r.json)}`);

  const enquiries = await query('enquiries', 'id', [['idempotency_key', key]]);
  const enquiryId = r.json?.enquiry_id ?? (await query('enquiries', 'id', [['idempotency_key', key]]))[0]?.id;
  const tasks = await query('tasks', 'id', [['enquiry_id', enquiryId], ['type', 'make_initial_call']]);
  const jobs = await query('notification_jobs', 'id', [['enquiry_id', enquiryId], ['type', 'confirmation_email']]);
  const alerts = await query('notification_jobs', 'id', [['enquiry_id', enquiryId], ['type', 'internal_alert']]);
  report('T2b counts unchanged (1 enquiry / 1 task / 1 confirmation / 1 alert)',
    enquiries.length === 1 && tasks.length === 1 && jobs.length === 1 && alerts.length === 1,
    `enquiries=${enquiries.length} tasks=${tasks.length} confirm=${jobs.length} alerts=${alerts.length}`);
});

// (3) Validation: missing consent -> 400, bad email -> 400, missing firstName -> 400.
await group('T3 validation', async () => {
  const base = {
    firstName: 'Vee', email: `wf01.val.${ts}@synthetic.test`,
    phone: '+1-555-0188', consent: true,
  };
  // Body without the consent key at all:
  const noConsent = await post({ firstName: base.firstName, email: base.email, phone: base.phone, idempotencyKey: `wf01-test-valc-${ts}` });
  report('T3a missing consent -> 400 consent_required',
    noConsent.status === 400 && noConsent.json?.error === 'consent_required',
    `status=${noConsent.status} body=${JSON.stringify(noConsent.json)}`);

  const badEmail = await post({ ...base, email: 'not-an-email', idempotencyKey: `wf01-test-vale-${ts}` });
  report('T3b bad email -> 400 email_invalid',
    badEmail.status === 400 && badEmail.json?.error === 'email_invalid',
    `status=${badEmail.status} body=${JSON.stringify(badEmail.json)}`);

  const noName = await post({ ...base, firstName: '', idempotencyKey: `wf01-test-valn-${ts}` });
  report('T3c missing firstName -> 400',
    noName.status === 400 && noName.json?.error === 'first_name_required',
    `status=${noName.status} body=${JSON.stringify(noName.json)}`);
});

// (4) Rate limit: 6 rapid valid submissions from one X-Forwarded-For IP with
// distinct idempotency keys -> at least one 429 {error:"rate_limited"}.
await group('T4 rate limit', async () => {
  const xff = '198.51.100.77'; // TEST-NET-2 documentation IP (synthetic)
  const statuses = [];
  let sawRateLimitedBody = false;
  for (let i = 0; i < 6; i++) {
    const r = await post({
      firstName: 'Arr', email: `wf01.rl.${ts}.${i}@synthetic.test`,
      phone: '+1-555-0177', consent: true, idempotencyKey: `wf01-test-rl-${ts}-${i}`,
    }, { 'X-Forwarded-For': xff });
    statuses.push(r.status);
    if (r.status === 429 && r.json?.error === 'rate_limited') sawRateLimitedBody = true;
  }
  const n429 = statuses.filter((s) => s === 429).length;
  report('T4a at least one 429 among 6 rapid submissions', n429 >= 1, `statuses=${statuses.join(',')}`);
  report('T4b 429 body is {error:"rate_limited"}', sawRateLimitedBody);
});

// (5) Browser path: the SPA calls the function with the ANON key via SDK invoke — no auth.
await group('T5 anon SDK invoke (browser path)', async () => {
  const { createClient } = await import('@insforge/sdk');
  const anon = createClient({ baseUrl: BASE, anonKey: readFileSync(new URL('../.env.local', import.meta.url), 'utf8').match(/NEXT_PUBLIC_INSFORGE_ANON_KEY=(.+)/)[1].trim() });
  const key = `wf01-test-anon-${ts}`;
  const { data, error } = await anon.functions.invoke('submit-enquiry', {
    body: {
      firstName: 'Browser', email: `wf01.anon.${ts}@synthetic.test`, phone: '+1-555-0166',
      consent: true, idempotencyKey: key,
    },
    headers: { 'X-Forwarded-For': `192.0.2.${(ts % 200) + 2}` }, // fresh bucket per run
  });
  report('T5a anon invoke returns ok:true', !error && data?.ok === true, `error=${error?.message} data=${JSON.stringify(data)?.slice(0, 200)}`);

  // (6) internal alert to the assigned volunteer was queued (P0.4)
  const enquiryId = data?.enquiry_id;
  const alerts = await query('notification_jobs', 'id,type,to_email,status', [['enquiry_id', enquiryId], ['type', 'internal_alert']]);
  report('T6a exactly 1 internal_alert job for the enquiry', alerts.length === 1, `count=${alerts.length} to=${alerts[0]?.to_email}`);
  report('T6b alert addressed to a club volunteer (bulldogs-dev.test)', Boolean(alerts[0]?.to_email?.endsWith('@bulldogs-dev.test')));
});

console.log(`\n${failures === 0 ? 'ALL WF-01 TESTS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
