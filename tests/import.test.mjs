// tests/import.test.mjs — Sprint 3 roster import + returning-player reconciliation (plan P0.7, WF-03).
// Run from repo root: node tests/import.test.mjs   (synthetic data only)

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
  if (error || !token) throw new Error(`sign-in failed for ${email}: ${error?.message ?? ''}`);
  return createClient({ baseUrl: BASE, accessToken: token });
}

async function main() {
  const cara = await signIn('cara.coordinator@bulldogs-dev.test');
  const vic = await signIn('vic.volunteer@bulldogs-dev.test');
  const anon = createClient({ baseUrl: BASE, anonKey: ANON });

  const { data: seasons } = await admin.database.from('seasons').select('id, year, state').in('year', [2026, 2027]);
  const s2026 = seasons.find((s) => s.year === 2026).id;
  const s2027 = seasons.find((s) => s.year === 2027).id;

  const ts = Date.now();
  const newEmail = `new.roster.${ts}@synthetic.test`; // unique per run so re-runs stay deterministic
  const rows = [
    { first_name: 'New', last_name: 'Roster', email: newEmail, phone: '+1-555-0200', pathway: 'womens', membership_status: 'active' },
    { first_name: 'Aaron', last_name: 'Example', email: 'aaron.example@synthetic.test' }, // existing seeded person
    { first_name: 'Dup', email: newEmail },                                                 // duplicate in file
    { email: 'bad-email' },                                                                 // invalid: no name, bad email
    { first_name: 'NoEmail' },                                                              // invalid: no email
  ];

  // T1: preview — coordinator only, validates + matches, writes NOTHING to people
  const { count: peopleBefore } = await admin.database.from('people').select('id', { count: 'exact' }).limit(1);
  let r = await cara.database.rpc('create_roster_import', { p_filename: '2026-roster-test.csv', p_season_id: s2026, p_rows: rows });
  report('T1a coordinator preview ok', !r.error && r.data?.valid === 2, r.error?.message ?? JSON.stringify({ valid: r.data?.valid, n: r.data?.new, e: r.data?.existing, d: r.data?.duplicate_in_file, i: r.data?.invalid }));
  report('T1b preview counts: 1 new / 1 existing / 1 dup / 2 invalid',
    r.data?.new === 1 && r.data?.existing === 1 && r.data?.duplicate_in_file === 1 && r.data?.invalid === 2,
    `new=${r.data?.new} existing=${r.data?.existing} dup=${r.data?.duplicate_in_file} invalid=${r.data?.invalid}`);
  const importId = r.data?.import_id;
  const { count: peopleAfter } = await admin.database.from('people').select('id', { count: 'exact' }).limit(1);
  report('T1c preview created no people', peopleBefore === peopleAfter, `${peopleBefore} -> ${peopleAfter}`);
  const { data: impRow } = await admin.database.from('data_imports').select('status').eq('id', importId);
  report('T1d import row is in preview status', impRow?.[0]?.status === 'preview', impRow?.[0]?.status);

  // T2: volunteer + anon cannot preview
  r = await vic.database.rpc('create_roster_import', { p_filename: 'x.csv', p_season_id: s2026, p_rows: [] });
  report('T2a volunteer preview rejected', Boolean(r.error), r.error?.message ?? 'no error!');
  r = await anon.database.rpc('create_roster_import', { p_filename: 'x.csv', p_season_id: s2026, p_rows: [] });
  report('T2b anon preview rejected', Boolean(r.error), r.error?.message ?? 'no error!');

  // T3: confirm — writes people WITHOUT consent, with provenance; matches existing; idempotent
  r = await cara.database.rpc('confirm_roster_import', { p_import_id: importId });
  report('T3a confirm ok', !r.error && r.data?.ok === true, r.error?.message ?? '');
  report('T3b 1 created / 1 matched / 1 participation (existing one conflicted)',
    r.data?.people_created === 1 && r.data?.people_matched === 1 && r.data?.participations_created === 1,
    JSON.stringify({ c: r.data?.people_created, m: r.data?.people_matched, p: r.data?.participations_created }));

  const { data: newPerson } = await admin.database.from('people').select('id, consent_contact, import_id, source').eq('email', newEmail);
  report('T3c imported person has consent_contact=false (roster != consent, plan §9)',
    newPerson?.[0]?.consent_contact === false, JSON.stringify(newPerson?.[0]));
  report('T3d provenance: import_id set + source names the file',
    newPerson?.[0]?.import_id === importId && String(newPerson?.[0]?.source).includes('2026-roster-test.csv'));
  const { data: part } = await admin.database.from('participations').select('season_id, pathway, membership_status, notes').eq('person_id', newPerson?.[0]?.id);
  report('T3e participation created for 2026 with pathway womens', part?.[0]?.season_id === s2026 && part?.[0]?.pathway === 'womens', JSON.stringify(part?.[0]));

  const { count: peopleMid } = await admin.database.from('people').select('id', { count: 'exact' }).limit(1);
  r = await cara.database.rpc('confirm_roster_import', { p_import_id: importId });
  const { count: peopleEnd } = await admin.database.from('people').select('id', { count: 'exact' }).limit(1);
  report('T3f re-confirm is idempotent (already_confirmed, no new people)',
    r.data?.already_confirmed === true && peopleMid === peopleEnd, `already=${r.data?.already_confirmed} people ${peopleMid}->${peopleEnd}`);

  // T4: returning_player_candidates flags 2026-only players (seeded Aaron + imported New Roster)
  const { data: candidates } = await admin.database.from('returning_player_candidates').select('person_id, email, previous_season_year, current_season_year, open_review_tasks');
  const emails = (candidates ?? []).map((c) => c.email);
  report('T4a view flags aaron.example (2026 only)', emails.includes('aaron.example@synthetic.test'), emails.join(','));
  report('T4b view flags the imported new player (2026 only)', emails.includes(newEmail));
  report('T4c current-season player (eli.fake, has 2027 participation) NOT flagged', !emails.includes('eli.fake@synthetic.test'));
  report('T4d previous/current years correct', candidates?.[0]?.previous_season_year === 2026 && candidates?.[0]?.current_season_year === 2027);

  // T5: re-engagement review task — coordinator only, idempotent, internal-only
  const aaron = (await admin.database.from('people').select('id').eq('email', 'aaron.example@synthetic.test')).data[0].id;
  r = await cara.database.rpc('create_reengagement_review', { p_person_id: aaron, p_season_id: s2027 });
  report('T5a coordinator creates review task', !r.error && r.data?.ok === true && r.data?.task_id, r.error?.message ?? '');
  const taskId = r.data?.task_id;
  const { data: tRow } = await admin.database.from('tasks').select('type, state, due_at, notes').eq('id', taskId);
  report('T5b task is review_reengagement/open with internal-only note',
    tRow?.[0]?.type === 'review_reengagement' && tRow?.[0]?.state === 'open' && /Internal review only/.test(tRow?.[0]?.notes ?? ''), JSON.stringify(tRow?.[0]));
  r = await cara.database.rpc('create_reengagement_review', { p_person_id: aaron, p_season_id: s2027 });
  report('T5c second call idempotent (same task)', r.data?.already_exists === true && r.data?.task_id === taskId);
  r = await vic.database.rpc('create_reengagement_review', { p_person_id: aaron, p_season_id: s2027 });
  report('T5d volunteer cannot create review tasks', Boolean(r.error), r.error?.message ?? 'no error!');

  // T6: no outreach happened — no notification jobs reference the imported person
  const { data: jobs } = await admin.database.from('notification_jobs').select('id').eq('person_id', newPerson?.[0]?.id);
  report('T6a import created zero notification_jobs (no auto outreach)', (jobs ?? []).length === 0, `count=${jobs?.length}`);

  console.log(`\n${failures === 0 ? 'ALL IMPORT TESTS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
