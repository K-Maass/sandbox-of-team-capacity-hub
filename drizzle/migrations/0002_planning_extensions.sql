-- Minimal planning extensions: time off, archive instead of delete, demand owner.
ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE public.demands
  ADD COLUMN IF NOT EXISTS owner_consultant_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'demands_owner_consultant_id_fkey'
  ) THEN
    ALTER TABLE public.demands
      ADD CONSTRAINT demands_owner_consultant_id_fkey
      FOREIGN KEY (owner_consultant_id)
      REFERENCES public.consultants(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS demands_owner_consultant_idx
  ON public.demands (owner_consultant_id);

CREATE TABLE IF NOT EXISTS public.availability_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT availability_blocks_date_order_check CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS availability_blocks_consultant_idx
  ON public.availability_blocks (consultant_id);
CREATE INDEX IF NOT EXISTS availability_blocks_date_idx
  ON public.availability_blocks (start_date, end_date);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'availability_blocks_set_updated_at'
  ) THEN
    CREATE TRIGGER availability_blocks_set_updated_at
      BEFORE UPDATE ON public.availability_blocks
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

REVOKE ALL ON public.availability_blocks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_blocks TO authenticated;
GRANT ALL ON public.availability_blocks TO service_role;

ALTER TABLE public.availability_blocks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'availability_blocks'
      AND policyname = 'Authenticated can read availability blocks'
  ) THEN
    CREATE POLICY "Authenticated can read availability blocks"
      ON public.availability_blocks FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'availability_blocks'
      AND policyname = 'Authenticated can insert availability blocks'
  ) THEN
    CREATE POLICY "Authenticated can insert availability blocks"
      ON public.availability_blocks FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'availability_blocks'
      AND policyname = 'Authenticated can update availability blocks'
  ) THEN
    CREATE POLICY "Authenticated can update availability blocks"
      ON public.availability_blocks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'availability_blocks'
      AND policyname = 'Authenticated can delete availability blocks'
  ) THEN
    CREATE POLICY "Authenticated can delete availability blocks"
      ON public.availability_blocks FOR DELETE TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename = 'availability_blocks'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.availability_blocks';
    END IF;
  END IF;
END
$$;
