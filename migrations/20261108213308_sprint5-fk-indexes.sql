-- Sprint 5: remaining FK/RLS indexes flagged by advisor scan 5752fff0.
CREATE INDEX IF NOT EXISTS data_imports_importer_id_idx ON public.data_imports (importer_id);
CREATE INDEX IF NOT EXISTS enquiries_stage_updated_by_idx ON public.enquiries (stage_updated_by);
CREATE INDEX IF NOT EXISTS interactions_author_id_idx ON public.interactions (author_id);
CREATE INDEX IF NOT EXISTS digest_runs_reviewed_by_idx ON public.digest_runs (reviewed_by);
CREATE INDEX IF NOT EXISTS tasks_season_id_idx ON public.tasks (season_id);
CREATE INDEX IF NOT EXISTS tasks_person_id_idx ON public.tasks (person_id);
CREATE INDEX IF NOT EXISTS tasks_enquiry_id_idx ON public.tasks (enquiry_id);
CREATE INDEX IF NOT EXISTS enquiries_season_id_idx ON public.enquiries (season_id);
CREATE INDEX IF NOT EXISTS notification_jobs_enquiry_id_idx ON public.notification_jobs (enquiry_id);
CREATE INDEX IF NOT EXISTS participations_season_id_idx ON public.participations (season_id);
CREATE INDEX IF NOT EXISTS milestones_season_id_idx ON public.milestones (season_id);
CREATE INDEX IF NOT EXISTS audit_events_actor_id_idx ON public.audit_events (actor_id);
CREATE INDEX IF NOT EXISTS attendance_person_id_idx ON public.attendance (person_id);
CREATE INDEX IF NOT EXISTS user_roles_granted_by_idx ON public.user_roles (granted_by);
