# Bulldogs OS — Product & Build Plan

**Status:** Draft v0.1 — ready for committee validation and incremental implementation  
**Prepared:** 7 November 2026  
**Client:** Denver Bulldogs Australian Rules Football Club  
**Build approach:** Mistral Vibe Code + Mistral Studio Apps first; keep components replaceable  
**Product owner:** To be nominated by club committee

> **North Star:** Turn a curious website visitor into a welcomed, active Bulldog, then create the conditions for players and teams to progress toward a USAFL Division 1 national premiership. We cannot automate winning games. We can remove avoidable barriers between a person's first interest and their long-term participation.

---

## 1. Problem and product thesis

Today a potential recruit discovers the club, finds training information, might submit a form, and either turns up or disappears. The club runs on volunteer time, WhatsApp, and spreadsheets. It cannot reliably answer: Who enquired? Did we call? Did they attend? Did they join? Who was active last season but has not returned?

**V1 is a recruitment-and-retention operating system with a simple public front door.** It should create a durable record for each prospect, give a real volunteer ownership of the next step, make training easy to attend, and expose gaps that currently go unnoticed.

**Non-goal:** Build a generic AI chatbot, rewrite every club process, or automate unsolicited recruitment outreach.

**Guiding principles**
1. Human connection wins recruits. Software ensures the human connection happens.
2. Every lead has one owner and a clear next action.
3. The club should see outcomes, not just activity metrics.
4. Build for volunteers who use the tool for five minutes per week.
5. Data stays with the club and survives committee turnover.
6. No automated prospect outreach beyond the initial confirmation email in V1.
7. Use Mistral where it adds value; deterministic code handles status, deadlines, payments, identity, and permissions.
8. Keep access, privacy, reliability, and exportability simple but real.

## 2. Users and permissions

| Role | Primary need | Access |
| --- | --- | --- |
| Visitor / prospect | Understand the sport, see next training, signal interest | Public pages and form |
| Recruitment volunteer | Own and update assigned prospects; know who needs a call | Assigned contacts, tasks, notes |
| Recruitment coordinator | Allocate leads, monitor funnel and overdue tasks, resolve duplicates | All recruitment records |
| Coach / team manager | Record training attendance and progression | Relevant player records and events |
| Calendar editor | Maintain schedule, flag material changes | Event management |
| Club administrator | Manage seasons, users, permissions, exports and policy | Full club administration |

Use least-privilege roles. Do not expose prospect contact details or private notes publicly.

## 3. Player journey: stages and milestones

A **person** has one persistent club profile. A **season record** captures their status in a given year. Avoid treating WhatsApp membership, dues, or competitions as a single mandatory linear funnel: they are separate milestones.

### Primary funnel

1. **Visitor** — anonymous page view; aggregate analytics only.
2. **Enquired** — submitted a valid, consented recruitment form.
3. **Assigned** — onboarding volunteer owns the lead; initial call task created.
4. **Contact attempted** — volunteer logs a call attempt or other approved manual contact.
5. **Contacted** — two-way conversation or equivalent engagement is recorded.
6. **Training planned** — prospect intends to attend an identified session (optional, not required).
7. **First training attended** — coach/volunteer marks attendance.
8. **Returning trainee** — attended at least a second training session (derived from attendance, not manually guessed).
9. **Active member** — membership status recorded for current season.
10. **Match participant** — appeared in an actual match, with season/team recorded.
11. **Nationals participant** — played at Nationals; division and team recorded.
12. **National champion** — championship result confirmed and associated with the relevant team/season; do not infer an individual's participation from a club win.

**Other statuses:** Deferred / not interested, unable to contact, dormant, returning player, archived. Keep statuses reversible; record a timestamp and actor for every transition.

**Independent milestones (yes/no/date/source, with optional notes):** WhatsApp invitation offered, WhatsApp joined (confirmed manually), USAFL registration verified, club dues verified, first social event, first match, Nationals roster, Nationals appearance, 2026-to-2027 return.

Support men's, women's, mixed/coed, social and volunteer pathways without forcing everybody toward Division 1. The Division 1 championship is the aspirational sporting outcome, not a requirement for a successful recruitment conversion.

## 4. V1 requirements and priorities

### P0 — First vertical slice (must ship)

**P0.1: Recruitment landing page**
- Mobile-first page with a clear promise: no prior Australian football experience required.
- Show *next confirmed session* from the calendar, venue map link, what to wear/bring, and CTA: "Come try footy".
- Explain club culture, men's/women's participation, and easy progression into the team.
- Avoid hard-coded training times; display current published schedule. Existing website currently advertises Wednesday and Saturday sessions during April–October at Clear Creek Valley Park; verify with club before migration.
- Analytics: source/referrer/UTM (where available), landing-page visits, CTA clicks, form completions. Respect privacy preferences.

