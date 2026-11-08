-- Sprint 5 (plan §9): privacy erasure / data-subject request path.
-- Admin-only RPC: soft-deletes the person, redacts PII, opts out of contact,
-- cancels queued notifications, and keeps the audit trail + non-PII history.
-- The person's enquiry/task rows remain (anonymized person) so funnel metrics
-- stay truthful; contact details are gone.

CREATE OR REPLACE FUNCTION public.request_privacy_erasure(p_person_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_p public.people%ROWTYPE;
  v_jobs INT;
BEGIN
  IF NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'not allowed: admin only';
  END IF;
  IF p_person_id IS NULL THEN RAISE EXCEPTION 'person_id required'; END IF;

  SELECT * INTO v_p FROM public.people WHERE id = p_person_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'person not found'; END IF;
  IF v_p.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_erased', true, 'person_id', p_person_id);
  END IF;

  UPDATE public.people
  SET first_name = 'Deleted',
      last_name = NULL,
      preferred_name = NULL,
      email = 'deleted-' || p_person_id || '@redacted.invalid',
      phone = NULL,
      consent_contact = FALSE,
      contact_opt_out = TRUE,
      privacy_notes = COALESCE(privacy_notes, '') || 'erasure requested ' || NOW()::date,
      deleted_at = NOW()
  WHERE id = p_person_id;

  UPDATE public.notification_jobs
  SET status = 'cancelled', last_error = 'cancelled: privacy erasure'
  WHERE person_id = p_person_id AND status IN ('queued', 'sending');
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  INSERT INTO public.audit_events (actor_id, action, table_name, record_id, before, after)
  VALUES (auth.uid(), 'privacy.erasure', 'people', p_person_id,
          jsonb_build_object('email', v_p.email),
          jsonb_build_object('deleted_at', NOW(), 'notifications_cancelled', v_jobs));

  RETURN jsonb_build_object('ok', true, 'person_id', p_person_id, 'notifications_cancelled', v_jobs);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_privacy_erasure(UUID) TO authenticated;
