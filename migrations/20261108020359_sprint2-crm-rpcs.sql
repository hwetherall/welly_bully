-- Sprint 2 (plan P0.5/P0.6): volunteer CRM RPCs + coordinator stats.
-- All RPCs are SECURITY DEFINER (called by authenticated club users) and therefore
-- MUST check permissions themselves via auth.uid() (RLS is bypassed inside them).
-- audit_events gets a row for every mutation (plan: timestamp + actor per transition).

CREATE INDEX IF NOT EXISTS enquiries_created_idx ON public.enquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS interactions_enquiry_idx ON public.interactions (enquiry_id) WHERE enquiry_id IS NOT NULL;

------------------------------------------------------------------------
-- upsert_my_club_member: staff self-registration in club_members (Sprint 1 follow-up).
-- WHY: edge functions need a volunteer's email; auth.users is not exposed over PostgREST.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_my_club_member()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_email TEXT;
  v_name  TEXT;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'not a club member';
  END IF;
  SELECT email, COALESCE(raw_user_meta_data ->> 'full_name', split_part(email, '@', 1))
    INTO v_email, v_name
  FROM auth.users WHERE id = auth.uid();

  INSERT INTO public.club_members (id, email, full_name)
  VALUES (auth.uid(), v_email, v_name)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, active = TRUE;

  RETURN jsonb_build_object('ok', true, 'id', auth.uid(), 'email', v_email);
END;
$$;

