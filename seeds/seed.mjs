// Seeds SYNTHETIC test data only (plan Sprint 0 — no real personal data).
// Idempotent: safe to re-run on the same project.
import { readFileSync } from 'node:fs';
import { createClient, createAdminClient } from '@insforge/sdk';

const project = JSON.parse(readFileSync(new URL('../.insforge/project.json', import.meta.url)));
const BASE_URL = project.oss_host;
const ANON_KEY = process.env.INSFORGE_ANON_KEY ?? readFileSync(new URL('../.env.local', import.meta.url), 'utf8').match(/ANON_KEY=(.+)/)?.[1];
const API_KEY = project.api_key;

const anon = createClient({ baseUrl: BASE_URL, anonKey: ANON_KEY });
const admin = createAdminClient({ baseUrl: BASE_URL, apiKey: API_KEY });

const DEV_PASSWORD = 'Bulldogs!Dev2026'; // synthetic dev users only
const USERS = [
  { email: 'harry.admin@bulldogs-dev.test', role: 'admin' },
  { email: 'cara.coordinator@bulldogs-dev.test', role: 'coordinator' },
  { email: 'vic.volunteer@bulldogs-dev.test', role: 'volunteer' },
  { email: 'val.volunteer@bulldogs-dev.test', role: 'volunteer' },
  { email: 'coach@bulldogs-dev.test', role: 'coach' },
];

async function ensureUser(email) {
  await anon.auth.signUp({ email, password: DEV_PASSWORD }); // ignore "already exists"
  const { data, error } = await anon.auth.signInWithPassword({ email, password: DEV_PASSWORD });
  if (error || !data?.user?.id) throw new Error(`cannot get user id for ${email}: ${error?.message}`);
  return data.user.id;
}

