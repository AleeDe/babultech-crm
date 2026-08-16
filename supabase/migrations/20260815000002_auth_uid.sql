-- Switch identity resolution from a session variable to Supabase Auth.
--
-- 001_scope_helpers.sql read `app.user_id`, a per-transaction setting the
-- application had to remember to set. Now that auth.users is the identity of
-- record, the JWT carries it and auth.uid() reads it directly — no application
-- cooperation required, so a forgotten set_config() can no longer silently
-- widen or blank a user's visibility.
--
-- app_user.id === auth.users.id (see scripts/migrate-auth-users.mjs), so the
-- swap is transparent to every other helper and policy.
--
-- The session-variable path is retained as a FALLBACK: the characterization
-- tests and any server-side tooling connect with a direct Postgres role where
-- no JWT exists. auth.uid() wins when present.

create or replace function app_current_user_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    -- Supabase Auth: identity from the verified JWT.
    auth.uid(),
    -- Fallback for direct database connections (tests, migrations, jobs).
    nullif(current_setting('app.user_id', true), '')::uuid
  );
$$;
