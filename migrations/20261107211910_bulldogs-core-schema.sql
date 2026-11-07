-- Bulldogs OS core schema (plan.md §6 minimum data model)
-- InsForge: app-owned objects live in `public`; auth.users is managed and referenced read-only.
-- (runner forbids BEGIN/COMMIT in migration files)

------------------------------------------------------------------------
-- Enums
------------------------------------------------------------------------
CREATE TYPE public.season_state AS ENUM ('preseason', 'active', 'closed');
CREATE TYPE public.pathway_type AS ENUM ('mens', 'womens', 'mixed', 'social', 'volunteer');
CREATE TYPE public.membership_status AS ENUM ('none', 'pending', 'active', 'expired');
CREATE TYPE public.enquiry_stage AS ENUM (
  'new', 'assigned', 'attempted', 'contacted', 'training_planned',
  'attended', 'active', 'deferred', 'not_interested', 'dormant', 'archived'
);
CREATE TYPE public.task_type AS ENUM ('make_initial_call', 'review_reengagement', 'manual_follow_up');
CREATE TYPE public.task_state AS ENUM ('open', 'attempted', 'completed', 'reassigned', 'cancelled');
-- NOTE: 'overdue' is derived (due_at < now() AND state IN ('open','attempted')), see public.action_queue.
CREATE TYPE public.interaction_type AS ENUM ('call', 'email', 'meeting', 'whatsapp', 'social', 'other');
CREATE TYPE public.event_type AS ENUM ('training', 'match', 'tournament', 'social', 'committee', 'fundraiser');
CREATE TYPE public.event_status AS ENUM ('draft', 'published', 'cancelled');
CREATE TYPE public.event_audience AS ENUM ('public', 'members', 'private');
CREATE TYPE public.milestone_type AS ENUM (
  'whatsapp_invited', 'whatsapp_joined', 'usafl_registered', 'dues_paid',
  'first_social', 'first_match', 'nationals_roster', 'nationals_played',
  'season_return', 'membership_active'
);
CREATE TYPE public.notification_type AS ENUM ('confirmation_email', 'operational_notice');
CREATE TYPE public.notification_status AS ENUM ('queued', 'sending', 'sent', 'failed', 'cancelled');

------------------------------------------------------------------------
-- Roles (reference data — club volunteer roles, plan §2)
------------------------------------------------------------------------
CREATE TABLE public.roles (
  id          SMALLINT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

INSERT INTO public.roles (id, name, description) VALUES
  (1, 'admin',        'Club administrator: seasons, users, permissions, exports, policy'),
  (2, 'coordinator',  'Recruitment coordinator: allocate leads, monitor funnel, resolve duplicates'),
  (3, 'volunteer',    'Recruitment volunteer: owns and updates assigned prospects'),
  (4, 'coach',        'Coach / team manager: attendance and progression'),
  (5, 'calendar_editor', 'Calendar editor: maintains schedule, flags material changes');

CREATE TABLE public.user_roles (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id    SMALLINT NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_id)
);

------------------------------------------------------------------------
-- People & seasons
------------------------------------------------------------------------
CREATE TABLE public.people (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name          TEXT NOT NULL,
  last_name           TEXT,
  preferred_name      TEXT,
  email               TEXT NOT NULL,
  phone               TEXT,
  -- consent to be contacted by a club volunteer about playing (plan P0.2 / §9)
  consent_contact     BOOLEAN NOT NULL DEFAULT FALSE,
  consent_at          TIMESTAMPTZ,
  consent_text_version TEXT NOT NULL DEFAULT 'v1',
  -- privacy requests / opt-outs stored separately from stage flags (plan §6)
  contact_opt_out     BOOLEAN NOT NULL DEFAULT FALSE,
  privacy_notes       TEXT,
  source              TEXT,               -- how they heard about us (free text from form)
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ          -- soft delete
);
-- sensible dedupe: one active profile per email (plan P0.2)
CREATE UNIQUE INDEX people_active_email_uidx ON public.people (LOWER(email)) WHERE deleted_at IS NULL;
CREATE INDEX people_name_idx ON public.people (LOWER(first_name), LOWER(COALESCE(last_name, '')));

