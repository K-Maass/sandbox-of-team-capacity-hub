-- Small usability extension: reusable skills on demand and immediate shared updates.
ALTER TABLE public.demands
  ADD COLUMN IF NOT EXISTS skills TEXT[] NOT NULL DEFAULT '{}';

-- Supabase Realtime is optional on non-Supabase Postgres. When available, publish
-- the three shared tables so connected browsers receive INSERT/UPDATE/DELETE events.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'consultants'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.consultants';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'demands'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.demands';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'allocations'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.allocations';
    END IF;
  END IF;
END
$$;
