CREATE TABLE public.consultants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE,
  name TEXT NOT NULL,
  surname TEXT NOT NULL,
  email TEXT,
  level TEXT NOT NULL DEFAULT 'Consultant' CHECK (level IN ('Junior','Consultant','Senior','Manager','Partner')),
  role TEXT NOT NULL DEFAULT 'Strategy' CHECK (role IN ('Strategy','Data','Engineering','Design','Product','Operations')),
  skills TEXT[] NOT NULL DEFAULT '{}',
  working_capacity INTEGER NOT NULL DEFAULT 100 CHECK (working_capacity >= 0 AND working_capacity <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX consultants_email_lower_key ON public.consultants (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE public.demands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'Project' CHECK (type IN ('Project','Topic','RfP')),
  status TEXT NOT NULL DEFAULT 'Incoming' CHECK (status IN ('Incoming','In Progress','Won','Lost')),
  description TEXT NOT NULL DEFAULT '',
  start_date DATE,
  end_date DATE,
  required_capacity INTEGER NOT NULL DEFAULT 0 CHECK (required_capacity >= 0 AND required_capacity <= 1000),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id UUID NOT NULL REFERENCES public.demands(id) ON DELETE CASCADE,
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  capacity INTEGER NOT NULL DEFAULT 25 CHECK (capacity > 0 AND capacity <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (demand_id, consultant_id)
);

CREATE INDEX allocations_consultant_idx ON public.allocations (consultant_id);
CREATE INDEX allocations_demand_idx ON public.allocations (demand_id);

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

CREATE TRIGGER consultants_set_updated_at BEFORE UPDATE ON public.consultants
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER demands_set_updated_at BEFORE UPDATE ON public.demands
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER allocations_set_updated_at BEFORE UPDATE ON public.allocations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demands TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.allocations TO authenticated;
GRANT ALL ON public.consultants TO service_role;
GRANT ALL ON public.demands TO service_role;
GRANT ALL ON public.allocations TO service_role;

ALTER TABLE public.consultants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read consultants" ON public.consultants FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert consultants" ON public.consultants FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update consultants" ON public.consultants FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete consultants" ON public.consultants FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated can read demands" ON public.demands FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert demands" ON public.demands FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update demands" ON public.demands FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete demands" ON public.demands FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated can read allocations" ON public.allocations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert allocations" ON public.allocations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update allocations" ON public.allocations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete allocations" ON public.allocations FOR DELETE TO authenticated USING (true);