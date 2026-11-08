-- Sprint 2 fixes: qualify ambiguous person_id in recruitment_stats; use auth.users.metadata/profile
-- (InsForge auth schema has no raw_user_meta_data) in upsert_my_club_member.

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
  SELECT email,
         COALESCE(metadata ->> 'full_name', profile ->> 'name', split_part(email, '@', 1))
    INTO v_email, v_name
  FROM auth.users WHERE id = auth.uid();

  INSERT INTO public.club_members (id, email, full_name)
  VALUES (auth.uid(), v_email, v_name)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, active = TRUE;

  RETURN jsonb_build_object('ok', true, 'id', auth.uid(), 'email', v_email);
END;
$$;

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
  ),
  attended AS (
    SELECT DISTINCT a.person_id
    FROM public.attendance a
    JOIN window_enquiries e ON e.person_id = a.person_id
    WHERE a.checked_in_at >= p_since
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
    'first_training_attendance_window', (SELECT count(*) FROM attended),
    'first_training_conversion_window', (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE round(100.0 * (SELECT count(*) FROM attended) / count(*), 1) END FROM window_enquiries)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