CREATE TABLE public.seasons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year       INTEGER NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  starts_on  DATE NOT NULL,
  ends_on    DATE NOT NULL,
  state      public.season_state NOT NULL DEFAULT 'preseason',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.participations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id         UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  season_id         UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  pathway           public.pathway_type NOT NULL DEFAULT 'mens',
  membership_status public.membership_status NOT NULL DEFAULT 'none',
  joined_at         TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (person_id, season_id)
);

------------------------------------------------------------------------
-- Enquiries, tasks, interactions
------------------------------------------------------------------------
CREATE TABLE public.enquiries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  season_id       UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL DEFAULT 'web',
  landing_url     TEXT,
  referrer        TEXT,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  -- optional form answers: preferred session, experience, pathway, questions
  answers         JSONB NOT NULL DEFAULT '{}'::jsonb,
  stage           public.enquiry_stage NOT NULL DEFAULT 'new',
  stage_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stage_updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- idempotent submission (plan WF-01): client sends a UUID per submit attempt
  idempotency_key TEXT NOT NULL UNIQUE,
  ip_hash         TEXT,               -- sha256(ip + salt) for rate limiting, never raw IP
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX enquiries_stage_idx ON public.enquiries (stage, created_at DESC);
CREATE INDEX enquiries_assigned_idx ON public.enquiries (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX enquiries_ip_created_idx ON public.enquiries (ip_hash, created_at DESC);

CREATE TABLE public.tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id    UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  season_id    UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  enquiry_id   UUID REFERENCES public.enquiries(id) ON DELETE SET NULL,
  type         public.task_type NOT NULL,
  state        public.task_state NOT NULL DEFAULT 'open',
  owner_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_at       TIMESTAMPTZ NOT NULL,
  outcome      TEXT,
  notes        TEXT,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX tasks_open_due_idx ON public.tasks (state, due_at) WHERE state IN ('open', 'attempted');
CREATE INDEX tasks_owner_idx ON public.tasks (owner_id, state);

CREATE TABLE public.interactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id        UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  enquiry_id       UUID REFERENCES public.enquiries(id) ON DELETE SET NULL,
  author_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type             public.interaction_type NOT NULL DEFAULT 'call',
  outcome          TEXT,                -- e.g. reached, voicemail, no_answer, replied
  summary          TEXT NOT NULL,
  next_action      TEXT,
  next_action_due  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX interactions_person_idx ON public.interactions (person_id, created_at DESC);

------------------------------------------------------------------------
-- Events, attendance, milestones
------------------------------------------------------------------------
CREATE TABLE public.events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid          TEXT NOT NULL UNIQUE,   -- stable UID for .ics (Sprint 4)
  type         public.event_type NOT NULL,
  title        TEXT NOT NULL,
  venue        TEXT,
  venue_url    TEXT,                    -- map link
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  time_zone    TEXT NOT NULL DEFAULT 'America/Denver',
  description  TEXT,
  status       public.event_status NOT NULL DEFAULT 'draft',
  audience     public.event_audience NOT NULL DEFAULT 'public',
  revision     INTEGER NOT NULL DEFAULT 1,   -- bumped on material change (WF-04)
  change_note  TEXT,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_time_order CHECK (ends_at >= starts_at)
);
CREATE INDEX events_published_idx ON public.events (starts_at) WHERE status = 'published';

CREATE TABLE public.attendance (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  person_id        UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  checked_in_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  checked_in_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  walk_in          BOOLEAN NOT NULL DEFAULT FALSE,
  consent_recorded BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (event_id, person_id)
);

CREATE TABLE public.milestones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  season_id   UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  type        public.milestone_type NOT NULL,
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source      TEXT,                     -- evidence/source, e.g. 'verified by coordinator'
  recorded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (person_id, season_id, type)
);

