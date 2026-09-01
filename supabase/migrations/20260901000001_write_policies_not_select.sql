-- Stop write policies from silently granting read.
--
-- 45 tables carry a policy declared `FOR ALL USING (app_can_write())`. In
-- Postgres, FOR ALL covers SELECT as well as INSERT/UPDATE/DELETE, and multiple
-- permissive policies on a command are OR'd together. So on every one of those
-- tables the effective read rule was:
--
--     <the carefully scoped read policy>  OR  app_can_write()
--
-- and app_can_write() is only "is this an internal user with any scope at all".
-- The scoped read policy beside it could never deny anything.
--
-- Demonstrated on the live database before this migration: a Consultant on OWN
-- scope, holding neither partner:read nor admin, could read every row of
-- `partner` and every row of `app_user` — names, emails, cost rates, roles.
--
-- The tables that were NOT leaking are the ones whose write policy uses
-- app_can_write_owned("ownerUserId") instead: still FOR ALL, but the USING
-- clause is row-scoped, so OR-ing it into the read rule adds nothing a person
-- could not already see. That helper already existed; it simply was not applied
-- everywhere.
--
-- The fix here is narrower than switching those 45 to the owned variant, and
-- correct for all of them: a write policy has no business granting SELECT in the
-- first place. Splitting FOR ALL into the three write commands leaves reads
-- entirely to the read policies, which is where the scoping already lives.
--
--   * INSERT takes only WITH CHECK — there is no existing row to test.
--   * UPDATE takes both: USING picks which rows may be updated, WITH CHECK
--     validates the result.
--   * DELETE takes only USING.
--
-- Write permission itself is unchanged. Anyone who could write before still
-- can; the application's own requirePermission() and scopeFilter() remain the
-- layer that decides who may change what, exactly as before. What changes is
-- that reading is now governed by the read policies alone.

DO $$
DECLARE
  pol record;
  read_exists boolean;
BEGIN
  FOR pol IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd = 'ALL'
      AND qual = 'app_can_write()'
    ORDER BY tablename
  LOOP
    -- Refuse to touch a table that has no SELECT policy of its own: dropping
    -- the FOR ALL there would take reads from "every internal user" to "nobody"
    -- and break the screen rather than secure it. None are expected — this is a
    -- guard against a table added later without one.
    SELECT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = pol.tablename
        AND cmd = 'SELECT'
    ) INTO read_exists;

    IF NOT read_exists THEN
      RAISE NOTICE 'skipped % — no SELECT policy, dropping FOR ALL would deny all reads', pol.tablename;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (app_can_write())',
      pol.tablename || '_internal_insert', pol.tablename
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE USING (app_can_write()) WITH CHECK (app_can_write())',
      pol.tablename || '_internal_update', pol.tablename
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE USING (app_can_write())',
      pol.tablename || '_internal_delete', pol.tablename
    );

    RAISE NOTICE 'split % into insert/update/delete', pol.tablename;
  END LOOP;
END $$;