**P0.2: Low-friction sign-up**
- Required: first name, email, phone, consent to be contacted by a club volunteer about playing.
- Optional: last name, preferred first training session, previous experience, interested pathway, questions, how they heard about us.
- Clear disclosure about data use and manual contact; anti-spam protection; accessible validation and mobile input.
- One submission should create/reuse a person (deduplicate sensibly), open a season enquiry, and log an immutable event.
- Show a clear success page with next training details. Prevent double-submission.

**P0.3: Instant confirmation**
- One automatic transactional email after a successful enquiry: thank you, practical first-training information, and that a volunteer will be in touch.
- Send through a transactional email provider (provider TBD). Queue and retry safely; show send status; do not send duplicates if a submission retries.
- Do not promise a 48-hour callback publicly until a staffed rotation exists; internally target first call attempt within 48 hours.
- No automated drip campaigns, text messages, WhatsApp messages, or reminders to prospects in V1.

**P0.4: Volunteer assignment and 48-hour task**
- Assign new enquiries to an eligible volunteer using a configurable rotation or manual coordinator override.
- Create internal task `make_initial_call`, due **48 elapsed hours** after receipt. Send an internal alert to that volunteer (email or existing internal channel); no message to prospect.
- Task states: open / attempted / completed / reassigned / overdue / cancelled. Record assignee, timestamps, notes and outcome.
- If unassigned or overdue, expose prominently to coordinator; allow reassignment. Never silently discard a lead.

**P0.5: Player CRM and activity timeline**
- Searchable list and profile with phone/email, source, owner, season, pathway, current status, training history and next task.
- Add call outcome, notes, next agreed action, and manually log WhatsApp invitation/join, dues and USAFL status.
- Display chronology of submissions, assignments, task actions, attendance and milestone changes.
- Duplicate review and merge with audit trail; preserve history.

**P0.6: Recruitment action queue and dashboard**
- Start screen: new/unassigned leads; first-contact tasks due today/overdue; first-training attendees needing review; dormant past-season players for manual re-engagement.
- Filters: owner, team/pathway, season, stage, source, last interaction, due date.
- Coordinator overview: lead counts by stage and source, time-to-first-attempt, % attempted within 48 hours, first-training conversion, current-season returning members.
- All counts have clear definitions, time periods and no fabricated historical data.

**P0.7: Returning-player reconciliation**
- Import last-season roster from approved CSV/spreadsheet; preview mapping, validate fields, mark duplicates, and require confirmation before import.
- Flag players who participated in a previous season but lack current-season membership/activity.
- Create *internal* re-engagement tasks only. A human reviews history, contact permission and appropriateness before reaching out manually.
- Preserve source provenance; do not import unrelated private WhatsApp conversations.

### P1 — Calendar and training workflow (next release)

**P1.1: Shared event calendar**
- Calendar views on public site (published events only) and in admin (editable, with drafts).
- Events: training, match, tournament, social, committee, fundraiser; category, title, venue, start/end, time zone, description, status, revision history, audience and owner.
- Define **one authoritative source**. First inspect the current calendar: if there is a reliable API/feed, initially sync from it read-only; otherwise migrate editing to Bulldogs OS with a named calendar owner. Avoid two competing editable calendars.
- Event visibility controls for private committee or member events.

**P1.2: Google / Outlook / Apple calendar support**
- Provide a public published-event iCalendar (`.ics`) subscription URL and per-event "Add to calendar" download.
- Calendar subscriptions are *eventually consistent*: Outlook or Google may take hours or longer to reflect edits. Never treat calendar subscription alone as an urgent-change notification system.
- Include timezone (`America/Denver`), stable event UIDs, revision/sequence and explicit cancellation semantics; test against both Google and Outlook.

**P1.3: Important-change workflow**
- Detect or explicitly mark a significant venue/time/cancellation change; show a prominent change banner on the website and admin action queue immediately.
- Alert organizers/admins internally. Provide an **administrator-reviewed, manual Send update** action for opted-in event participants when the club has an appropriate contact basis. This is a transactional operational notice, not an automated recruitment follow-up.
- Keep preview, audience, delivery log and an audit trail; never silently blast the entire membership.

**P1.4: Attendance capture**
- Volunteer/coach selects an event and marks who attended (including walk-ins); quick-add an on-the-day recruit with consent or minimal temporary record pending consent.
- First and repeat attendance milestones are derived from attendance. Avoid requiring players to log in merely to attend training.
- Optional RSVP on sign-up for scheduling, without making RSVP a barrier to showing up.