------------------------------------------------------------------------
-- Notifications (queue-only until approved; plan D4) & audit
------------------------------------------------------------------------
CREATE TABLE public.notification_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            public.notification_type NOT NULL,
  person_id       UUID REFERENCES public.people(id) ON DELETE CASCADE,
  enquiry_id      UUID REFERENCES public.enquiries(id) ON DELETE SET NULL,
  to_email        TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  status          public.notification_status NOT NULL DEFAULT 'queued',
  attempts        INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL UNIQUE,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at         TIMESTAMPTZ
);

CREATE TABLE public.audit_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,             -- e.g. 'enquiry.created', 'task.completed', 'stage.changed'
  table_name TEXT,
  record_id  UUID,
  before     JSONB,
  after      JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_record_idx ON public.audit_events (table_name, record_id, created_at DESC);

CREATE TABLE public.data_imports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  importer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending/previewed/confirmed/failed
  summary     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- weekly digest drafts produced by the coordinator-digest agent (human-reviewed; plan P2)
CREATE TABLE public.digest_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  model         TEXT,
  input_stats   JSONB NOT NULL,          -- aggregate counts only, never PII
  draft         TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',  -- draft / reviewed / sent / discarded
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

------------------------------------------------------------------------
-- updated_at triggers
------------------------------------------------------------------------
CREATE TRIGGER people_updated_at     BEFORE UPDATE ON public.people         FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
CREATE TRIGGER seasons_updated_at    BEFORE UPDATE ON public.seasons        FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
CREATE TRIGGER participations_updated_at BEFORE UPDATE ON public.participations FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
CREATE TRIGGER enquiries_updated_at  BEFORE UPDATE ON public.enquiries      FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
CREATE TRIGGER tasks_updated_at      BEFORE UPDATE ON public.tasks          FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
CREATE TRIGGER events_updated_at     BEFORE UPDATE ON public.events         FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

------------------------------------------------------------------------
-- Role helper functions (SECURITY DEFINER to avoid recursive RLS; pinned search_path)
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_role(role_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid() AND r.name = role_name
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(role_names TEXT[])
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid() AND r.name = ANY (role_names)
  );
$$;

-- true when the current user is staff (any club role)
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid());
$$;

-- true when the current user owns an enquiry for this person (volunteer sees assigned leads)
CREATE OR REPLACE FUNCTION public.assigned_to_me(person_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.enquiries e
    WHERE e.person_id = person_uuid AND e.assigned_to = auth.uid()
  );
$$;

------------------------------------------------------------------------
-- RLS
------------------------------------------------------------------------
ALTER TABLE public.roles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enquiries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_imports    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digest_runs     ENABLE ROW LEVEL SECURITY;

-- roles: readable by any authenticated club user; manageable by admin only
CREATE POLICY "roles readable by club users" ON public.roles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "roles managed by admin" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role('admin'))
  WITH CHECK (public.has_role('admin'));
CREATE POLICY "user_roles readable by club users" ON public.user_roles
  FOR SELECT TO authenticated USING (true);

-- people: staff (admin/coordinator/coach) see all; volunteers see assigned leads only.
-- Writes go through edge functions (project_admin), not direct client DML.
CREATE POLICY "people readable by staff or assignee" ON public.people
  FOR SELECT TO authenticated
  USING (
    public.has_any_role(ARRAY['admin','coordinator','coach'])
    OR public.assigned_to_me(id)
  );

-- seasons / participations
CREATE POLICY "seasons readable by club users" ON public.seasons
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "participations readable by staff" ON public.participations
  FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['admin','coordinator','coach']));
CREATE POLICY "participations managed by coordinator/admin" ON public.participations
  FOR ALL TO authenticated
  USING (public.has_any_role(ARRAY['admin','coordinator']))
  WITH CHECK (public.has_any_role(ARRAY['admin','coordinator']));

-- enquiries: same visibility as people; volunteers may update stage of their assigned leads
CREATE POLICY "enquiries readable by staff or assignee" ON public.enquiries
  FOR SELECT TO authenticated
  USING (
    public.has_any_role(ARRAY['admin','coordinator','coach'])
    OR public.assigned_to_me(person_id)
    OR assigned_to = (SELECT auth.uid())
  );
