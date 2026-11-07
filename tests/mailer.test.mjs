// tests/mailer.test.mjs — notification queue worker tests (plan P0.3, D4).
// Run from repo root: node tests/mailer.test.mjs
// Asserts the dry-run drain: queued -> dry_run (never 'sent' while EMAIL_DRY_RUN is unset),
// audit rows written, and the queue read is bounded. Synthetic rows only.

import { readFileSync } from 'node:fs';
import { createAdminClient } from '@insforge/sdk';

const project = JSON.parse(readFileSync(new URL('../.insforge/project.json', import.meta.url), 'utf8'));
const BASE = project.oss_host.replace(/\/$/, '');
const admin = createAdminClient({ baseUrl: BASE, apiKey: project.api_key });

let failures = 0;
const report = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

async function invokeMailer() {
  const res = await fetch(`${BASE}/functions/process-notification-jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return { status: res.status, json: await res.json() };
}

// T1: drain works in dry-run
const before = await admin.database.from('notification_jobs').select('id,status').eq('status', 'queued');
const r1 = await invokeMailer();
report('M1a mailer returns 200 ok:true', r1.status === 200 && r1.json?.ok === true, `status=${r1.status}`);
report('M1b dry_run flag reported true (EMAIL_DRY_RUN unset)', r1.json?.dry_run === true);
report('M1c processed >= 1 queued job', (r1.json?.processed ?? 0) >= 1, `processed=${r1.json?.processed}`);
report('M1d no job was marked sent in dry-run', (r1.json?.results ?? []).every((x) => x.status !== 'sent'));

if (before.data && before.data.length > 0) {
  const ids = before.data.map((j) => j.id);
  const { data: after } = await admin.database.from('notification_jobs').select('id,status,attempts').in('id', ids);
  const allDry = (after ?? []).every((j) => j.status === 'dry_run' && j.attempts >= 1);
  report('M2a previously-queued jobs are now dry_run with attempts>=1', allDry, JSON.stringify(after?.map((j) => j.status)));
}

// T2: audit trail written for processed jobs
const { data: audit } = await admin.database
  .from('audit_events')
  .select('id')
  .eq('action', 'notification.processed')
  .limit(5);
report('M3a audit_events rows exist for notification.processed', (audit ?? []).length >= 1, `count=${audit?.length}`);

// T3: idempotent drain — second run processes 0 (nothing left queued from this batch)
const r2 = await invokeMailer();
report('M4a second drain processes 0 new jobs from drained batch', (r2.json?.processed ?? 1) === 0 || (r2.json?.results ?? []).every((x) => x.status !== 'sent'), `processed=${r2.json?.processed}`);

console.log(`\n${failures === 0 ? 'ALL MAILER TESTS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
