-- Sprint 3 (plan P0.7): returning-player reconciliation.
-- Import flow is two-phase and human-gated: create_roster_import (PREVIEW: validate +
-- match, no writes to people/participations) then confirm_roster_import (writes, with
-- provenance in data_imports + people.import_id). Imported rows NEVER set consent_contact
-- (a past roster does not authorize contact — plan §9): consent stays FALSE; outreach is
-- always a separate human decision (review_reengagement tasks only, never auto-messages).

ALTER TABLE public.people ADD COLUMN IF NOT EXISTS import_id UUID REFERENCES public.data_imports(id) ON DELETE SET NULL;
ALTER TABLE public.data_imports ADD COLUMN IF NOT EXISTS rows JSONB NOT NULL DEFAULT '[]'::jsonb;

------------------------------------------------------------------------
-- returning_player_candidates: people active in a past (closed) season with no
-- participation in the current season. security_invoker so base-table RLS applies.
------------------------------------------------------------------------
CREATE VIEW public.returning_player_candidates
WITH (security_invoker = true) AS
WITH current_season AS (
  SELECT id, year FROM public.seasons WHERE state <> 'closed' ORDER BY year DESC LIMIT 1
),
prev_participation AS (
  SELECT DISTINCT pa.person_id, s.year AS prev_year
  FROM public.participations pa
  JOIN public.seasons s ON s.id = pa.season_id
  WHERE s.state = 'closed' AND pa.membership_status IN ('active', 'pending')
)
SELECT
  p.id            AS person_id,
  p.first_name,
  p.last_name,
  p.email,
  p.phone,
  pp.prev_year    AS previous_season_year,
  cs.year         AS current_season_year,
  (SELECT count(*) FROM public.tasks t
    WHERE t.person_id = p.id AND t.type = 'review_reengagement' AND t.state IN ('open','attempted')) AS open_review_tasks
FROM public.people p
JOIN prev_participation pp ON pp.person_id = p.id
CROSS JOIN current_season cs
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.participations pc
    WHERE pc.person_id = p.id AND pc.season_id = cs.id
  );

GRANT SELECT ON public.returning_player_candidates TO authenticated;
REVOKE ALL ON public.returning_player_candidates FROM anon;