------------------------------------------------------------------------
-- set_enquiry_stage: volunteer on own assigned lead, or coordinator/admin on any.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_enquiry_stage(p_enquiry_id UUID, p_stage TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_old public.enquiries%ROWTYPE;
  v_new public.enquiries%ROWTYPE;
BEGIN
  SELECT * INTO v_old FROM public.enquiries WHERE id = p_enquiry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'enquiry not found'; END IF;

  IF NOT (public.has_any_role(ARRAY['admin','coordinator']) OR v_old.assigned_to = auth.uid()) THEN
    RAISE EXCEPTION 'not allowed: only the assignee or coordinator/admin can change stage';
  END IF;

  UPDATE public.enquiries
  SET stage = p_stage::public.enquiry_stage,
      stage_updated_at = NOW(),
      stage_updated_by = auth.uid()
  WHERE id = p_enquiry_id
  RETURNING * INTO v_new;

  INSERT INTO public.audit_events (actor_id, action, table_name, record_id, before, after)
  VALUES (auth.uid(), 'stage.changed', 'enquiries', p_enquiry_id,
          jsonb_build_object('stage', v_old.stage), jsonb_build_object('stage', v_new.stage));

  RETURN to_jsonb(v_new);
END;
$$;

------------------------------------------------------------------------
-- log_interaction: record a manual call/contact + optional stage advance.
-- Permission: staff who own the lead (assignee) or coordinator/admin/coach.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_interaction(
  p_person_id UUID,
  p_enquiry_id UUID,
  p_type TEXT,
  p_outcome TEXT,
  p_summary TEXT,
  p_next_action TEXT,
  p_next_action_due TIMESTAMPTZ,
  p_stage TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_int public.interactions%ROWTYPE;
  v_stage public.enquiry_stage;
BEGIN
  IF NOT public.is_staff() THEN RAISE EXCEPTION 'not a club member'; END IF;
  IF NOT (public.has_any_role(ARRAY['admin','coordinator','coach']) OR public.assigned_to_me(p_person_id)) THEN
    RAISE EXCEPTION 'not allowed: only the assignee or staff can log interactions for this person';
  END IF;
  IF p_summary IS NULL OR length(trim(p_summary)) = 0 THEN
    RAISE EXCEPTION 'summary is required';
  END IF;

  INSERT INTO public.interactions (person_id, enquiry_id, author_id, type, outcome, summary, next_action, next_action_due)
  VALUES (p_person_id, p_enquiry_id, auth.uid(), p_type::public.interaction_type, p_outcome, p_summary, p_next_action, p_next_action_due)
  RETURNING * INTO v_int;

  IF p_stage IS NOT NULL THEN
    v_stage := p_stage::public.enquiry_stage;
    UPDATE public.enquiries
    SET stage = v_stage, stage_updated_at = NOW(), stage_updated_by = auth.uid()
    WHERE id = p_enquiry_id AND (assigned_to = auth.uid() OR public.has_any_role(ARRAY['admin','coordinator']));
  END IF;

  INSERT INTO public.audit_events (actor_id, action, table_name, record_id, after)
  VALUES (auth.uid(), 'interaction.logged', 'interactions', v_int.id, to_jsonb(v_int));

  RETURN to_jsonb(v_int);
END;
$$;

------------------------------------------------------------------------
-- complete_task: owner or staff marks a task done with an outcome.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_task(p_task_id UUID, p_outcome TEXT, p_notes TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_old public.tasks%ROWTYPE;
  v_new public.tasks%ROWTYPE;
BEGIN
  SELECT * INTO v_old FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  IF NOT (public.is_staff() OR v_old.owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF v_old.state = 'completed' THEN
    RETURN to_jsonb(v_old); -- idempotent
  END IF;

  UPDATE public.tasks
  SET state = 'completed', completed_at = NOW(), outcome = p_outcome, notes = COALESCE(p_notes, notes)
  WHERE id = p_task_id
  RETURNING * INTO v_new;

  INSERT INTO public.audit_events (actor_id, action, table_name, record_id, before, after)
  VALUES (auth.uid(), 'task.completed', 'tasks', p_task_id,
          jsonb_build_object('state', v_old.state), jsonb_build_object('state', v_new.state, 'outcome', v_new.outcome));

  RETURN to_jsonb(v_new);
END;
$$;

------------------------------------------------------------------------
-- reassign_enquiry: coordinator/admin only. Old open tasks -> 'reassigned',
-- new make_initial_call task (due +48h) for the new owner. Audit trail kept.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reassign_enquiry(p_enquiry_id UUID, p_new_owner UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_old public.enquiries%ROWTYPE;
  v_task UUID;
BEGIN
  IF NOT public.has_any_role(ARRAY['admin','coordinator']) THEN
    RAISE EXCEPTION 'not allowed: coordinator/admin only';
  END IF;
  SELECT * INTO v_old FROM public.enquiries WHERE id = p_enquiry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'enquiry not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
                 WHERE ur.user_id = p_new_owner AND r.name = 'volunteer') THEN
    RAISE EXCEPTION 'new owner must have the volunteer role';
  END IF;

  UPDATE public.tasks
  SET state = 'reassigned', updated_at = NOW()
  WHERE enquiry_id = p_enquiry_id AND state IN ('open','attempted');

  UPDATE public.enquiries
  SET assigned_to = p_new_owner, stage = CASE WHEN stage = 'new' THEN 'assigned' ELSE stage END,
      stage_updated_at = NOW(), stage_updated_by = auth.uid()
  WHERE id = p_enquiry_id
  RETURNING * INTO v_old;

  INSERT INTO public.tasks (person_id, season_id, enquiry_id, type, state, owner_id, due_at)
  VALUES (v_old.person_id, v_old.season_id, p_enquiry_id, 'make_initial_call', 'open', p_new_owner, NOW() + INTERVAL '48 hours')
  RETURNING id INTO v_task;

  INSERT INTO public.audit_events (actor_id, action, table_name, record_id, before, after)
  VALUES (auth.uid(), 'enquiry.reassigned', 'enquiries', p_enquiry_id,
          jsonb_build_object('assigned_to', v_old.assigned_to),
          jsonb_build_object('assigned_to', p_new_owner, 'new_task_id', v_task));

  RETURN jsonb_build_object('ok', true, 'enquiry_id', p_enquiry_id, 'new_owner', p_new_owner, 'new_task_id', v_task);
END;
$$;

------------------------------------------------------------------------
-- recruitment_stats: coordinator dashboard aggregates (plan §7 definitions).
-- Staff-only. All counts are aggregate — safe to show; no row-level PII returned.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recruitment_stats(p_since TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_staff() THEN RAISE EXCEPTION 'not a club member'; END IF;

  WITH window_enquiries AS (
    SELECT * FROM public.enquiries WHERE created_at >= p_since
  ),
  first_attempts AS (
    SELECT e.id AS enquiry_id, e.created_at AS enquired_at,
           MIN(i.created_at) AS first_attempt_at
    FROM window_enquiries e
    JOIN public.interactions i ON i.enquiry_id = e.id
    GROUP BY e.id, e.created_at
  )
  SELECT jsonb_build_object(
    'since', p_since,
    'enquiries_by_stage', (SELECT COALESCE(jsonb_object_agg(stage, c), '{}'::jsonb) FROM (SELECT stage, count(*) c FROM public.enquiries GROUP BY stage) s),
    'enquiries_by_source_window', (SELECT COALESCE(jsonb_object_agg(src, c), '{}'::jsonb) FROM (SELECT COALESCE(utm_source, '(none)') src, count(*) c FROM window_enquiries GROUP BY 1) s),
    'new_enquiries_in_window', (SELECT count(*) FROM window_enquiries),
    'unassigned_enquiries', (SELECT count(*) FROM public.enquiries WHERE assigned_to IS NULL AND stage IN ('new','assigned')),
    'overdue_open_tasks', (SELECT count(*) FROM public.tasks WHERE state IN ('open','attempted') AND due_at < NOW()),
    'median_hours_to_first_attempt', (SELECT COALESCE(round(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_attempt_at - enquired_at)) / 3600.0)::numeric, 1), 0) FROM first_attempts),
    'pct_attempted_within_48h', (SELECT CASE WHEN count(*) = 0 THEN NULL
        ELSE round(100.0 * count(*) FILTER (WHERE first_attempt_at <= enquired_at + INTERVAL '48 hours') / count(*), 1) END FROM first_attempts),
    'first_training_attendance_window', (SELECT count(DISTINCT person_id) FROM public.attendance a JOIN window_enquiries e ON e.person_id = a.person_id WHERE a.checked_in_at >= p_since),
    'first_training_conversion_window', (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE round(100.0 * (SELECT count(DISTINCT a.person_id) FROM public.attendance a JOIN window_enquiries e ON e.person_id = a.person_id WHERE a.checked_in_at >= p_since) / count(*), 1) END FROM window_enquiries)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- RPCs are called by authenticated club users over PostgREST
GRANT EXECUTE ON FUNCTION public.upsert_my_club_member() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_enquiry_stage(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_interaction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_task(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_enquiry(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recruitment_stats(TIMESTAMPTZ) TO authenticated;
