-- Keep the application CRUD contract while removing unnecessary table privileges
-- from the authenticated role and direct access to the RLS auto-enable helper.

REVOKE TRUNCATE, TRIGGER, REFERENCES
  ON TABLE
    public.consultants,
    public.demands,
    public.allocations,
    public.availability_blocks
  FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE
    public.consultants,
    public.demands,
    public.allocations,
    public.availability_blocks
  TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END;
$$;
