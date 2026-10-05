-- People, a follow-up to 20261005000000.
--
-- When a renewal or conversion starts, the person's login takes on the new
-- job title, department, manager and hourly cost. And whoever may manage
-- contracts (people:write) can also open the files on them.

-- What an hour of this person costs, for project costing, when the pay is in
-- the base currency and the hours are known. Mirrors hourlyCost() in
-- src/lib/people.ts.
create or replace function people_hourly_cost(p_contract uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(case c."payBasis"
           when 'HOURLY' then c."payAmount"
           when 'DAILY' then c."payAmount" / 8
           when 'WEEKLY' then c."payAmount" / nullif(c."hoursPerWeek", 0)
           when 'MONTHLY' then c."payAmount" * 12 / nullif(c."hoursPerWeek" * 52, 0)
           when 'FIXED' then c."payAmount" / nullif(c."hoursPerWeek" * (52.0 / 12) * c."tenureMonths", 0)
         end, 2)
    from employment_contract c
    join currency cur on cur."isBase" and trim(cur.code) = trim(c."currencyCode")
   where c.id = p_contract and c."payAmount" > 0;
$$;
revoke all on function people_hourly_cost(uuid) from public, anon, authenticated;

create or replace function app_people_document_access(p_type text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_type not in ('StaffProfile', 'EmploymentContract') then true
    when app_has_permission('people:read') or app_has_permission('people:write') then true
    when p_type = 'StaffProfile' then exists (
      select 1 from staff_profile s where s.id = p_id and s."userId" = app_current_user_id())
    else exists (
      select 1 from employment_contract c join staff_profile s on s.id = c."staffId"
       where c.id = p_id and s."userId" = app_current_user_id())
  end;
$$;
revoke all on function app_people_document_access(text, uuid) from public, anon;
grant execute on function app_people_document_access(text, uuid) to authenticated;

create or replace function people_contract_tick()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_row record;
  v_count integer := 0;
  v_days integer;
  v_bucket integer;
begin
  -- 1. A signed contract whose start date has come starts. The one it follows
  --    is then renewed (same kind) or converted (a different kind).
  for v_row in
    select c.id, c."staffId", c."previousContractId", c."contractType", s."userId"
      from employment_contract c join staff_profile s on s.id = c."staffId"
     where c.status = 'SIGNED' and c."startDate" <= v_today
  loop
    update employment_contract set status = 'ACTIVE', "updatedAt" = now() where id = v_row.id;
    update employment_contract p
       set status = case when p."contractType" = v_row."contractType" then 'RENEWED' else 'CONVERTED' end,
           "closedAt" = now(), "updatedAt" = now()
     where p.id = v_row."previousContractId" and p.status in ('ACTIVE', 'ENDED');
    update staff_profile set status = 'ACTIVE', "updatedAt" = now() where id = v_row."staffId" and status <> 'ACTIVE';
    -- Back from a lapse: a login switched off when the last term ended comes
    -- back on. One suspended by hand stays suspended.
    update app_user set status = 'ACTIVE', "updatedAt" = now()
     where id = v_row."userId" and status = 'INACTIVE' and "deletedAt" is null;
    -- The login follows the contract now running: a conversion can change the
    -- title, department and manager, and the pay sets the hourly cost.
    update app_user u
       set "jobTitle" = c."jobTitle",
           "departmentId" = coalesce(c."departmentId", u."departmentId"),
           "managerUserId" = case when c."reportsToUserId" is not null and c."reportsToUserId" <> u.id
                                  then c."reportsToUserId" else u."managerUserId" end,
           "costRate" = coalesce(people_hourly_cost(c.id), u."costRate"),
           "updatedAt" = now()
      from employment_contract c
     where c.id = v_row.id and u.id = v_row."userId";
    v_count := v_count + 1;
  end loop;

  -- 2. A term that ran out without a successor starting has ended.
  update employment_contract set status = 'ENDED', "closedAt" = now(), "updatedAt" = now()
   where status = 'ACTIVE' and "endDate" < v_today;

  -- 3. Reminders before the end, at 30, 14 and 7 days, to whoever manages
  --    contracts and to the person they report to. None once a renewal or
  --    conversion is under way.
  for v_row in
    select c.id, c."contractNumber", c."endDate", c."reportsToUserId", s."fullName", c."staffId"
      from employment_contract c join staff_profile s on s.id = c."staffId"
     where c.status = 'ACTIVE' and c."endDate" between v_today and v_today + 30
       and not exists (select 1 from employment_contract n
                        where n."previousContractId" = c.id and n.status not in ('CANCELLED'))
  loop
    v_days := v_row."endDate" - v_today;
    v_bucket := case when v_days <= 7 then 7 when v_days <= 14 then 14 else 30 end;
    perform notify_user(u, 'CONTRACT_ENDING',
      v_row."fullName" || '''s contract ends ' || case when v_days = 0 then 'today' when v_days = 1 then 'tomorrow' else 'in ' || v_days || ' days' end,
      v_row."contractNumber" || ' ends on ' || to_char(v_row."endDate", 'DD Mon YYYY') || '. Renew, convert or let it end.',
      '/people/' || v_row."staffId", 'StaffProfile', v_row."staffId",
      'contract-ending:' || v_row.id || ':' || v_bucket)
      from (select app_users_holding('people:write') as u
            union select v_row."reportsToUserId" where v_row."reportsToUserId" is not null) people;
  end loop;

  -- 4. Someone with no current term left has left: their profile says so and
  --    their login is switched off. Never an administrator's - they are told
  --    instead, so nobody can be locked out of the system by a date.
  for v_row in
    select s.id, s."userId", s."fullName"
      from staff_profile s
     where s.status <> 'LEFT'
       and exists (select 1 from employment_contract c where c."staffId" = s.id
                    and c.status in ('ENDED', 'TERMINATED', 'RESIGNED', 'RENEWED', 'CONVERTED'))
       and not exists (select 1 from employment_contract c where c."staffId" = s.id
                    and (c.status in ('ACTIVE', 'SIGNED', 'EMPLOYEE_SIGNED', 'SENT')
                         or (c.status in ('TERMINATED', 'RESIGNED') and c."lastWorkingDay" >= v_today)))
  loop
    update staff_profile set status = 'LEFT', "updatedAt" = now() where id = v_row.id;
    if v_row."userId" is not null then
      if exists (select 1 from app_user u join security_role r on r.id = u."roleId"
                  where u.id = v_row."userId" and ('*' = any(r.permissions) or 'admin:*' = any(r.permissions))) then
        perform notify_user(u, 'CONTRACT_ENDED', v_row."fullName" || ' has no current contract',
          'Their login was left on because they are an administrator. Switch it off under Users if they have left.',
          '/people/' || v_row.id, 'StaffProfile', v_row.id, 'left:' || v_row.id || ':' || v_today)
          from app_users_holding('people:write') u;
      else
        update app_user set status = 'INACTIVE', "updatedAt" = now()
         where id = v_row."userId" and status = 'ACTIVE';
        perform notify_user(u, 'CONTRACT_ENDED', v_row."fullName" || '''s login was switched off',
          'Their last contract is over. Renewing it switches the login back on.',
          '/people/' || v_row.id, 'StaffProfile', v_row.id, 'left:' || v_row.id || ':' || v_today)
          from app_users_holding('people:write') u;
      end if;
    end if;
  end loop;

  return v_count;
end $$;

revoke all on function people_contract_tick() from public, anon, authenticated;
grant execute on function people_contract_tick() to service_role;
