-- Capacity Hub's initial schema, squashed from the existing Drizzle migrations:
--   0000_collaboration_foundation.sql
--   0001_usability_and_realtime.sql
--   0002_planning_extensions.sql

CREATE TABLE public.consultants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Links a roster entry to at most one authenticated account. This intentionally
  -- remains nullable and is not a foreign key to auth.users, matching current behavior.
  user_id UUID,
  name TEXT NOT NULL,
  surname TEXT NOT NULL,
  email TEXT,
  level TEXT NOT NULL DEFAULT 'Consultant',
  role TEXT NOT NULL DEFAULT 'Strategy',
  skills TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  working_capacity INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT consultants_user_id_key UNIQUE (user_id),
  CONSTRAINT consultants_level_check
    CHECK (level IN ('Junior', 'Consultant', 'Senior', 'Manager', 'Partner')),
  CONSTRAINT consultants_role_check
    CHECK (role IN ('Strategy', 'Data', 'Engineering', 'Design', 'Product', 'Operations')),
  CONSTRAINT consultants_working_capacity_check
    CHECK (working_capacity >= 0 AND working_capacity <= 100)
);

CREATE UNIQUE INDEX consultants_email_lower_key
  ON public.consultants (lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE public.demands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'Project',
  status TEXT NOT NULL DEFAULT 'Incoming',
  description TEXT NOT NULL DEFAULT '',
  start_date DATE,
  end_date DATE,
  required_capacity INTEGER NOT NULL DEFAULT 0,
  -- Audit metadata supplied by the current data layer. It intentionally remains
  -- nullable and is not a foreign key to auth.users.
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  skills TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  owner_consultant_id UUID,
  CONSTRAINT demands_type_check
    CHECK (type IN ('Project', 'Topic', 'RfP')),
  CONSTRAINT demands_status_check
    CHECK (status IN ('Incoming', 'In Progress', 'Won', 'Lost')),
  CONSTRAINT demands_required_capacity_check
    CHECK (required_capacity >= 0 AND required_capacity <= 1000),
  CONSTRAINT demands_owner_consultant_id_fkey
    FOREIGN KEY (owner_consultant_id)
    REFERENCES public.consultants (id)
    ON UPDATE NO ACTION
    ON DELETE SET NULL
);

CREATE INDEX demands_owner_consultant_idx
  ON public.demands (owner_consultant_id);

CREATE TABLE public.allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id UUID NOT NULL,
  consultant_id UUID NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 25,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT allocations_demand_id_fkey
    FOREIGN KEY (demand_id)
    REFERENCES public.demands (id)
    ON UPDATE NO ACTION
    ON DELETE CASCADE,
  CONSTRAINT allocations_consultant_id_fkey
    FOREIGN KEY (consultant_id)
    REFERENCES public.consultants (id)
    ON UPDATE NO ACTION
    ON DELETE CASCADE,
  CONSTRAINT allocations_capacity_check
    CHECK (capacity > 0 AND capacity <= 100),
  -- Required by supabase-js upserts using onConflict: "demand_id,consultant_id".
  CONSTRAINT allocations_demand_id_consultant_id_key
    UNIQUE (demand_id, consultant_id)
);

CREATE INDEX allocations_consultant_idx
  ON public.allocations (consultant_id);
CREATE INDEX allocations_demand_idx
  ON public.allocations (demand_id);

CREATE TABLE public.availability_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT availability_blocks_consultant_id_fkey
    FOREIGN KEY (consultant_id)
    REFERENCES public.consultants (id)
    ON UPDATE NO ACTION
    ON DELETE CASCADE,
  CONSTRAINT availability_blocks_date_order_check
    CHECK (end_date >= start_date)
);

CREATE INDEX availability_blocks_consultant_idx
  ON public.availability_blocks (consultant_id);
CREATE INDEX availability_blocks_date_idx
  ON public.availability_blocks (start_date, end_date);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER consultants_set_updated_at
  BEFORE UPDATE ON public.consultants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER demands_set_updated_at
  BEFORE UPDATE ON public.demands
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER allocations_set_updated_at
  BEFORE UPDATE ON public.allocations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER availability_blocks_set_updated_at
  BEFORE UPDATE ON public.availability_blocks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

REVOKE ALL PRIVILEGES ON TABLE public.consultants FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.demands FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.allocations FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.availability_blocks FROM anon;

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.consultants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.demands TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.allocations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.availability_blocks TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.consultants TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.demands TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.allocations TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.availability_blocks TO service_role;

ALTER TABLE public.consultants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_blocks ENABLE ROW LEVEL SECURITY;

-- TRUSTED-TEAM POLICY WARNING
-- These intentionally broad policies preserve the application's current collaborative
-- behavior: every authenticated user may read and modify all Capacity Hub data.
-- Replace them with organization membership and role-based access control policies
-- before rolling the application out to a real team or storing sensitive client data.

CREATE POLICY "Authenticated can read consultants"
  ON public.consultants FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert consultants"
  ON public.consultants FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update consultants"
  ON public.consultants FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete consultants"
  ON public.consultants FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated can read demands"
  ON public.demands FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert demands"
  ON public.demands FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update demands"
  ON public.demands FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete demands"
  ON public.demands FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated can read allocations"
  ON public.allocations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert allocations"
  ON public.allocations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update allocations"
  ON public.allocations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete allocations"
  ON public.allocations FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated can read availability blocks"
  ON public.availability_blocks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert availability blocks"
  ON public.availability_blocks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update availability blocks"
  ON public.availability_blocks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete availability blocks"
  ON public.availability_blocks FOR DELETE TO authenticated USING (true);

-- Supabase Realtime is expected to provide this publication in both local and hosted
-- Supabase environments. Add each table once so the migration remains safe if a table
-- was already enabled through local project configuration.
DO $$
DECLARE
  target_table TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'Expected Supabase Realtime publication "supabase_realtime" was not found';
  END IF;

  FOREACH target_table IN ARRAY ARRAY[
    'consultants',
    'demands',
    'allocations',
    'availability_blocks'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = target_table
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        target_table
      );
    END IF;
  END LOOP;
END;
$$;
