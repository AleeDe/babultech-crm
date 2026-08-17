-- Make the reporting views obey row security.
--
-- A view runs with the privileges of whoever OWNS it unless told otherwise.
-- These were created by the migration role, so every read went through as that
-- role and the RLS policies on the underlying tables never applied. The
-- "Unrestricted" badge in the Supabase dashboard is reporting exactly this.
--
-- It was not cosmetic. Measured before this change, signed in as an OWN-scope
-- Sales Executive:
--
--   v_sales_pipeline         4 rows via opportunity, 8 via the view
--   v_project_profitability  2 rows via project,     3 via the view
--
-- So any user who could reach PostgREST could read the whole company's
-- pipeline by asking for the view instead of the table — including revenue,
-- margin and partner commission figures their role is scoped out of.
--
-- security_invoker = true makes the view execute as the caller, so the same
-- policies that filter the base tables filter the view. No policy changes are
-- needed and none of the SQL below is rewritten: the definitions are already
-- correct, they were simply running as the wrong role.
--
-- Requires Postgres 15+. Supabase has shipped 15 or later since 2023; the
-- guard below fails loudly rather than silently leaving the views open.

do $$
declare
  v text;
  views text[] := array[
    'v_accounts_receivable',
    'v_accounts_payable',
    'v_revenue_summary',
    'v_project_profitability',
    'v_campaign_performance',
    'v_partner_performance',
    'v_commission_liability',
    'v_sales_pipeline'
  ];
begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception
      'security_invoker views need Postgres 15+; this server is %. '
      'Until it is upgraded these views bypass RLS and must not be granted to end users.',
      current_setting('server_version');
  end if;

  foreach v in array views loop
    if not exists (
      select 1 from pg_views where schemaname = 'public' and viewname = v
    ) then
      raise notice 'skipping %: view does not exist', v;
      continue;
    end if;

    execute format('alter view public.%I set (security_invoker = true)', v);
    raise notice 'security_invoker enabled on %', v;
  end loop;
end $$;