CREATE POLICY "enquiries updatable by coordinator or assignee" ON public.enquiries
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role(ARRAY['admin','coordinator'])
    OR assigned_to = (SELECT auth.uid())
  )
  WITH CHECK (
    public.has_any_role(ARRAY['admin','coordinator'])
    OR assigned_to = (SELECT auth.uid())
  );

-- tasks: owner + staff read; owner + staff update; staff create
CREATE POLICY "tasks readable by owner or staff" ON public.tasks
  FOR SELECT TO authenticated
  USING (public.is_staff() OR owner_id = (SELECT auth.uid()));
CREATE POLICY "tasks updatable by owner or staff" ON public.tasks
  FOR UPDATE TO authenticated
  USING (public.is_staff() OR owner_id = (SELECT auth.uid()))
  WITH CHECK (public.is_staff() OR owner_id = (SELECT auth.uid()));
CREATE POLICY "tasks creatable by staff" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());

-- interactions: author + staff read; authenticated create with self as author
CREATE POLICY "interactions readable by author or staff" ON public.interactions
  FOR SELECT TO authenticated
  USING (
    public.has_any_role(ARRAY['admin','coordinator','coach'])
    OR author_id = (SELECT auth.uid())
    OR public.assigned_to_me(person_id)
  );
CREATE POLICY "interactions creatable by club users" ON public.interactions
  FOR INSERT TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid()));
CREATE POLICY "interactions updatable by author or staff" ON public.interactions
  FOR UPDATE TO authenticated
  USING (author_id = (SELECT auth.uid()) OR public.has_any_role(ARRAY['admin','coordinator']))
  WITH CHECK (author_id = (SELECT auth.uid()) OR public.has_any_role(ARRAY['admin','coordinator']));

-- events: anon sees published public events; members see published public+members;
-- calendar editors + admin manage everything; creators can read own drafts
CREATE POLICY "public published events readable by anyone" ON public.events
  FOR SELECT TO anon, authenticated
  USING (status = 'published' AND audience = 'public');
CREATE POLICY "member events readable by club users" ON public.events
  FOR SELECT TO authenticated
  USING (status = 'published' AND audience IN ('public', 'members'));
CREATE POLICY "events fully visible to editors" ON public.events
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin','calendar_editor']) OR created_by = (SELECT auth.uid()));
CREATE POLICY "events managed by editor/admin" ON public.events
  FOR INSERT TO authenticated WITH CHECK (public.has_any_role(ARRAY['admin','calendar_editor']));
CREATE POLICY "events updated by editor/admin" ON public.events
  FOR UPDATE TO authenticated
  USING (public.has_any_role(ARRAY['admin','calendar_editor']))
  WITH CHECK (public.has_any_role(ARRAY['admin','calendar_editor']));
CREATE POLICY "events deletable by admin" ON public.events
  FOR DELETE TO authenticated USING (public.has_role('admin'));

-- attendance & milestones: coach/coordinator/admin
CREATE POLICY "attendance readable by staff" ON public.attendance
  FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['admin','coordinator','coach']));
CREATE POLICY "attendance creatable by coach/staff" ON public.attendance
  FOR INSERT TO authenticated WITH CHECK (public.has_any_role(ARRAY['admin','coordinator','coach']));
CREATE POLICY "milestones readable by staff" ON public.milestones
  FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['admin','coordinator','coach']));
CREATE POLICY "milestones managed by coordinator/admin" ON public.milestones
  FOR ALL TO authenticated
  USING (public.has_any_role(ARRAY['admin','coordinator']))
  WITH CHECK (public.has_any_role(ARRAY['admin','coordinator']));

-- notification_jobs: coordinator/admin only; writes via functions
CREATE POLICY "notification_jobs readable by coordinator/admin" ON public.notification_jobs
  FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['admin','coordinator']));

-- audit_events: append-only for club users, readable by coordinator/admin
CREATE POLICY "audit readable by coordinator/admin" ON public.audit_events
  FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['admin','coordinator']));
CREATE POLICY "audit appendable by club users" ON public.audit_events
  FOR INSERT TO authenticated WITH CHECK (actor_id = (SELECT auth.uid()) OR actor_id IS NULL);

