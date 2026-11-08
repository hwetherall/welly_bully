-- Sprint 5: advisor fixes (scan 86cfcd77).
-- 1) dangerous-function (36): Postgres grants EXECUTE to PUBLIC by default, so anon could call
--    our SECURITY DEFINER functions (they self-check and raise, but defense in depth = revoke).
--    submit_enquiry is intake-only via the edge function's admin key -> revoke from ALL runtime roles.
--    Role helpers stay executable by authenticated (RLS policies call them as the querying user);
--    owners (project_admin, used by edge functions/CLI) keep access regardless.
-- 2) missing-fk-index / missing-rls-index: add the indexes the advisor listed.

-- 1) EXECUTE lockdown
REVOKE EXECUTE ON FUNCTION public.has_role(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(TEXT[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.assigned_to_me(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_enquiry(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_my_club_member() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_enquiry_stage(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_interaction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_task(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reassign_enquiry(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recruitment_stats(TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_roster_import(TEXT, UUID, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirm_roster_import(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_reengagement_review(UUID, UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_event(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_attendance(UUID, UUID, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.queue_event_update_notice(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_privacy_erasure(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(TEXT), public.has_any_role(TEXT[]), public.is_staff(), public.assigned_to_me(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_my_club_member(), public.set_enquiry_stage(UUID, TEXT), public.log_interaction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT), public.complete_task(UUID, TEXT, TEXT), public.reassign_enquiry(UUID, UUID), public.recruitment_stats(TIMESTAMPTZ), public.create_roster_import(TEXT, UUID, JSONB), public.confirm_roster_import(UUID), public.create_reengagement_review(UUID, UUID, UUID), public.upsert_event(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT), public.mark_attendance(UUID, UUID, BOOLEAN, BOOLEAN), public.queue_event_update_notice(UUID), public.request_privacy_erasure(UUID) TO authenticated;

-- 2) FK + RLS indexes
CREATE INDEX IF NOT EXISTS events_created_by_idx ON public.events (created_by);
CREATE INDEX IF NOT EXISTS events_updated_by_idx ON public.events (updated_by);
CREATE INDEX IF NOT EXISTS people_created_by_idx ON public.people (created_by);
CREATE INDEX IF NOT EXISTS people_import_id_idx ON public.people (import_id);
CREATE INDEX IF NOT EXISTS notification_jobs_person_id_idx ON public.notification_jobs (person_id);
CREATE INDEX IF NOT EXISTS enquiries_person_id_idx ON public.enquiries (person_id);
CREATE INDEX IF NOT EXISTS milestones_recorded_by_idx ON public.milestones (recorded_by);
CREATE INDEX IF NOT EXISTS user_roles_role_id_idx ON public.user_roles (role_id);
CREATE INDEX IF NOT EXISTS digest_runs_created_by_idx ON public.digest_runs (created_by);
CREATE INDEX IF NOT EXISTS attendance_checked_in_by_idx ON public.attendance (checked_in_by);
CREATE INDEX IF NOT EXISTS events_audience_idx ON public.events (audience);
CREATE INDEX IF NOT EXISTS events_status_idx ON public.events (status);