async function main() {
  const userIds = {};
  for (const u of USERS) userIds[u.email] = await ensureUser(u.email);
  console.log('users ok:', Object.keys(userIds).length);

  // roles mapping
  const roleIds = { admin: 1, coordinator: 2, volunteer: 3, coach: 4, calendar_editor: 5 };
  for (const u of USERS) {
    const { data: existing } = await admin.database.from('user_roles').select('user_id').eq('user_id', userIds[u.email]).eq('role_id', roleIds[u.role]);
    if (!existing || existing.length === 0) {
      const { error } = await admin.database.from('user_roles').insert([{ user_id: userIds[u.email], role_id: roleIds[u.role], granted_by: userIds['harry.admin@bulldogs-dev.test'] }]);
      if (error) throw new Error('user_roles insert: ' + error.message);
    }
  }
  console.log('roles ok');

  // skip business rows if already seeded
  const { data: seasonCheck } = await admin.database.from('seasons').select('id').eq('year', 2026);
  if (seasonCheck && seasonCheck.length > 0) {
    console.log('business seed already present, skipping');
    return;
  }

  const { data: s2026 } = await admin.database.from('seasons').insert([{ year: 2026, name: '2026 Season', starts_on: '2026-04-01', ends_on: '2026-10-31', state: 'closed' }]).select();
  const { data: s2027 } = await admin.database.from('seasons').insert([{ year: 2027, name: '2027 Season', starts_on: '2027-03-01', ends_on: '2027-10-31', state: 'preseason' }]).select();
  const seasonId = s2027[0].id;
  const season2026Id = s2026[0].id;
  console.log('seasons ok');

  const vic = userIds['vic.volunteer@bulldogs-dev.test'];
  const val = userIds['val.volunteer@bulldogs-dev.test'];
  const cara = userIds['cara.coordinator@bulldogs-dev.test'];

  // published events (next sessions are in the near future relative to Nov 2026)
  const events = [
    { uid: 'bulldogs-2026-preseason-social-01', type: 'social', title: 'Preseason Social — meet the Bulldogs', venue: 'Raices Biergarten, Denver', venue_url: 'https://maps.example.com/raices', starts_at: '2026-11-14T18:00:00-07:00', ends_at: '2026-11-14T21:00:00-07:00', description: 'Casual social to meet players and committee before the 2027 season.', status: 'published', audience: 'public' },
    { uid: 'bulldogs-2027-training-01', type: 'training', title: 'First training of 2027 — come try footy', venue: 'Clear Creek Valley Park', venue_url: 'https://maps.example.com/ccvp', starts_at: '2027-03-03T18:00:00-07:00', ends_at: '2027-03-03T20:00:00-07:00', description: 'No experience needed. Bring boots and water.', status: 'published', audience: 'public' },
    { uid: 'bulldogs-2027-training-02', type: 'training', title: 'Training — Wednesday session', venue: 'Clear Creek Valley Park', venue_url: 'https://maps.example.com/ccvp', starts_at: '2027-03-06T18:00:00-07:00', ends_at: '2027-03-06T20:00:00-07:00', status: 'published', audience: 'public' },
    { uid: 'bulldogs-2027-committee-01', type: 'committee', title: 'Committee meeting', venue: 'Clubhouse', starts_at: '2026-11-18T19:00:00-07:00', ends_at: '2026-11-18T20:30:00-07:00', status: 'published', audience: 'private' },
    { uid: 'bulldogs-2027-training-draft', type: 'training', title: 'DRAFT: skills session', venue: 'TBD', starts_at: '2027-03-10T18:00:00-07:00', ends_at: '2027-03-10T19:30:00-07:00', status: 'draft', audience: 'public' },
  ];
  const { error: evErr } = await admin.database.from('events').insert(events.map(e => ({ ...e, created_by: cara })));
  if (evErr) throw new Error('events: ' + evErr.message);
  const { data: eventRows } = await admin.database.from('events').select('id, uid').eq('uid', 'bulldogs-2027-training-01');
  const firstTrainingId = eventRows[0].id;
  console.log('events ok');

  // synthetic people + enquiries across stages
  const people = [
    { first_name: 'Aaron', last_name: 'Example', email: 'aaron.example@synthetic.test', phone: '+1-555-0101', consent: true, source: 'Instagram' },
    { first_name: 'Bella', last_name: 'Sample', email: 'bella.sample@synthetic.test', phone: '+1-555-0102', consent: true, source: 'Friend referral' },
    { first_name: 'Carlos', last_name: 'Demo', email: 'carlos.demo@synthetic.test', phone: '+1-555-0103', consent: true, source: 'Google search' },
    { first_name: 'Dana', last_name: 'Test', email: 'dana.test@synthetic.test', phone: '+1-555-0104', consent: true, source: 'Instagram' },
    { first_name: 'Eli', last_name: 'Fake', email: 'eli.fake@synthetic.test', phone: '+1-555-0105', consent: true, source: 'Walked past the park' },
    { first_name: 'Fiona', last_name: 'Mock', email: 'fiona.mock@synthetic.test', phone: '+1-555-0106', consent: true, source: 'USAFL website' },
  ];
  const { data: peopleRows, error: pErr } = await admin.database.from('people').insert(
    people.map(p => ({ first_name: p.first_name, last_name: p.last_name, email: p.email, phone: p.phone, consent_contact: p.consent, consent_at: '2026-11-01T10:00:00Z', source: p.source }))
  ).select();
  if (pErr) throw new Error('people: ' + pErr.message);

  const stages = ['assigned', 'attempted', 'contacted', 'training_planned', 'attended', 'new'];
  const assignees = [vic, val, vic, val, cara, null];
  const enquiryRows = peopleRows.map((p, i) => ({
    person_id: p.id, season_id: seasonId, channel: 'web',
    landing_url: 'https://bulldogs-dev.example/', referrer: 'https://instagram.com',
    utm_source: i % 2 === 0 ? 'instagram' : 'google', utm_medium: 'social', utm_campaign: 'preseason2027',
    answers: { pathway: i % 2 === 0 ? 'mens' : 'womens', experience: i < 3 ? 'none' : 'some', questions: 'What should I bring?' },
    stage: stages[i], assigned_to: assignees[i],
    idempotency_key: `seed-enquiry-${i + 1}`,
    ip_hash: 'seedhash' + i,
  }));
  const { data: enqRows, error: eErr } = await admin.database.from('enquiries').insert(enquiryRows).select();
  if (eErr) throw new Error('enquiries: ' + eErr.message);

  // tasks: one per assigned enquiry; make one overdue
  const now = Date.now();
  const taskRows = enqRows.filter(e => e.assigned_to).map((e, i) => ({
    person_id: e.person_id, season_id: seasonId, enquiry_id: e.id,
    type: 'make_initial_call', state: i === 0 ? 'open' : i === 1 ? 'attempted' : 'open',
    owner_id: e.assigned_to,
    due_at: new Date(now + (i === 0 ? -3600e3 : 47 * 3600e3)).toISOString(), // first one overdue
  }));
  const { error: tErr } = await admin.database.from('tasks').insert(taskRows);
  if (tErr) throw new Error('tasks: ' + tErr.message);

  // interactions
  const { error: iErr } = await admin.database.from('interactions').insert([
    { person_id: peopleRows[1].id, enquiry_id: enqRows[1].id, author_id: vic, type: 'call', outcome: 'voicemail', summary: 'Left voicemail, asked to call back.', next_action: 'Call again Thursday', next_action_due: '2026-11-12T18:00:00Z' },
    { person_id: peopleRows[2].id, enquiry_id: enqRows[2].id, author_id: val, type: 'call', outcome: 'reached', summary: 'Great chat — keen to try training.', next_action: 'Confirm first training', next_action_due: '2026-11-10T12:00:00Z' },
  ]);
  if (iErr) throw new Error('interactions: ' + iErr.message);

  // attendance + milestones for the "attended" person
  await admin.database.from('attendance').insert([{ event_id: firstTrainingId, person_id: peopleRows[4].id, checked_in_by: userIds['coach@bulldogs-dev.test'], walk_in: false, consent_recorded: true }]);
  await admin.database.from('milestones').insert([
    { person_id: peopleRows[4].id, season_id: seasonId, type: 'first_match', source: 'coach verified', recorded_by: userIds['coach@bulldogs-dev.test'] },
    { person_id: peopleRows[2].id, season_id: seasonId, type: 'whatsapp_joined', source: 'manually confirmed', recorded_by: val },
  ]);
  await admin.database.from('participations').insert([
    { person_id: peopleRows[4].id, season_id: seasonId, pathway: 'mens', membership_status: 'active', joined_at: '2026-09-15T00:00:00Z' },
    { person_id: peopleRows[0].id, season_id: season2026Id, pathway: 'mens', membership_status: 'active', joined_at: '2026-05-01T00:00:00Z' }, // returning-player reconciliation candidate
  ]);
  await admin.database.from('notification_jobs').insert([
    { type: 'confirmation_email', person_id: peopleRows[5].id, enquiry_id: enqRows[5].id, to_email: people[5].email, subject: 'Welcome to the Denver Bulldogs', body: '...', idempotency_key: 'enquiry-confirm:seed-enquiry-6', status: 'queued' },
  ]);
  console.log('business seed ok');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
