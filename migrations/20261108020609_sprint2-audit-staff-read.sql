-- Sprint 2: volunteers need the activity timeline on their own leads (plan P0.5),
-- so audit_events becomes readable by all club staff (still append-only, no anon).
-- Row-level PII stays protected: people/enquiries RLS still limits leads to assignee/staff.
DROP POLICY IF EXISTS "audit readable by coordinator/admin" ON public.audit_events;
CREATE POLICY "audit readable by club staff" ON public.audit_events
  FOR SELECT TO authenticated USING (public.is_staff());
