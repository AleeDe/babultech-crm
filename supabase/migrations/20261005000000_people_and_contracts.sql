-- People: hiring profiles, employment contracts and their life cycle.
--
-- A staff profile is the person (personal, academic and professional details).
-- An employment contract is one term of work: internship, training, a fixed
-- employment or a permanent one, always with an end date - a permanent
-- contract runs a year and is renewed at each appraisal. A renewal or a
-- conversion is a new contract pointing at the one it follows.
--
--   DRAFT -> SENT -> EMPLOYEE_SIGNED -> SIGNED -> ACTIVE -> ENDED
--                                                       -> RENEWED / CONVERTED (a successor started)
--                                                       -> TERMINATED / RESIGNED (with a last working day)
--   anything before ACTIVE                              -> CANCELLED
--
-- Pay is confidential. Both tables are read and written only through the
-- service role, after the app has checked people:read / people:write or that
-- the reader is the person the contract is for. The browser never reads them.
--
-- Also here: team types become an editable list, the starting job roles, and
-- the daily job that starts, ends and reminds about contracts.

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table if not exists staff_profile (
  id uuid primary key default gen_random_uuid(),
  "profileNumber" varchar(30) not null unique,
  -- The person's CRM login, once they have one. One profile per login.
  "userId" uuid unique references app_user (id) on delete set null,
  "fullName" varchar(150) not null,
  "fatherName" varchar(150),
  "nationalId" varchar(30),
  "dateOfBirth" date,
  gender varchar(20),
  "maritalStatus" varchar(20),
  "personalEmail" varchar(255),
  phone varchar(50),
  address text,
  city varchar(100),
  country varchar(100),
  "emergencyContactName" varchar(150),
  "emergencyContactRelation" varchar(60),
  "emergencyContactPhone" varchar(50),
  "linkedinUrl" varchar(500) check ("linkedinUrl" is null or "linkedinUrl" ~ '^https?://'),
  "githubUrl" varchar(500) check ("githubUrl" is null or "githubUrl" ~ '^https?://'),
  "portfolioUrl" varchar(500) check ("portfolioUrl" is null or "portfolioUrl" ~ '^https?://'),
  skills text[] not null default '{}',
  -- [{degree, field, institution, startYear, endYear, grade}]
  education jsonb not null default '[]'::jsonb check (jsonb_typeof(education) = 'array'),
  -- [{company, title, startDate, endDate, summary}]
  experience jsonb not null default '[]'::jsonb check (jsonb_typeof(experience) = 'array'),
  notes text,
  -- ONBOARDING until a contract starts, LEFT once the last one is over.
  status varchar(12) not null default 'ONBOARDING' check (status in ('ONBOARDING', 'ACTIVE', 'LEFT')),
  "createdById" uuid references app_user (id) on delete set null,
  "createdAt" timestamp(3) not null default now(),
  "updatedAt" timestamp(3) not null default now()
);

-- ---------------------------------------------------------------------------
-- Contract templates
-- ---------------------------------------------------------------------------

create table if not exists contract_template (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null,
  "contractType" varchar(12) not null check ("contractType" in ('INTERNSHIP', 'TRAINING', 'EMPLOYMENT', 'PERMANENT')),
  body text not null,
  active boolean not null default true,
  "createdAt" timestamp(3) not null default now(),
  "updatedAt" timestamp(3) not null default now()
);

-- ---------------------------------------------------------------------------
-- Contracts
-- ---------------------------------------------------------------------------

