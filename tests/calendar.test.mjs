// tests/calendar.test.mjs — Sprint 4 calendar + attendance (plan P1.1-P1.4, WF-04).
// Run from repo root: node tests/calendar.test.mjs   (synthetic data only)

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
  return createClient({ baseUrl: BASE, accessToken: token });
}

async function main() {
  // calendar_editor dev user (created on the fly, role granted by admin)
  const editorEmail = 'cal.editor@bulldogs-dev.test';
  const anon0 = createClient({ baseUrl: BASE, anonKey: ANON });
  await anon0.auth.signUp({ email: editorEmail, password: PW });
  const { data: editorUser } = await anon0.auth.signInWithPassword({ email: editorEmail, password: PW });
  const editorId = editorUser.user.id;
  await admin.database.from('user_roles').insert([{ user_id: editorId, role_id: 5 }]); // calendar_editor
  const editor = await signIn(editorEmail);
  const coach = await signIn('coach@bulldogs-dev.test');
  const vic = await signIn('vic.volunteer@bulldogs-dev.test');
  const cara = await signIn('cara.coordinator@bulldogs-dev.test');
  const anon = createClient({ baseUrl: BASE, anonKey: ANON });

  // T1: draft event invisible to anon; published event visible
  let r = await editor.database.rpc('upsert_event', {
    p_id: null, p_type: 'training', p_title: 'S4 Test Training',
    p_venue: 'Test Park', p_starts_at: '2027-04-01T18:00:00-06:00', p_ends_at: '2027-04-01T20:00:00-06:00',
    p_status: 'draft', p_audience: 'public',
  });
  report('T1a editor creates draft event', !r.error && r.data?.id, r.error?.message ?? '');
  const eventId = r.data.id;
  const uid = r.data.uid;
  let vis = await anon.database.from('events').select('id').eq('id', eventId);
  report('T1b draft NOT visible to anon', (vis.data ?? []).length === 0, `rows=${vis.data?.length}`);

  r = await editor.database.rpc('upsert_event', {
    p_id: eventId, p_type: 'training', p_title: 'S4 Test Training',
    p_venue: 'Test Park', p_starts_at: '2027-04-01T18:00:00-06:00', p_ends_at: '2027-04-01T20:00:00-06:00',
    p_status: 'published', p_audience: 'public', p_change_note: 'Published for testing',
  });
  report('T1c publish ok, revision bumped', !r.error && r.data?.status === 'published' && r.data?.revision === 2, `rev=${r.data?.revision}`);
  vis = await anon.database.from('events').select('id').eq('id', eventId);
  report('T1d published event visible to anon', (vis.data ?? []).length === 1);

  // T2: volunteer cannot create/edit events
  r = await vic.database.rpc('upsert_event', { p_id: null, p_type: 'training', p_title: 'Nope', p_starts_at: '2027-04-02T18:00:00-06:00', p_ends_at: '2027-04-02T19:00:00-06:00' });
  report('T2a volunteer event create rejected', Boolean(r.error), r.error?.message ?? 'no error!');

  // T3: material change (time) on published event -> revision+1, material_change, audit
  r = await editor.database.rpc('upsert_event', {
    p_id: eventId, p_type: 'training', p_title: 'S4 Test Training',
    p_venue: 'Test Park', p_starts_at: '2027-04-01T19:00:00-06:00', p_ends_at: '2027-04-01T21:00:00-06:00',
    p_status: 'published', p_audience: 'public', p_change_note: 'Moved one hour later',
  });
  report('T3a time change: revision 3, material_change=true',
    r.data?.revision === 3 && r.data?.material_change === true, `rev=${r.data?.revision} mat=${r.data?.material_change}`);
  const audit = await admin.database.from('audit_events').select('action,before,after').eq('record_id', eventId).eq('action', 'event.material_change');
  const b = audit.data?.[0]?.before, a = audit.data?.[0]?.after;
  report('T3b audit has before/after with old/new starts_at',
    Boolean(audit.data?.length) && b?.starts_at !== a?.starts_at, '');

  // T4: ICS feed — published event present with SEQUENCE=3, stable UID; cancel -> STATUS:CANCELLED
  let feed = await (await fetch(`${BASE}/functions/events-ics`)).text();
  report('T4a feed contains event UID', feed.includes(`UID:${uid}`));
  report('T4b feed SEQUENCE=3', feed.includes('SEQUENCE:3'));
  r = await editor.database.rpc('upsert_event', {
    p_id: eventId, p_type: 'training', p_title: 'S4 Test Training (CANCELLED)',
    p_venue: 'Test Park', p_starts_at: '2027-04-01T19:00:00-06:00', p_ends_at: '2027-04-01T21:00:00-06:00',
    p_status: 'cancelled', p_audience: 'public', p_change_note: 'Cancelled due to weather',
  });
  report('T4c cancel ok, revision 4', r.data?.status === 'cancelled' && r.data?.revision === 4, `rev=${r.data?.revision}`);
  feed = await (await fetch(`${BASE}/functions/events-ics`)).text();
  report('T4d feed keeps cancelled event with STATUS:CANCELLED + same UID + SEQUENCE:4',
    feed.includes(`UID:${uid}`) && feed.includes('STATUS:CANCELLED') && feed.includes('SEQUENCE:4'));
  const single = await fetch(`${BASE}/functions/events-ics?uid=${uid}`);
  const singleBody = await single.text();
  report('T4e single-event feed: 200 text/calendar attachment with 1 VEVENT',
    single.status === 200 && (single.headers.get('content-type') ?? '').includes('text/calendar')
      && singleBody.split('BEGIN:VEVENT').length - 1 === 1 && (single.headers.get('content-disposition') ?? '').includes('attachment'),
    single.headers.get('content-disposition') ?? '');
  // draft event must NOT be in feed
  report('T4f draft events excluded from feed', !feed.includes('DRAFT: skills session'));

  // T5: attendance + derived milestones (coach) — fresh person per run so counts are deterministic
  const { data: trainEvents } = await admin.database.from('events').select('id').eq('uid', 'bulldogs-2027-training-01');
  const trainingId = trainEvents[0].id;
  const attEmail = `att.${Date.now()}@synthetic.test`;
  const { data: attPerson } = await admin.database.from('people').insert([{ first_name: 'Att', last_name: 'Test', email: attEmail, consent_contact: true, consent_at: new Date().toISOString() }]).select();
  const eliId = attPerson[0].id;
  r = await coach.database.rpc('mark_attendance', { p_event_id: trainingId, p_person_id: eliId, p_walk_in: false, p_consent_recorded: true });
  report('T5a coach marks attendance', !r.error && r.data?.total_attendance_count === 1, r.error?.message ?? `count=${r.data?.total_attendance_count}`);
  const ms = await admin.database.from('milestones').select('type, season_id').eq('person_id', eliId);
  report('T5b first_training milestone derived', (ms.data ?? []).some((m) => m.type === 'first_training'), JSON.stringify(ms.data?.map((m) => m.type)));
  const { data: s2027 } = await admin.database.from('seasons').select('id').eq('year', 2027);
  report('T5c milestone season = 2027 (event date inside season)', ms.data?.find((m) => m.type === 'first_training')?.season_id === s2027[0].id);
  // second attendance (different event) -> second_training
  const { data: train2 } = await admin.database.from('events').select('id').eq('uid', 'bulldogs-2027-training-02');
  r = await coach.database.rpc('mark_attendance', { p_event_id: train2[0].id, p_person_id: eliId });
  report('T5d second attendance derives second_training', (r.data?.milestones_derived ?? []).includes('second_training'), JSON.stringify(r.data?.milestones_derived));
  r = await vic.database.rpc('mark_attendance', { p_event_id: trainingId, p_person_id: eliId });
  report('T5e volunteer cannot mark attendance', Boolean(r.error), r.error?.message ?? 'no error!');

  // T6: queue_event_update_notice — only opted-in participants of that event; idempotent per revision.
  // Use a FRESH event per run so the event-notice:{id}:{revision} key is unique.
  r = await editor.database.rpc('upsert_event', {
    p_id: null, p_type: 'match', p_title: 'S4 Notice Test Match',
    p_venue: 'Test Park', p_starts_at: '2027-05-01T13:00:00-06:00', p_ends_at: '2027-05-01T15:00:00-06:00',
    p_status: 'published', p_audience: 'public',
  });
  const noticeEventId = r.data.id;
  await coach.database.rpc('mark_attendance', { p_event_id: noticeEventId, p_person_id: eliId, p_consent_recorded: true });
  // attEmail attended + consents; imported roster people never consent; eli.fake (seeded, consented but NOT at this event) excluded
  r = await cara.database.rpc('queue_event_update_notice', { p_event_id: noticeEventId });
  report('T6a coordinator queues notices', !r.error && r.data?.ok === true, r.error?.message ?? JSON.stringify(r.data));
  const jobs = await admin.database.from('notification_jobs').select('type,to_email,idempotency_key').eq('idempotency_key', r.data?.idempotency_key);
  report('T6b notice queued for consented attendee of THIS event',
    (jobs.data ?? []).some((j) => j.to_email === attEmail && j.type === 'operational_notice'), JSON.stringify(jobs.data?.map((j) => j.to_email)));
  report('T6c non-attendee (eli.fake) and no-consent roster players excluded',
    !(jobs.data ?? []).some((j) => j.to_email.includes('eli.fake') || j.to_email.includes('new.roster')));
  const n1 = jobs.data?.length ?? 0;
  r = await cara.database.rpc('queue_event_update_notice', { p_event_id: noticeEventId });
  const jobs2 = await admin.database.from('notification_jobs').select('id').eq('idempotency_key', r.data?.idempotency_key);
  report('T6d re-queue same revision idempotent', (jobs2.data?.length ?? 0) === n1 && r.data?.notices_queued === 0, `${n1} jobs, requeue=${r.data?.notices_queued}`);
  r = await vic.database.rpc('queue_event_update_notice', { p_event_id: noticeEventId });
  report('T6e volunteer cannot queue notices', Boolean(r.error), r.error?.message ?? 'no error!');

  console.log(`\n${failures === 0 ? 'ALL CALENDAR TESTS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