------------------------------------------------------------------------
-- create_roster_import: preview only. Validates + dedupes + matches by email.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_roster_import(
  p_filename TEXT,
  p_season_id UUID,
  p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_import_id UUID;
  v_row JSONB;
  v_idx INT := 0;
  v_email TEXT;
  v_first TEXT;
  v_seen JSONB := '{}'::jsonb;         -- lower(email) -> true, for in-file duplicates
  v_out JSONB := '[]'::jsonb;
  v_new INT := 0; v_existing INT := 0; v_dup INT := 0; v_invalid INT := 0;
  v_person UUID;
  v_season_year INT;
BEGIN
  IF NOT public.has_any_role(ARRAY['admin','coordinator']) THEN
    RAISE EXCEPTION 'not allowed: coordinator/admin only';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'rows must be a JSON array'; END IF;
  SELECT year INTO v_season_year FROM public.seasons WHERE id = p_season_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'season not found'; END IF;

  INSERT INTO public.data_imports (importer_id, filename, status, summary)
  VALUES (auth.uid(), p_filename, 'preview', jsonb_build_object('season_id', p_season_id, 'season_year', v_season_year))
  RETURNING id INTO v_import_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_idx := v_idx + 1;
    v_email := lower(trim(COALESCE(v_row ->> 'email', '')));
    v_first := trim(COALESCE(v_row ->> 'first_name', ''));

    IF v_first = '' OR v_email = '' OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      v_invalid := v_invalid + 1;
      v_out := v_out || jsonb_build_object('row_index', v_idx, 'match', 'invalid',
        'reason', CASE WHEN v_first = '' THEN 'first_name required' ELSE 'valid email required' END,
        'row', v_row);
      CONTINUE;
    END IF;
    IF v_seen ? v_email THEN
      v_dup := v_dup + 1;
      v_out := v_out || jsonb_build_object('row_index', v_idx, 'match', 'duplicate_in_file', 'email', v_email, 'row', v_row);
      CONTINUE;
    END IF;
    v_seen := v_seen || jsonb_build_object(v_email, true);

    SELECT id INTO v_person FROM public.people
    WHERE lower(email) = v_email AND deleted_at IS NULL LIMIT 1;

    IF FOUND THEN
      v_existing := v_existing + 1;
      v_out := v_out || jsonb_build_object('row_index', v_idx, 'match', 'existing', 'person_id', v_person, 'email', v_email, 'row', v_row);
    ELSE
      v_new := v_new + 1;
      v_out := v_out || jsonb_build_object('row_index', v_idx, 'match', 'new', 'email', v_email, 'row', v_row);
    END IF;
  END LOOP;

  UPDATE public.data_imports
  SET rows = v_out,
      summary = summary || jsonb_build_object(
        'total', v_idx, 'new', v_new, 'existing', v_existing,
        'duplicate_in_file', v_dup, 'invalid', v_invalid, 'valid', v_new + v_existing)
  WHERE id = v_import_id;

  INSERT INTO public.audit_events (actor_id, action, table_name, record_id, after)
  VALUES (auth.uid(), 'import.previewed', 'data_imports', v_import_id,
          jsonb_build_object('filename', p_filename, 'total', v_idx, 'valid', v_new + v_existing));

  RETURN jsonb_build_object('import_id', v_import_id, 'total', v_idx, 'new', v_new,
    'existing', v_existing, 'duplicate_in_file', v_dup, 'invalid', v_invalid,
    'valid', v_new + v_existing, 'rows', v_out);
END;
$$;

------------------------------------------------------------------------
-- confirm_roster_import: the only write path. Idempotent per import_id.
-- Creates people WITHOUT contact consent, links provenance, creates the
-- season participation. Existing people are reused (no duplicate profiles).
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_roster_import(p_import_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_imp public.data_imports%ROWTYPE;
  v_row JSONB;
  v_email TEXT;
  v_person UUID;
  v_created INT := 0; v_matched INT := 0; v_participations INT := 0;
BEGIN
  IF NOT public.has_any_role(ARRAY['admin','coordinator']) THEN
    RAISE EXCEPTION 'not allowed: coordinator/admin only';
  END IF;
  SELECT * INTO v_imp FROM public.data_imports WHERE id = p_import_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'import not found'; END IF;
  IF v_imp.status = 'confirmed' THEN
    RETURN jsonb_build_object('ok', true, 'already_confirmed', true, 'import_id', p_import_id);
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_imp.rows) LOOP
    IF v_row ->> 'match' NOT IN ('new', 'existing') THEN CONTINUE; END IF;

    v_email := lower(trim(v_row ->> 'email'));
    SELECT id INTO v_person FROM public.people WHERE lower(email) = v_email AND deleted_at IS NULL LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.people (first_name, last_name, email, phone, source, import_id, consent_contact)
      VALUES (
        trim(v_row -> 'row' ->> 'first_name'),
        nullif(trim(COALESCE(v_row -> 'row' ->> 'last_name', '')), ''),
        v_email,
        nullif(trim(COALESCE(v_row -> 'row' ->> 'phone', '')), ''),
        'roster_import:' || v_imp.filename,
        p_import_id,
        FALSE   -- plan §9: a past roster never implies consent to contact
      )
      RETURNING id INTO v_person;
      v_created := v_created + 1;
    ELSE
      UPDATE public.people SET import_id = COALESCE(import_id, p_import_id) WHERE id = v_person;
      v_matched := v_matched + 1;
    END IF;

    INSERT INTO public.participations (person_id, season_id, pathway, membership_status, notes)
    VALUES (
      v_person,
      (v_imp.summary ->> 'season_id')::UUID,
      COALESCE((v_row -> 'row' ->> 'pathway'), 'mens')::public.pathway_type,
      COALESCE(NULLIF(v_row -> 'row' ->> 'membership_status', ''), 'active')::public.membership_status,
      'imported from ' || v_imp.filename
    )
    ON CONFLICT (person_id, season_id) DO NOTHING;
    IF FOUND THEN v_participations := v_participations + 1; END IF;
  END LOOP;

  UPDATE public.data_imports
  SET status = 'confirmed',
      summary = summary || jsonb_build_object('people_created', v_created, 'people_matched', v_matched, 'participations_created', v_participations, 'confirmed_at', NOW())
  WHERE id = p_import_id;

  INSERT INTO public.audit_events (actor_id, action, table_name, record_id, after)
  VALUES (auth.uid(), 'import.confirmed', 'data_imports', p_import_id,
          jsonb_build_object('people_created', v_created, 'people_matched', v_matched, 'participations_created', v_participations));

  RETURN jsonb_build_object('ok', true, 'import_id', p_import_id, 'people_created', v_created,
    'people_matched', v_matched, 'participations_created', v_participations);
END;
$$;

------------------------------------------------------------------------
-- create_reengagement_review: INTERNAL review task only (plan P0.7 / WF-03).
-- Never sends anything to the player. Idempotent per person+season.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_reengagement_review(
  p_person_id UUID,
  p_season_id UUID,
  p_owner_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_task UUID;
  v_owner UUID;
BEGIN
  IF NOT public.has_any_role(ARRAY['admin','coordinator']) THEN
    RAISE EXCEPTION 'not allowed: coordinator/admin only';
  END IF;
  v_owner := COALESCE(p_owner_id, auth.uid());
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
                 WHERE ur.user_id = v_owner AND r.name IN ('volunteer','coordinator','admin')) THEN
    RAISE EXCEPTION 'owner must be a club volunteer/coordinator/admin';
  END IF;

  SELECT id INTO v_task FROM public.tasks
  WHERE person_id = p_person_id AND season_id = p_season_id
    AND type = 'review_reengagement' AND state IN ('open','attempted')
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'already_exists', true, 'task_id', v_task);
  END IF;

  INSERT INTO public.tasks (person_id, season_id, type, state, owner_id, due_at, notes)
  VALUES (p_person_id, p_season_id, 'review_reengagement', 'open', v_owner, NOW() + INTERVAL '7 days',
          'Internal review only: check history, consent and appropriateness before any manual outreach (plan WF-03).')
  RETURNING id INTO v_task;

  INSERT INTO public.audit_events (actor_id, action, table_name, record_id, after)
  VALUES (auth.uid(), 'task.created', 'tasks', v_task,
          jsonb_build_object('type', 'review_reengagement', 'person_id', p_person_id, 'owner_id', v_owner));

  RETURN jsonb_build_object('ok', true, 'task_id', v_task, 'owner_id', v_owner);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_roster_import(TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_roster_import(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_reengagement_review(UUID, UUID, UUID) TO authenticated;