create table if not exists employment_contract (
  id uuid primary key default gen_random_uuid(),
  "contractNumber" varchar(30) not null unique,
  "staffId" uuid not null references staff_profile (id) on delete cascade,
  -- The contract this one renews or converts.
  "previousContractId" uuid references employment_contract (id) on delete set null,
  "contractType" varchar(12) not null check ("contractType" in ('INTERNSHIP', 'TRAINING', 'EMPLOYMENT', 'PERMANENT')),
  "tenureMonths" integer not null check ("tenureMonths" between 1 and 36),
  "startDate" date not null,
  "endDate" date not null,
  "jobTitle" varchar(150) not null,
  "departmentId" uuid references department (id) on delete set null,
  "reportsToUserId" uuid references app_user (id) on delete set null,
  -- What their login gets when it is created from this contract.
  "roleId" uuid references security_role (id) on delete set null,
  "teamIds" uuid[] not null default '{}',
  "hoursPerWeek" numeric(5, 2) check ("hoursPerWeek" is null or "hoursPerWeek" between 1 and 80),
  -- Money
  "payBasis" varchar(8) not null default 'NONE' check ("payBasis" in ('NONE', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'FIXED')),
  "payAmount" numeric(18, 2) check ("payAmount" is null or "payAmount" >= 0),
  "currencyCode" char(3),
  -- Everything else they get: training, software, lunch, classes.
  benefits text[] not null default '{}',
  "otherTerms" text,
  "noticeDays" integer not null default 14 check ("noticeDays" between 0 and 180),
  "templateId" uuid references contract_template (id) on delete set null,
  -- The contract text. Editable while a draft; frozen once sent.
  body text not null default '',
  -- SHA-256 of the body when it went out, so a signature is tied to the words.
  "bodyHash" varchar(64),
  status varchar(16) not null default 'DRAFT' check (status in (
    'DRAFT', 'SENT', 'EMPLOYEE_SIGNED', 'SIGNED', 'ACTIVE',
    'ENDED', 'RENEWED', 'CONVERTED', 'TERMINATED', 'RESIGNED', 'CANCELLED')),
  "signMethod" varchar(8) check ("signMethod" in ('MANUAL', 'DIGITAL')),
  "signTokenHash" varchar(64) unique,
  "signTokenExpiresAt" timestamp(3),
  "sentAt" timestamp(3),
  "employeeSignedName" varchar(150),
  "employeeSignature" text check ("employeeSignature" is null or length("employeeSignature") <= 300000),
  "employeeSignedAt" timestamp(3),
  "employeeSignedIp" varchar(64),
  "employeeSignedAgent" varchar(300),
  "companySignedById" uuid references app_user (id) on delete set null,
  "companySignedName" varchar(150),
  "companySignature" text check ("companySignature" is null or length("companySignature") <= 300000),
  "companySignedAt" timestamp(3),
  "signedOn" date,
  -- Ending early: the last working day, why, and when notice was given.
  "lastWorkingDay" date,
  "noticeGivenOn" date,
  "endReason" text,
  "closedById" uuid references app_user (id) on delete set null,
  "closedAt" timestamp(3),
  "createdById" uuid references app_user (id) on delete set null,
  "createdAt" timestamp(3) not null default now(),
  "updatedAt" timestamp(3) not null default now(),
  check ("endDate" >= "startDate"),
  check ("payBasis" = 'NONE' or ("payAmount" is not null and "currencyCode" is not null)),
  check (status not in ('TERMINATED', 'RESIGNED') or "lastWorkingDay" is not null)
);

create index if not exists employment_contract_staff_idx on employment_contract ("staffId", "startDate" desc);
create index if not exists employment_contract_status_idx on employment_contract (status, "endDate");
create index if not exists employment_contract_previous_idx on employment_contract ("previousContractId");

alter table staff_profile enable row level security;
alter table contract_template enable row level security;
alter table employment_contract enable row level security;
-- No policies: the service role only, after the app's own checks.

insert into number_sequence (id, "entityType", prefix, "nextValue", "paddingLength", "includeYear", "updatedAt")
select gen_random_uuid(), 'StaffProfile', 'STF', 1, 4, false, now()
where not exists (select 1 from number_sequence where "entityType" = 'StaffProfile');
insert into number_sequence (id, "entityType", prefix, "nextValue", "paddingLength", "includeYear", "updatedAt")
select gen_random_uuid(), 'EmploymentContract', 'EC', 1, 4, true, now()
where not exists (select 1 from number_sequence where "entityType" = 'EmploymentContract');

