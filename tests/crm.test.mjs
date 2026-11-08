// tests/crm.test.mjs — Sprint 2 CRM RPC tests (plan P0.5/P0.6, WF-02).
// Signs in as the seeded dev users and calls the RPCs through the AUTHENTICATED
// PostgREST path, so permission checks (assignee vs coordinator vs stranger) are real.
// Run from repo root: node tests/crm.test.mjs   (synthetic data only)

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

async function signIn(email) {
  const c = createClient({ baseUrl: BASE, anonKey: ANON });
  const { data, error } = await c.auth.signInWithPassword({ email, password: PW });
  const token = data?.accessToken ?? data?.session?.access_token;
  if (error || !token) throw new Error(`sign-in failed for ${email}: ${error?.message ?? JSON.stringify(data)}`);
  return createClient({ baseUrl: BASE, accessToken: token });
}

async function main() {
  const vic = await signIn('vic.volunteer@bulldogs-dev.test');       // volunteer
  const cara = await signIn('cara.coordinator@bulldogs-dev.test');   // coordinator
  const coach = await signIn('coach@bulldogs-dev.test');             // coach (staff, not assignee)

  // Fresh enquiry assigned round-robin to a volunteer (via admin RPC, like the edge fn)
  const key = `crm-test-${Date.now()}`;
  const { data: sub } = await admin.database.rpc('submit_enquiry', {
    p_idempotency_key: key, p_first_name: 'Crm', p_last_name: 'Test',
    p_email: `crm.${Date.now()}@synthetic.test`, p_phone: '+1-555-0133', p_consent: true,
    p_source: 'crm-test', p_landing_url: null, p_referrer: null, p_utm_source: 'test',
    p_utm_medium: null, p_utm_campaign: null, p_answers: {}, p_ip_hash: 'crmhash' + key,
    p_user_agent: 'crm-test', p_season_id: (await admin.database.from('seasons').select('id').eq('year', 2027)).data[0].id,
  });
  const enquiryId = sub.enquiry_id;
  const ownerId = sub.assigned_to;
  const ownerEmail = ownerId === (await admin.database.from('club_members').select('id,email').eq('email', 'vic.volunteer@bulldogs-dev.test')).data[0]?.id
    ? 'vic.volunteer@bulldogs-dev.test' : 'val.volunteer@bulldogs-dev.test';
  const ownerClient = ownerEmail.includes('vic') ? vic : await signIn('val.volunteer@bulldogs-dev.test');
  console.log(`enquiry ${enquiryId} assigned to ${ownerEmail}`);

  // T1: assignee can advance stage; audit written
  let r = await ownerClient.database.rpc('set_enquiry_stage', { p_enquiry_id: enquiryId, p_stage: 'attempted' });
  report('T1a assignee sets stage attempted', !r.error && r.data?.stage === 'attempted', r.error?.message ?? '');
  let audit = await admin.database.from('audit_events').select('action,actor_id,after').eq('record_id', enquiryId).eq('action', 'stage.changed');
  report('T1b stage.changed audit row exists with actor', (audit.data ?? []).length >= 1 && Boolean(audit.data[0].actor_id));

  // T2: a DIFFERENT volunteer cannot change this lead's stage
  const otherVolunteer = ownerEmail.includes('vic') ? await signIn('val.volunteer@bulldogs-dev.test') : vic;
  r = await otherVolunteer.database.rpc('set_enquiry_stage', { p_enquiry_id: enquiryId, p_stage: 'contacted' });
  report('T2a non-assignee volunteer rejected', Boolean(r.error), r.error?.message ?? 'no error!');

  // T3: coordinator CAN change stage on any lead
  r = await cara.database.rpc('set_enquiry_stage', { p_enquiry_id: enquiryId, p_stage: 'contacted' });
  report('T3a coordinator sets stage contacted', !r.error && r.data?.stage === 'contacted', r.error?.message ?? '');

  // T4: assignee logs an interaction (with stage advance) — WF-02
  const personId = sub.person_id;
  r = await ownerClient.database.rpc('log_interaction', {
    p_person_id: personId, p_enquiry_id: enquiryId, p_type: 'call', p_outcome: 'reached',
    p_summary: 'Great chat, booked for first training', p_next_action: 'Confirm training plan',
    p_next_action_due: new Date(Date.now() + 86400e3).toISOString(), p_stage: 'training_planned',
  });
  report('T4a log_interaction ok', !r.error && r.data?.id, r.error?.message ?? '');
  const { data: enqAfter } = await admin.database.from('enquiries').select('stage').eq('id', enquiryId);
  report('T4b stage advanced to training_planned via interaction', enqAfter?.[0]?.stage === 'training_planned', enqAfter?.[0]?.stage);

  // T5: coach (staff, not assignee) can log but not steal; empty summary rejected
  r = await coach.database.rpc('log_interaction', {
    p_person_id: personId, p_enquiry_id: enquiryId, p_type: 'call', p_outcome: 'voicemail', p_summary: '   ', p_next_action: null, p_next_action_due: null,
  });
  report('T5a empty summary rejected', Boolean(r.error), r.error?.message ?? 'no error!');
  r = await coach.database.rpc('log_interaction', {
    p_person_id: personId, p_enquiry_id: enquiryId, p_type: 'meeting', p_outcome: 'met', p_summary: 'Met at social', p_next_action: null, p_next_action_due: null,
  });
  report('T5b coach can log interaction on a lead', !r.error, r.error?.message ?? '');

  // T6: owner completes the 48h task; idempotent
  const { data: tasks } = await admin.database.from('tasks').select('id').eq('enquiry_id', enquiryId).eq('type', 'make_initial_call').eq('state', 'open');
  const taskId = tasks[0].id;
  r = await ownerClient.database.rpc('complete_task', { p_task_id: taskId, p_outcome: 'reached', p_notes: 'Called, booked in' });
  report('T6a owner completes task', !r.error && r.data?.state === 'completed', r.error?.message ?? '');
  r = await ownerClient.database.rpc('complete_task', { p_task_id: taskId, p_outcome: 'again' });
  report('T6b completing twice is idempotent (outcome unchanged)', !r.error && r.data?.outcome === 'reached');

  // T7: coordinator reassigns to the other volunteer; old task reassigned, new task open
  const newOwnerEmail = ownerEmail.includes('vic') ? 'val.volunteer@bulldogs-dev.test' : 'vic.volunteer@bulldogs-dev.test';
  const { data: newOwnerRows, error: newOwnerErr } = await admin.database.from('club_members').select('id').eq('email', newOwnerEmail);
  if (newOwnerErr || !newOwnerRows?.[0]) throw new Error('new owner lookup failed: ' + newOwnerErr?.message);
  const newOwnerId = newOwnerRows[0].id;
  r = await cara.database.rpc('reassign_enquiry', { p_enquiry_id: enquiryId, p_new_owner: newOwnerId });
  report('T7a coordinator reassign ok', !r.error && r.data?.ok === true, r.error?.message ?? '');
  const { data: tAfter } = await admin.database.from('tasks').select('state,owner_id').eq('enquiry_id', enquiryId).eq('type', 'make_initial_call');
  const states = (tAfter ?? []).map((t) => `${t.state}:${t.owner_id === newOwnerId ? 'new' : 'old'}`);
  // old task may be 'reassigned' (was open) or 'completed' (T6 ran first) — either way it is no longer open for the old owner
  report('T7b new open task for new owner, none left open for old',
    states.includes('open:new') && !states.includes('open:old'), states.join(','));
  const { data: enqRe } = await admin.database.from('enquiries').select('assigned_to').eq('id', enquiryId);
  report('T7c enquiry.assigned_to updated', enqRe?.[0]?.assigned_to === newOwnerId);

  // T8: volunteer cannot reassign (coordinator-only)
  r = await vic.database.rpc('reassign_enquiry', { p_enquiry_id: enquiryId, p_new_owner: newOwnerId });
  report('T8a volunteer reassign rejected', Boolean(r.error), r.error?.message ?? 'no error!');

  // T9: recruitment_stats shape + staff-only
  r = await cara.database.rpc('recruitment_stats', {});
  const s = r.data ?? {};
  report('T9a stats returns required keys', !r.error && ['enquiries_by_stage', 'overdue_open_tasks', 'pct_attempted_within_48h', 'median_hours_to_first_attempt', 'new_enquiries_in_window', 'unassigned_enquiries', 'first_training_conversion_window'].every((k) => k in s), r.error?.message ?? JSON.stringify(Object.keys(s)));
  const anon = createClient({ baseUrl: BASE, anonKey: ANON });
  r = await anon.database.rpc('recruitment_stats', {});
  report('T9b anon cannot call stats', Boolean(r.error), r.error?.message ?? 'no error!');

  // T10: upsert_my_club_member (Sprint 1 follow-up)
  r = await coach.database.rpc('upsert_my_club_member', {});
  report('T10a coach self-upserts club_members', !r.error && r.data?.ok === true && r.data?.email === 'coach@bulldogs-dev.test', r.error?.message ?? '');

  console.log(`\n${failures === 0 ? 'ALL CRM TESTS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
