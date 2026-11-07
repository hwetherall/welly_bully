-- Sprint 1: internal volunteer alerts + club member directory for the admin app.
-- (runner forbids BEGIN/COMMIT; ALTER TYPE ADD VALUE must run outside a transaction — OK here)

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'internal_alert';
ALTER TYPE public.notification_status ADD VALUE IF NOT EXISTS 'dry_run';

-- club_members: public-profile mirror of auth.users for club staff (login identity lives in managed auth schema).
-- WHY: edge functions need a volunteer's email to address internal alerts, but auth.users is not
-- exposed over PostgREST. Populated by seeds + on staff sign-in in the admin app.
CREATE TABLE public.club_members (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  full_name  TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX club_members_email_uidx ON public.club_members (LOWER(email));

ALTER TABLE public.club_members ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER club_members_updated_at BEFORE UPDATE ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- club users can read the directory (needed to show owner names); only admin manages it
CREATE POLICY "club_members readable by club users" ON public.club_members
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "club_members managed by admin" ON public.club_members
  FOR ALL TO authenticated
  USING (public.has_role('admin'))
  WITH CHECK (public.has_role('admin'));

REVOKE ALL ON public.club_members FROM anon;
GRANT SELECT ON public.club_members TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.club_members FROM authenticated; -- admin via functions/RPC only
