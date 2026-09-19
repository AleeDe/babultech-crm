select count(*) as installed_triggers from pg_trigger
where tgrelid='public.app_user'::regclass and not tgisinternal
and tgname in ('staff_graph_statement_lock','staff_manager_guard');
select has_table_privilege('authenticated','public.staff_graph_mutex','UPDATE') as authenticated_can_change_mutex,
has_function_privilege('authenticated','public.lock_staff_graph()','EXECUTE') as authenticated_can_call_lock;
select count(*) as remaining_test_profiles from app_user
where "fullName" like 'QA concurrency %' or "fullName" like 'QA graph %';
with recursive paths as (
 select id as origin, id, "managerUserId" as parent, array[id] as seen, false as cycle from app_user
 union all
 select p.origin, u.id, u."managerUserId", p.seen || u.id, u.id=any(p.seen)
 from paths p join app_user u on u.id=p.parent
 where not p.cycle and cardinality(p.seen)<=101
) select count(distinct origin) filter(where cycle) as users_reaching_existing_cycles,
count(distinct origin) filter(where cardinality(seen)>101) as users_with_deep_reporting_lines,
(select count(*) from pg_trigger where tgrelid='public.app_user'::regclass and not tgisinternal and tgname in ('staff_graph_statement_lock','staff_manager_guard')) as installed_triggers,
has_table_privilege('authenticated','public.staff_graph_mutex','UPDATE') as authenticated_can_change_mutex,
has_function_privilege('authenticated','public.lock_staff_graph()','EXECUTE') as authenticated_can_call_lock,
(select count(*) from app_user where "fullName" like 'QA concurrency %' or "fullName" like 'QA graph %') as remaining_test_profiles from paths;