-- data_imports: coordinator/admin
CREATE POLICY "imports readable by coordinator/admin" ON public.data_imports
  FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['admin','coordinator']));
CREATE POLICY "imports creatable by coordinator/admin" ON public.data_imports
  FOR INSERT TO authenticated WITH CHECK (public.has_any_role(ARRAY['admin','coordinator']));

-- digest_runs: staff read; agent writes via function
CREATE POLICY "digests readable by staff" ON public.digest_runs
  FOR SELECT TO authenticated USING (public.is_staff());

------------------------------------------------------------------------
-- Grants: anon gets nothing except published public events; authenticated broad
-- DML is left to RLS policies except where we tighten explicitly.
------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.events TO anon;   -- RLS limits to published+public

-- tighten: nobody but admin manages roles
REVOKE INSERT, UPDATE, DELETE ON public.roles FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;
-- people: read-only for club users (writes via edge functions / RPC)
REVOKE INSERT, UPDATE, DELETE ON public.people FROM authenticated;
-- enquiries: no direct insert/delete (submission via RPC); update allowed per RLS
REVOKE INSERT, DELETE ON public.enquiries FROM authenticated;
-- notification_jobs: read-only for staff; mailer function uses admin key
REVOKE INSERT, UPDATE, DELETE ON public.notification_jobs FROM authenticated;
-- audit_events: append-only
REVOKE UPDATE, DELETE ON public.audit_events FROM authenticated;
REVOKE ALL ON public.audit_events FROM anon;
-- seasons read-only
REVOKE INSERT, UPDATE, DELETE ON public.seasons FROM authenticated;
-- digest_runs: read-only for staff; agent uses admin key
REVOKE INSERT, UPDATE, DELETE ON public.digest_runs FROM authenticated;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.tasks, public.interactions TO authenticated; -- RLS decides rows
GRANT UPDATE ON public.enquiries TO authenticated; -- stage updates per RLS; inserts only via RPC
GRANT INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.attendance TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.milestones, public.participations, public.data_imports TO authenticated;

------------------------------------------------------------------------
-- Action queue view (plan P0.6): open/attempted tasks with overdue derived
------------------------------------------------------------------------
CREATE VIEW public.action_queue
WITH (security_invoker = true) AS
SELECT
  t.id            AS task_id,
  t.type          AS task_type,
  t.state         AS task_state,
  t.due_at,
  (t.due_at < NOW() AND t.state IN ('open','attempted')) AS overdue,
  t.person_id,
  p.first_name,
  p.last_name,
  p.email,
  p.phone,
  e.id            AS enquiry_id,
  e.stage         AS enquiry_stage,
  e.utm_source,
  e.created_at    AS enquired_at,
  t.owner_id      AS owner_id
FROM public.tasks t
JOIN public.people p ON p.id = t.person_id
LEFT JOIN public.enquiries e ON e.id = t.enquiry_id
WHERE t.state IN ('open','attempted','reassigned');

REVOKE ALL ON public.action_queue FROM anon;
GRANT SELECT ON public.action_queue TO authenticated;