### P2 — Useful refinements after P0/P1 stabilize

- Better funnel and cohort analytics by source, month and prior-season activity.
- One-page volunteer handover checklist and role rotation.
- Optional responsible Mistral assistance for *internal* task summaries and drafting, always human-reviewed; do not send private player profiles to an LLM by default.
- Sponsor-facing recruitment and participation summaries using aggregate, non-identifiable statistics.
- Better accessibility, content performance, search-engine optimization and conversion experiments.

### V2 — Deliberately out of scope now

- Club dues, payment collection and Zeffy/Stripe migration.
- Merchandise storefront, inventory, fulfillment and refunds.
- Authenticated member portal, personalized training plans, gamification.
- Sponsor CRM and automated sponsor reports.
- Automated nurture sequences, SMS/WhatsApp outreach, autonomous recruiting agents.
- Full match statistics and competition administration.

## 5. Three core workflows — exact expected behavior

### WF-01: New recruit submits form

1. Visitor completes sign-up and consents to club contact.
2. Server validates and rate-limits submission; persists person, enquiry, source and event atomically.
3. If a likely duplicate exists, attach a new enquiry or flag a merge review without destroying historical records.
4. Queue one confirmation email with retry/idempotency key.
5. Allocate volunteer, create a `make_initial_call` task due in 48 hours; notify volunteer internally.
6. Redirect to confirmation page with next confirmed training and what to bring.
7. Coordinator dashboard immediately reflects the lead; failed email delivery remains visible without losing the lead.

### WF-02: Human takes recruit toward training

1. Volunteer opens action queue; clicks lead and calls them manually.
2. Logs attempt time, outcome, summary and agreed next action.
3. If prospect plans to attend a session, attach that event. Record contact/WhatsApp milestones separately.
4. Coach records first training attendance (or walk-in signup).
5. System updates milestone and places the person in a *manual-review* queue for next action; **no automated follow-up message**.
6. Member / USAFL / match / Nationals milestones are recorded when verified.

### WF-03: Returning player missing from new season

1. Coordinator imports previous season list and verifies matches.
2. At season rollover, system highlights prior participants with no current-season status.
3. Coordinator assigns review task; volunteer checks reason, consent and relationship.
4. If appropriate, volunteer chooses and makes the contact themselves, logging outcome.
5. Rejoined / not returning / temporarily away statuses update cohort reporting.

### WF-04: Training venue or time changes

1. Authorized calendar editor edits event; system stores previous and new values.
2. Public site immediately shows current details and visible change notice.
3. Internal coordinator alert and change-log entry appear.
4. Admin can preview and *manually* send an operational notification to eligible opted-in participants. Sending is explicit and logged.
5. `.ics` feed reflects updated event; app must warn that subscriber refresh is not immediate.

## 6. Minimum data model

Use UUID identifiers, server timestamps, soft deletion where needed, and an audit log. Primary entities:

- `users`: club admin/volunteer login identity and status.
- `roles` / `user_roles`: least-privilege permissions.
- `people`: identity/contact details, preferred name, consent metadata, privacy requests.
- `seasons`: season year, dates, state (preseason / active / closed).
- `participations`: per-person, per-season team/pathway, membership and season engagement.
- `enquiries`: intake timestamp, channel, landing URL/UTMs, form answers, season, current recruiting stage, assigned user.
- `tasks`: person, season, action type, owner, due date, state, completion outcome.
- `interactions`: manually recorded call/contact attempts, outcomes, notes, author and timestamp.
- `events`: type, location, time zone, revision, publication status, audience.
- `attendance`: person x event, checked-in state and actor.
- `milestones`: person x season, milestone type, date, evidence/source, recorder (e.g. WhatsApp joined, USAFL verified, dues confirmed, match played, Nationals played).
- `teams` / `competition_results`: team/season/division/event result, with human verification; don't infer player championship participation.
- `notification_jobs`: confirmation email and manually initiated operational notices, status, retries, idempotency key.
- `audit_events`: who did what and when, with before/after for sensitive edits.
- `data_imports`: file provenance, importer, preview/confirmation and error summary.

Store contact permissions and opt-outs separately from player-stage flags. Avoid capturing dates of birth, medical details, payment card data or other unnecessary sensitive information.

### Suggested stage/event enums

`enquiry_stage`: `new`, `assigned`, `attempted`, `contacted`, `training_planned`, `attended`, `active`, `deferred`, `not_interested`, `dormant`, `archived`.

The complete sporting journey is better measured from milestone timestamps than one enormous status field. A season can be closed without deleting the player's historical record.