-- ---------------------------------------------------------------------------
-- Files on a profile or contract (CVs, ID cards, signed scans)
-- ---------------------------------------------------------------------------

-- Documents are otherwise readable by every internal user. These two kinds
-- hold identity documents and pay, so they are limited to people:read holders
-- and the person themselves. Restrictive: it narrows the existing policies.
create or replace function app_people_document_access(p_type text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_type not in ('StaffProfile', 'EmploymentContract') then true
    when app_has_permission('people:read') then true
    when p_type = 'StaffProfile' then exists (
      select 1 from staff_profile s where s.id = p_id and s."userId" = app_current_user_id())
    else exists (
      select 1 from employment_contract c join staff_profile s on s.id = c."staffId"
       where c.id = p_id and s."userId" = app_current_user_id())
  end;
$$;
revoke all on function app_people_document_access(text, uuid) from public, anon;
grant execute on function app_people_document_access(text, uuid) to authenticated;

drop policy if exists people_document_boundary on document;
create policy people_document_boundary on document as restrictive for all to authenticated
  using (app_people_document_access("relatedEntityType"::text, "relatedEntityId"))
  with check (app_people_document_access("relatedEntityType"::text, "relatedEntityId"));

-- ---------------------------------------------------------------------------
-- The daily job: start, end and remind
-- ---------------------------------------------------------------------------

-- Runs every morning, and straight after any change from the app, so a
-- contract signed for today starts today. Dates are Karachi dates.
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

-- 00:05 Karachi, so a contract starting today has started before anyone signs in.
select cron.schedule('babultech-people-contracts', '5 19 * * *', 'select public.people_contract_tick()');

-- ---------------------------------------------------------------------------
-- Lists
-- ---------------------------------------------------------------------------

-- Team types: any kind of work, not just the five the system started with.
alter type "TeamType" add value if not exists 'DEVELOPMENT';
alter type "TeamType" add value if not exists 'QA';
alter type "TeamType" add value if not exists 'CONTENT';
alter type "TeamType" add value if not exists 'TRAINING';

insert into picklist (key, label, "groupName", "enumType", locked, description, "sortOrder")
values ('team_type', 'Team type', 'People', 'TeamType', false,
        'The kinds of team people work in. A person can be in several teams.', 900)
on conflict (key) do nothing;

insert into picklist_value ("picklistKey", value, label, "sortOrder")
values ('team_type', 'SALES', 'Sales', 10), ('team_type', 'MARKETING', 'Marketing', 20),
       ('team_type', 'PROJECT', 'Project delivery', 30), ('team_type', 'DEVELOPMENT', 'Development', 40),
       ('team_type', 'QA', 'QA', 50), ('team_type', 'CONTENT', 'Content', 60),
       ('team_type', 'SUPPORT', 'Support', 70), ('team_type', 'TRAINING', 'Training', 80),
       ('team_type', 'FINANCE', 'Finance', 90)
on conflict ("picklistKey", value) do nothing;

-- What a hire gets besides money.
insert into picklist (key, label, "groupName", "enumType", locked, description, "sortOrder")
values ('hire_benefit', 'Hiring benefits', 'People', null, false,
        'What a contract can offer besides pay: training, software, lunch, classes.', 910)
on conflict (key) do nothing;

insert into picklist_value ("picklistKey", value, label, "sortOrder")
values ('hire_benefit', 'Training', 'Training', 10),
       ('hire_benefit', 'Access to paid software', 'Access to paid software', 20),
       ('hire_benefit', 'Weekly lunch', 'Weekly lunch', 30),
       ('hire_benefit', 'Hands-on experience on live projects', 'Hands-on experience on live projects', 40),
       ('hire_benefit', 'Communication classes', 'Communication classes', 50),
       ('hire_benefit', 'Experience certificate', 'Experience certificate', 60)
on conflict ("picklistKey", value) do nothing;

-- ---------------------------------------------------------------------------
-- Starting job roles. Consultant stays the delivery role (development, QA,
-- content, tickets). Leads see their reporting line, so set Reports to.
-- ---------------------------------------------------------------------------

insert into security_role (id, name, description, permissions, "dataScope", "isSystem", active, "updatedAt")
select gen_random_uuid(), v.name, v.description, v.permissions, v.scope, false, true, now()
from (values
  ('Marketing', 'Campaigns, campaign members and leads they own, and their time and expense claims.',
   array['lead:read', 'lead:write', 'project:read', 'project:write', 'expense:read', 'expense:write'], 'OWN'),
  ('Marketing Lead', 'Runs marketing for the people who report to them: campaigns, leads, content review and their time.',
   array['lead:read', 'lead:write', 'lead:delete', 'campaign:delete', 'account:read', 'project:read', 'project:write',
         'content:review', 'time:approve', 'expense:read', 'expense:write'], 'DEPARTMENT'),
  ('Sales', 'Leads, customers and deals they own, and their time and expense claims.',
   array['lead:read', 'lead:write', 'account:read', 'account:write', 'opportunity:read', 'opportunity:write',
         'partner:read', 'project:read', 'project:write', 'expense:read', 'expense:write'], 'OWN'),
  ('Sales Lead', 'Runs sales for the people who report to them, approves their quotations and time.',
   array['lead:read', 'lead:write', 'lead:delete', 'account:read', 'account:write', 'opportunity:read', 'opportunity:write',
         'quotation:approve', 'contract:write', 'partner:read', 'commission:read', 'project:read', 'project:write',
         'time:approve', 'expense:read', 'expense:write'], 'DEPARTMENT'),
  ('Delivery Lead', 'Runs projects and support for the people who report to them, reviews content and approves their time.',
   array['project:read', 'project:write', 'project:manage', 'case:read', 'case:write', 'content:review',
         'time:approve', 'expense:read', 'expense:write'], 'DEPARTMENT')
) as v(name, description, permissions, scope)
where not exists (select 1 from security_role r where lower(r.name) = lower(v.name));

-- ---------------------------------------------------------------------------
-- Starting templates, one per kind. Plain text with {{placeholders}}; edit
-- them under People > Contract templates, and have them checked by a lawyer.
-- ---------------------------------------------------------------------------

insert into contract_template (name, "contractType", body)
select v.name, v.kind, v.body
from (values
('Internship agreement', 'INTERNSHIP', $t$INTERNSHIP AGREEMENT
{{contractNumber}}

This agreement is made on {{today}} between {{companyName}} ("the Company") and {{fullName}}, son/daughter of {{fatherName}}, CNIC {{nationalId}}, residing at {{address}} ("the Intern").

1. Position
The Intern joins the Company as {{jobTitle}} in {{department}}, reporting to {{reportsTo}}.

2. Term
The internship runs for {{tenure}}, from {{startDate}} to {{endDate}}. It ends on that date unless both parties sign a renewal or a new contract before then.

3. Hours
The Intern is expected to work {{hoursPerWeek}} hours a week, as agreed with their supervisor, and to record their time on the projects and campaigns they work on in the Company's CRM.

4. Compensation
Pay: {{pay}}
The Intern also receives:
{{benefits}}

5. Learning
The internship is a learning engagement. The Company will provide guidance, feedback and the tools the Intern needs for their work.

6. Confidentiality
The Intern will keep confidential all information about the Company, its customers and its projects, during and after the internship, and will return all Company property and access when it ends.

7. Work produced
Everything the Intern produces for the Company during the internship belongs to the Company.

8. Ending early
Either party may end this agreement early with {{noticeDays}} days' written notice. The Company may end it immediately for serious misconduct.

9. Other terms
{{otherTerms}}

Signed for {{companyName}}                    Signed by the Intern
$t$),
('Training agreement', 'TRAINING', $t$TRAINING AGREEMENT
{{contractNumber}}

This agreement is made on {{today}} between {{companyName}} ("the Company") and {{fullName}}, son/daughter of {{fatherName}}, CNIC {{nationalId}}, residing at {{address}} ("the Trainee").

1. Programme
The Trainee joins the Company's training programme as {{jobTitle}} in {{department}}, under the supervision of {{reportsTo}}.

2. Term
The training runs for {{tenure}}, from {{startDate}} to {{endDate}}. It ends on that date unless both parties sign a renewal or a new contract before then.

3. Attendance
The Trainee will attend {{hoursPerWeek}} hours a week of training and supervised work, and will record their time in the Company's CRM.

4. Compensation
Pay: {{pay}}
The Trainee also receives:
{{benefits}}

5. Confidentiality
The Trainee will keep confidential all information about the Company, its customers and its projects, during and after the training, and will return all Company property and access when it ends.

6. Work produced
Everything the Trainee produces for the Company during the training belongs to the Company.

7. Ending early
Either party may end this agreement early with {{noticeDays}} days' written notice. The Company may end it immediately for serious misconduct.

8. Other terms
{{otherTerms}}

Signed for {{companyName}}                    Signed by the Trainee
$t$),
('Fixed-term employment contract', 'EMPLOYMENT', $t$EMPLOYMENT CONTRACT (FIXED TERM)
{{contractNumber}}

This contract is made on {{today}} between {{companyName}} ("the Company") and {{fullName}}, son/daughter of {{fatherName}}, CNIC {{nationalId}}, residing at {{address}} ("the Employee").

1. Position
The Employee is employed as {{jobTitle}} in {{department}}, reporting to {{reportsTo}}.

2. Term
This contract runs for {{tenure}}, from {{startDate}} to {{endDate}}. It may be renewed, or converted to a permanent contract, by a new contract signed before it ends.

3. Hours
The Employee will work {{hoursPerWeek}} hours a week and record their time on projects and campaigns in the Company's CRM.

4. Compensation
Pay: {{pay}}
The Employee also receives:
{{benefits}}

5. Duties
The Employee will carry out the duties of the position, and other reasonable tasks the Company asks of them, carefully and in good faith.

6. Confidentiality
The Employee will keep confidential all information about the Company, its customers and its projects, during and after employment, and will return all Company property and access when it ends.

7. Work produced
Everything the Employee produces for the Company during their employment belongs to the Company.

8. Ending the contract
Either party may end this contract with {{noticeDays}} days' written notice. A resignation is given in writing to the Company. The Company may end it immediately for serious misconduct.

9. Other terms
{{otherTerms}}

Signed for {{companyName}}                    Signed by the Employee
$t$),
('Permanent employment contract', 'PERMANENT', $t$EMPLOYMENT CONTRACT (PERMANENT)
{{contractNumber}}

This contract is made on {{today}} between {{companyName}} ("the Company") and {{fullName}}, son/daughter of {{fatherName}}, CNIC {{nationalId}}, residing at {{address}} ("the Employee").

1. Position
The Employee is employed permanently as {{jobTitle}} in {{department}}, reporting to {{reportsTo}}.

2. Annual term and appraisal
Employment is permanent. These terms apply for one year, from {{startDate}} to {{endDate}}, and are reviewed at the annual appraisal, when the Company and the Employee agree the next year's terms in a renewed contract.

3. Hours
The Employee will work {{hoursPerWeek}} hours a week and record their time on projects and campaigns in the Company's CRM.

4. Compensation
Pay: {{pay}}
The Employee also receives:
{{benefits}}

5. Duties
The Employee will carry out the duties of the position, and other reasonable tasks the Company asks of them, carefully and in good faith.

6. Confidentiality
The Employee will keep confidential all information about the Company, its customers and its projects, during and after employment, and will return all Company property and access when it ends.

7. Work produced
Everything the Employee produces for the Company during their employment belongs to the Company.

8. Ending employment
Either party may end employment with {{noticeDays}} days' written notice. A resignation is given in writing to the Company. The Company may end it immediately for serious misconduct.

9. Other terms
{{otherTerms}}

Signed for {{companyName}}                    Signed by the Employee
$t$)
) as v(name, kind, body)
where not exists (select 1 from contract_template);