------------------------------------------------------------------------
-- RPC: submit_enquiry — atomic WF-01 write (plan §5).
-- Called by edge function submit-enquiry with admin key (project_admin bypasses RLS).
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_enquiry(
  p_idempotency_key TEXT,
  p_first_name      TEXT,
  p_last_name       TEXT,
  p_email           TEXT,
  p_phone           TEXT,
  p_consent         BOOLEAN,
  p_source          TEXT,
  p_landing_url     TEXT,
  p_referrer        TEXT,
  p_utm_source      TEXT,
  p_utm_medium      TEXT,
  p_utm_campaign    TEXT,
  p_answers         JSONB,
  p_ip_hash         TEXT,
  p_user_agent      TEXT,
  p_season_id       UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_person_id   UUID;
  v_enquiry_id  UUID;
  v_task_id     UUID;
  v_assignee    UUID;
  v_stage       public.enquiry_stage := 'new';
  v_existing    public.enquiries%ROWTYPE;
BEGIN
  -- idempotency: same key returns the original enquiry (plan WF-01.4)
  SELECT * INTO v_existing FROM public.enquiries WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'duplicate', true,
      'person_id', v_existing.person_id,
      'enquiry_id', v_existing.id,
      'stage', v_existing.stage
    );
  END IF;

  -- dedupe person by email (case-insensitive, active rows only)
  SELECT id INTO v_person_id
  FROM public.people
  WHERE LOWER(email) = LOWER(p_email) AND deleted_at IS NULL;

  IF v_person_id IS NULL THEN
    INSERT INTO public.people (first_name, last_name, email, phone, consent_contact, consent_at, source)
    VALUES (p_first_name, p_last_name, LOWER(p_email), p_phone, p_consent,
            CASE WHEN p_consent THEN NOW() ELSE NULL END, p_source)
    RETURNING id INTO v_person_id;
  ELSE
    -- re-consent / update contact details on re-enquiry
    UPDATE public.people
    SET first_name = COALESCE(p_first_name, first_name),
        phone = COALESCE(p_phone, phone),
        consent_contact = consent_contact OR p_consent,
        consent_at = CASE WHEN p_consent AND consent_at IS NULL THEN NOW() ELSE consent_at END,
        contact_opt_out = FALSE,
        deleted_at = NULL
    WHERE id = v_person_id;
  END IF;

  INSERT INTO public.enquiries (
    person_id, season_id, channel, landing_url, referrer,
    utm_source, utm_medium, utm_campaign, answers,
    stage, idempotency_key, ip_hash, user_agent
  ) VALUES (
    v_person_id, p_season_id, 'web', p_landing_url, p_referrer,
    p_utm_source, p_utm_medium, p_utm_campaign, COALESCE(p_answers, '{}'::jsonb),
    'new', p_idempotency_key, p_ip_hash, p_user_agent
  ) RETURNING id INTO v_enquiry_id;

  -- deterministic assignment: round-robin over active volunteers by load, else unassigned (plan §12 default)
  SELECT ur.user_id INTO v_assignee
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  LEFT JOIN public.tasks t ON t.owner_id = ur.user_id AND t.state IN ('open','attempted')
  WHERE r.name = 'volunteer'
  GROUP BY ur.user_id
  ORDER BY COUNT(t.id) ASC, ur.user_id ASC
  LIMIT 1;

  IF v_assignee IS NOT NULL THEN
    v_stage := 'assigned';
  END IF;

  UPDATE public.enquiries
  SET stage = v_stage, assigned_to = v_assignee, stage_updated_at = NOW()
  WHERE id = v_enquiry_id;

  -- 48-hour initial call task (plan P0.4)
  IF v_assignee IS NOT NULL THEN
    INSERT INTO public.tasks (person_id, season_id, enquiry_id, type, state, owner_id, due_at)
    VALUES (v_person_id, p_season_id, v_enquiry_id, 'make_initial_call', 'open', v_assignee, NOW() + INTERVAL '48 hours')
    RETURNING id INTO v_task_id;
  END IF;

  -- confirmation email job, queued once (plan P0.3; real send gated on approval — D4)
  INSERT INTO public.notification_jobs (type, person_id, enquiry_id, to_email, subject, body, idempotency_key)
  VALUES (
    'confirmation_email', v_person_id, v_enquiry_id, LOWER(p_email),
    'Welcome to the Denver Bulldogs — your first training info',
    'Thanks for your interest! A club volunteer will be in touch. Next confirmed training details are on our website.',
    'enquiry-confirm:' || p_idempotency_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  INSERT INTO public.audit_events (actor_id, action, table_name, record_id, after)
  VALUES (NULL, 'enquiry.created', 'enquiries', v_enquiry_id,
          jsonb_build_object('person_id', v_person_id, 'stage', v_stage, 'assigned_to', v_assignee));

  RETURN jsonb_build_object(
    'ok', true, 'duplicate', false,
    'person_id', v_person_id,
    'enquiry_id', v_enquiry_id,
    'task_id', v_task_id,
    'stage', v_stage,
    'assigned_to', v_assignee
  );
END;
$$;