## 7. Key reports and metric definitions

**Primary operating metric:** % of eligible enquiries receiving a documented human contact attempt within 48 hours.

**Primary outcome metric:** % of new enquiries who attend at least one training session within 30 days, measured as a cohort. Also show counts so small-sample changes aren't misread.

**Supporting metrics:**
- Enquiries by source/UTM and month.
- Median hours from enquiry to first logged contact attempt; unassigned/overdue count.
- Enquiry → two-way contact rate.
- Enquiry → first training attendance rate (30-day cohort).
- First session → second session rate (60-day cohort).
- First session → current-season paying-member rate (where manually verified).
- Previous-season participants active again this season (retention rate, with a clear denominator).
- Active players, match participants, Nationals participants by season and team (verified records).

No invented baseline. Start collecting data before setting numeric conversion targets. First internal SLA target is 100% assigned and 90%+ attempted within 48 hours, subject to volunteer staffing approval.

## 8. Technical approach (provisional, Mistral-first)

**Preferred initial architecture:** Mistral Vibe Code to implement a Mistral Studio App with TanStack Start frontend, FastAPI backend, PostgreSQL database and workflow worker. Mistral's current `app` preset supports this combination. Deployment to Mistral Cloud requires an eligible paid/billed organization plan; verify entitlement, price, uptime, domains, storage, backups, email integration and operational access before choosing production hosting.

**Design constraints:**
- Public website and admin app can share code/backend but must have separate authorization boundaries.
- Simple deterministic scheduling/assignment; AI is optional for V1 workflows.
- Credentials in secret manager, never frontend source or repository.
- Transactional email adapter (vendor selection later) with delivery status and retry.
- Calendar `.ics` feed with stable URLs; optional source-sync adapter for existing club calendar.
- Server-side form validation, bot protection, rate limits, logging and test coverage.
- Daily recoverable DB backup, tested restore procedure and export-to-CSV for club-owned data.
- English-first website and internal admin to serve Denver players; the French Mistral film is a separate marketing project, not an MVP dependency.
- Build behind a staging environment and migrate domain/site only after committee approval.

**Fallback:** If Studio Apps costs, limitations, privacy terms or plan eligibility don't work, retain the frontend/API/database design and deploy to a conventional provider (e.g. InsForge or another Postgres host). Mistral can remain the coding tool and optional inference service. Avoid platform-specific coupling in core business logic.

**Mistral references checked 2026-11-07:**
- https://docs.mistral.ai/vibe/code/overview
- https://docs.mistral.ai/studio/apps/overview
- https://docs.mistral.ai/studio/apps/capabilities/available-capabilities
- Calendar behavior: https://support.microsoft.com/en-us/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web and https://support.google.com/calendar/answer/37100

## 9. Security, privacy and continuity requirements

- Club-approved privacy notice: why personal information is collected, who can see it, expected contact, retention and deletion process.
- Require appropriate consent to contact at signup. Do not assume a previous season's roster authorizes bulk messaging; manual outreach should respect current permissions and club policy.
- TLS in transit, encryption at rest where supported, role-gated contact information, audit logging and minimum necessary permissions.
- Avoid storing minors' information without a separate club-approved process; V1 designed for adult self-signup.
- Make prospect data exportable and removable on request consistent with club obligations.
- At least two trusted administrators with recovery access; document login, credentials ownership, backups and annual volunteer handover.
- Prevent public player-directory exposure, insecure file uploads and accidental leakage to model prompts/logging.
- No automatic WhatsApp group addition or sending messages without a deliberate, authorized action.

## 10. Build sequence: vertical slices and acceptance gates

### Sprint 0 — Discover / prepare (before production code)

**Output:** repo, architecture decision record, club permissions, realistic test fixtures.
- Confirm domain/site platform and ability to deploy or redirect recruitment landing page.
- Obtain current calendar data/source and ascertain who maintains it.
- Find existing form destination; identify what currently happens to submissions.
- Identify two onboarding volunteers plus backup, establish 48-hour coverage and escalation.
- Confirm club authorization, data controller, privacy copy, logo assets, email domain and deployment budget.
- Import sample roster (anonymized in development), establish season definition and manual data-owner process.
- Decide Studio App feasibility vs fallback based on actual account/plan limits.

**Exit:** repository and environments work; test data and basic role access established; decisions logged; no live personal data needed for development.

### Sprint 1 — First enquiry from visitor to assigned task (P0.1–P0.4)

- Public recruitment landing page, form, validation, secure database write.
- Confirmation email and idempotent delivery mechanism.
- Volunteer assignment, 48-hour task, internal notification, basic admin view.

