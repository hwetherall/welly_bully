-- Sprint 4 (plan P1): calendar with change tracking + attendance-derived milestones.
-- events.uid is the stable iCal UID; revision = iCal SEQUENCE; material_change drives
-- the public change banner + WF-04 notices. All mutations via RPCs with in-RPC
-- permission checks (SECURITY DEFINER) + audit_events before/after.

ALTER TYPE public.milestone_type ADD VALUE IF NOT EXISTS 'first_training';
ALTER TYPE public.milestone_type ADD VALUE IF NOT EXISTS 'second_training';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS material_change BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS events_material_change_idx ON public.events (updated_at DESC) WHERE material_change = TRUE AND status = 'published';

------------------------------------------------------------------------
-- upsert_event: calendar_editor/admin only. Creates (uid generated) or updates.
-- On update of a PUBLISHED event: revision always +1; material_change=true when
-- starts_at / ends_at / venue / status(cancel) changed. Audit with before/after.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_event(
  p_id UUID DEFAULT NULL,
  p_type TEXT DEFAULT NULL,
  p_title TEXT DEFAULT NULL,
  p_venue TEXT DEFAULT NULL,
  p_venue_url TEXT DEFAULT NULL,
  p_starts_at TIMESTAMPTZ DEFAULT NULL,
  p_ends_at TIMESTAMPTZ DEFAULT NULL,
  p_time_zone TEXT DEFAULT 'America/Denver',
  p_description TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'draft',
  p_audience TEXT DEFAULT 'public',
  p_change_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_old public.events%ROWTYPE;
  v_new public.events%ROWTYPE;
  v_material BOOLEAN := FALSE;
BEGIN
  IF NOT public.has_any_role(ARRAY['admin','calendar_editor']) THEN
    RAISE EXCEPTION 'not allowed: calendar_editor/admin only';
  END IF;
  IF p_type IS NULL OR p_starts_at IS NULL OR p_ends_at IS NULL THEN RAISE EXCEPTION 'type, starts_at, ends_at required'; END IF;
  IF p_ends_at < p_starts_at THEN RAISE EXCEPTION 'ends_at must be >= starts_at'; END IF;
  IF p_title IS NULL OR trim(p_title) = '' THEN RAISE EXCEPTION 'title required'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.events (uid, type, title, venue, venue_url, starts_at, ends_at, time_zone, description, status, audience, created_by, updated_by)
    VALUES ('bulldogs-' || gen_random_uuid()::text, p_type::public.event_type, trim(p_title), p_venue, p_venue_url,
            p_starts_at, p_ends_at, COALESCE(p_time_zone, 'America/Denver'), p_description,
            p_status::public.event_status, p_audience::public.event_audience, auth.uid(), auth.uid())
    RETURNING * INTO v_new;
    INSERT INTO public.audit_events (actor_id, action, table_name, record_id, after)
    VALUES (auth.uid(), 'event.created', 'events', v_new.id, to_jsonb(v_new));
    RETURN to_jsonb(v_new);
  END IF;

  SELECT * INTO v_old FROM public.events WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event not found'; END IF;

  -- WF-04: material change = time/venue/cancellation on a published event
  IF v_old.status = 'published' AND (
       v_old.starts_at IS DISTINCT FROM p_starts_at
    OR v_old.ends_at   IS DISTINCT FROM p_ends_at
    OR v_old.venue     IS DISTINCT FROM p_venue
    OR p_status = 'cancelled') THEN
    v_material := TRUE;
  END IF;

  UPDATE public.events
  SET type = p_type::public.event_type,
      title = trim(p_title),
      venue = p_venue,
      venue_url = p_venue_url,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      time_zone = COALESCE(p_time_zone, 'America/Denver'),
      description = p_description,
      status = p_status::public.event_status,
      audience = p_audience::public.event_audience,
      revision = revision + 1,
      material_change = CASE WHEN v_material THEN TRUE ELSE material_change END,
      change_note = COALESCE(p_change_note, change_note),
      updated_by = auth.uid()
  WHERE id = p_id
  RETURNING * INTO v_new;

  INSERT INTO public.audit_events (actor_id, action, table_name, record_id, before, after)
  VALUES (auth.uid(), CASE WHEN v_material THEN 'event.material_change' ELSE 'event.updated' END,
          'events', p_id, to_jsonb(v_old), to_jsonb(v_new));

  RETURN to_jsonb(v_new);
END;
$$;

------------------------------------------------------------------------
-- mark_attendance: coach/coordinator/admin. Upsert per (event, person).
-- Derives first_training / second_training milestones (plan funnel steps 7-8,
-- derived from attendance, never manually guessed). Milestone season = the season
-- containing the event date (fallback: latest non-closed season).
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_attendance(
  p_event_id UUID DEFAULT NULL,
  p_person_id UUID DEFAULT NULL,
  p_walk_in BOOLEAN DEFAULT FALSE,
  p_consent_recorded BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_att public.attendance%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_season UUID;
  v_count INT;
  v_derived TEXT[] := '{}';
BEGIN
  IF NOT public.has_any_role(ARRAY['admin','coordinator','coach']) THEN
    RAISE EXCEPTION 'not allowed: coach/coordinator/admin only';
  END IF;
  IF p_event_id IS NULL OR p_person_id IS NULL THEN RAISE EXCEPTION 'event_id and person_id required'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event not found'; END IF;

  INSERT INTO public.attendance (event_id, person_id, checked_in_by, walk_in, consent_recorded)
  VALUES (p_event_id, p_person_id, auth.uid(), p_walk_in, p_consent_recorded)
  ON CONFLICT (event_id, person_id) DO UPDATE
    SET walk_in = attendance.walk_in OR EXCLUDED.walk_in,
        consent_recorded = attendance.consent_recorded OR EXCLUDED.consent_recorded,
        checked_in_by = EXCLUDED.checked_in_by,
        checked_in_at = NOW()
  RETURNING * INTO v_att;

  SELECT id INTO v_season FROM public.seasons
  WHERE v_event.starts_at::date >= starts_on AND v_event.starts_at::date <= ends_on
  ORDER BY year DESC LIMIT 1;
  IF v_season IS NULL THEN
    SELECT id INTO v_season FROM public.seasons WHERE state <> 'closed' ORDER BY year DESC LIMIT 1;
  END IF;

  SELECT count(*) INTO v_count FROM public.attendance WHERE person_id = p_person_id;

  IF v_count = 1 THEN
    INSERT INTO public.milestones (person_id, season_id, type, source, recorded_by)
    VALUES (p_person_id, v_season, 'first_training', 'derived from attendance', auth.uid())
    ON CONFLICT (person_id, season_id, type) DO NOTHING;
    IF FOUND THEN v_derived := array_append(v_derived, 'first_training'); END IF;
  ELSIF v_count = 2 THEN
    INSERT INTO public.milestones (person_id, season_id, type, source, recorded_by)
    VALUES (p_person_id, v_season, 'second_training', 'derived from attendance', auth.uid())
    ON CONFLICT (person_id, season_id, type) DO NOTHING;
    IF FOUND THEN v_derived := array_append(v_derived, 'second_training'); END IF;
  END IF;

  INSERT INTO public.audit_events (actor_id, action, table_name, record_id, after)
  VALUES (auth.uid(), 'attendance.marked', 'attendance', v_att.id, to_jsonb(v_att));

  RETURN jsonb_build_object('attendance', to_jsonb(v_att), 'milestones_derived', v_derived, 'total_attendance_count', v_count);
END;
$$;

------------------------------------------------------------------------
-- queue_event_update_notice: WF-04 step 4 — admin-reviewed, MANUAL notice to
-- opted-in participants only (consent_contact AND NOT contact_opt_out AND
-- attended this event or picked it as preferred session). Idempotent per
-- event+revision. Delivery goes through notification_jobs (dry-run until approved).
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.queue_event_update_notice(p_event_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_person RECORD;
  v_count INT := 0;
  v_key TEXT;
BEGIN
  IF NOT public.has_any_role(ARRAY['admin','coordinator']) THEN
    RAISE EXCEPTION 'not allowed: coordinator/admin only';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event not found'; END IF;
  v_key := 'event-notice:' || p_event_id || ':' || v_event.revision;

  FOR v_person IN
    SELECT DISTINCT p.id, p.email, p.first_name
    FROM public.people p
    WHERE p.deleted_at IS NULL
      AND p.consent_contact = TRUE
      AND p.contact_opt_out = FALSE
      AND (
        EXISTS (SELECT 1 FROM public.attendance a WHERE a.event_id = p_event_id AND a.person_id = p.id)
        OR EXISTS (SELECT 1 FROM public.enquiries e WHERE e.person_id = p.id AND e.answers ->> 'preferredEventId' = p_event_id::text)
      )
  LOOP
    INSERT INTO public.notification_jobs (type, person_id, to_email, subject, body, idempotency_key)
    VALUES (
      'operational_notice', v_person.id, v_person.email,
      'Change to: ' || v_event.title,
      'Hi ' || COALESCE(v_person.first_name, 'Bulldog') || E'\n\nThere is an update to an event you are signed up for:\n\n'
        || v_event.title || E'\nWhen: ' || to_char(v_event.starts_at AT TIME ZONE v_event.time_zone, 'Dy DD Mon YYYY, HH12:MI AM TZ')
        || CASE WHEN v_event.ends_at IS NOT NULL THEN ' - ' || to_char(v_event.ends_at AT TIME ZONE v_event.time_zone, 'HH12:MI AM') ELSE '' END
        || E'\nWhere: ' || COALESCE(v_event.venue, 'TBC')
        || CASE WHEN v_event.change_note IS NOT NULL THEN E'\n\nClub note: ' || v_event.change_note ELSE '' END
        || E'\n\nSee the club calendar for the latest details.\n— Denver Bulldogs',
      v_key
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
    IF FOUND THEN v_count := v_count + 1; END IF;
  END LOOP;

  INSERT INTO public.audit_events (actor_id, action, table_name, record_id, after)
  VALUES (auth.uid(), 'event.notice_queued', 'events', p_event_id,
          jsonb_build_object('revision', v_event.revision, 'recipients', v_count, 'idempotency_key', v_key));

  RETURN jsonb_build_object('ok', true, 'event_id', p_event_id, 'revision', v_event.revision, 'notices_queued', v_count, 'idempotency_key', v_key);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_event(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_attendance(UUID, UUID, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.queue_event_update_notice(UUID) TO authenticated;