**Acceptance:** A test prospect submits on mobile, sees confirmation, gets exactly one email, appears in admin, has one owner and one correct deadline. Duplicate submissions and email failure don't corrupt records or silently drop the enquiry.

### Sprint 2 — Volunteer workflow and scoreboard (P0.5–P0.6)

- CRM list/profile, calls/notes, attempts, stages, action queue, coordinator dashboard.
- Role authorization, audit history, basic filters and error handling.

**Acceptance:** A volunteer can find, call, log and update an assigned lead in under 2 minutes; coordinator sees overdue and unassigned leads; actions persist and are attributable.

### Sprint 3 — Returning players and real-world trial (P0.7)

- CSV import preview, reconciliation, dedupe, previous/current-season dashboard.
- Test with named volunteers and a small group of consented prospective recruits.
- Refine usability after watching actual committee members perform tasks.

**Acceptance:** Import identifies unreturned players without duplicate profiles and generates *internal* review tasks; no outreach occurs without a person taking action.

### Sprint 4 — Calendar + attendance (P1)

- Confirm authoritative schedule, show on website, published `.ics` subscription feed, event editing/change tracking.
- Manually approved critical-change notice; volunteer attendance capture.

**Acceptance:** One authorized edit appears immediately on site; `.ics` feed updates reliably with stable UID; change notices are logged; new attendee is linked to correct person and season. Google/Outlook subscription tested with documented refresh delay.

### Sprint 5 — Production hardening and handover

- Restore test, error/uptime monitoring, privacy/data deletion checks, permission review, accessibility/mobile audit, CSV export, documentation and two-person admin handover.
- Launch on club domain by committee approval, with a rollback plan and a real owner for weekly support.

**Acceptance:** The system remains useful if the builder is unavailable for 30 days.

## 11. Engineering definition of done

Every feature delivered by Vibe Code must include:
- Functional UI and API; migration/seed where applicable.
- Permissions and server-side validation.
- Clear empty, loading, failure and success states.
- Relevant automated tests (unit/API plus one end-to-end happy path for critical workflows).
- Simple verification instructions and updated `plan.md`/changelog.
- No real messaging, billing or production mutations without explicit approval.

Do not build all sprints in one giant agent prompt. Implement, run tests, review and commit one vertical slice at a time. Keep a short `DECISIONS.md` for architecture tradeoffs and `TASKS.md` for task status.

## 12. Open decisions (block production integration, not a local prototype)

1. **Existing site & domain:** What CMS/hosting is currently used? Can we edit its forms/URLs, or will we stand up a parallel landing page first?
2. **Calendar source:** Where does the currently up-to-date calendar live? Who is allowed to edit? API/ICS export available?
3. **Volunteer owners:** Who coordinates recruitment, who calls recruits, and who handles escalation after 48 hours?
4. **Email identity:** Which `@denverbulldogs.com` address may send receipts and internal notifications? Which provider?
5. **Historic data:** Where is the last two seasons' participant list, and what consent/contact-status information exists?
6. **Club permission:** Who approves access to members' personal data, public site deployment, and privacy wording?
7. **Hosting budget:** Mistral Studio Apps account capability, monthly budget, and acceptable fallback.
8. **Pilot teams:** Do we pilot men's and women's recruitment together, or begin with one volunteer owner/team and support both in the data model?

Recommended defaults until confirmed: build on staging with synthetic data; support all pathways; import only approved CSV; use one authoritative event source; have coordinator manually assign leads if rotation isn't staffed.

## 13. First instruction to Mistral Vibe Code

> Read `plan.md` completely. Treat it as the product source of truth. We are building Bulldogs OS for a volunteer-run Australian Rules football club, focusing on human-led player recruitment, retention tracking, and a simple public sign-up. Do not build merch, payments, a chatbot, automated follow-up campaigns, or the complete future roadmap. First: inspect the repository and toolchain, propose a minimal architecture using Mistral Studio Apps if available, flag any unavailable capabilities, produce `DECISIONS.md` and `TASKS.md`, and implement **only Sprint 0 scaffolding** using synthetic test data. Before any deployment, domain change, email send, personal-data import, or external integration, request explicit approval. After scaffolding, explain how to run, test, and review it.

## 14. Future case-study and film (not a development blocker)

Working concept: **Le Chien et le Chat — Un seul objectif. Battre Austin.**

Document the journey without making claims about results until verified: existing friction, first working recruitment flow, volunteer adoption, contact SLA, first-training conversion and returning-player retention. The website is table stakes; the story is giving volunteers a better way to build a premiership-capable club.
