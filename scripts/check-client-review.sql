-- All identities and records below are synthetic and rolled back by the runner.
create temp table crl_fixture(k text primary key, id uuid);
grant select on crl_fixture to authenticated;
insert into crl_fixture
select k, gen_random_uuid() from unnest(array[
  'manager_role','writer_role','manager','writer','reviewer',
  'project','task','version','v2','link','link2'
]) k;

insert into security_role(id, name, permissions, "dataScope", "updatedAt") values
((select id from crl_fixture where k='manager_role'), 'CRL test manager', array['project:*'], 'ALL', now()),
((select id from crl_fixture where k='writer_role'), 'CRL test writer', array['project:read','project:write'], 'ALL', now());

insert into app_user(id, "fullName", email, "roleId", status, "updatedAt")
select f.id, 'CRL test '||f.k, f.id::text||'@example.invalid',
  (select id from crl_fixture where k = case when f.k='writer' then 'writer_role' else 'manager_role' end),
  'ACTIVE', now()
from crl_fixture f where f.k in ('manager','writer','reviewer');

insert into project(id, "projectNumber", name, "projectManagerId", "projectType", "billingType", status, "updatedAt")
select id, 'CRL-'||left(id::text,18), 'CRL test project', (select id from crl_fixture where k='manager'),
  'INTERNAL', 'FIXED', 'PLANNING', now()
from crl_fixture where k='project';

insert into project_member("projectId", "userId", active, "projectRole", "updatedAt")
select (select id from crl_fixture where k='project'), id, true, 'Writer', now()
from crl_fixture where k in ('writer','reviewer');

insert into project_task(id, "projectId", name, "assignedUserId", billable, "updatedAt")
select id, (select id from crl_fixture where k='project'), 'CRL caption',
  (select id from crl_fixture where k='writer'), false, now()
from crl_fixture where k='task';

insert into project_content_plan("taskId", channel, format, objective, audience, brief,
  "plannedPublishAt", "clientApprovalRequired", "updatedById", "updatedAt")
select (select id from crl_fixture where k='task'), 'INSTAGRAM', 'POST', 'CRL objective', 'CRL audience',
  'CRL brief', now() + interval '10 days', true, (select id from crl_fixture where k='manager'), now();

insert into content_version(id, "taskId", "versionNumber", "planRevision", "planSnapshot", copy, "createdById")
select id, (select id from crl_fixture where k='task'), 1, 1,
  jsonb_build_object('clientApprovalRequired', true, 'channel', 'INSTAGRAM', 'format', 'POST', 'brief', 'CRL brief'),
  'CRL version one copy', (select id from crl_fixture where k='writer')
from crl_fixture where k='version';

-- --------------------------------- a link cannot be sent before internal approval
select set_config('request.jwt.claim.sub', (select id::text from crl_fixture where k='manager'), true);
set local role authenticated;
do $$
declare denied boolean;
  ver uuid := (select id from crl_fixture where k='version');
  lnk uuid := (select id from crl_fixture where k='link');
  h text := repeat('a', 64);
begin
  denied := false;
  begin perform issue_client_review_link(lnk, ver, h, 'Client Person', 'client@example.invalid', now() + interval '14 days');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'A link was sent before the team approved the work'; end if;
end $$;
reset role;

-- The reviewer approves internally (not the author, as the existing rule requires).
select set_config('request.jwt.claim.sub', (select id::text from crl_fixture where k='reviewer'), true);
set local role authenticated;
select review_content_version(gen_random_uuid(), (select id from crl_fixture where k='version'),
  'INTERNAL', 'APPROVED', 'CRL internal approval');
reset role;

-- ------------------------------------------------ issuing, retrying, and validation
select set_config('request.jwt.claim.sub', (select id::text from crl_fixture where k='manager'), true);
set local role authenticated;
do $$
declare denied boolean;
  ver uuid := (select id from crl_fixture where k='version');
  lnk uuid := (select id from crl_fixture where k='link');
  h text := repeat('a', 64);
begin
  -- A token that is not a 64-character hash is refused.
  denied := false;
  begin perform issue_client_review_link(gen_random_uuid(), ver, 'short', 'Client', 'c@example.invalid', now() + interval '1 day');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'A malformed token hash was accepted'; end if;

  -- An expiry in the past, or absurdly far away, is refused.
  denied := false;
  begin perform issue_client_review_link(gen_random_uuid(), ver, repeat('b',64), 'Client', 'c@example.invalid', now() - interval '1 day');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'An already-expired link was issued'; end if;

  denied := false;
  begin perform issue_client_review_link(gen_random_uuid(), ver, repeat('c',64), 'Client', 'c@example.invalid', now() + interval '400 days');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'A link with no meaningful expiry was issued'; end if;

  perform issue_client_review_link(lnk, ver, h, '  Client Person  ', '  Client@Example.Invalid  ', now() + interval '14 days');
  if not exists (select 1 from client_review_link where id = lnk and "recipientEmail" = 'client@example.invalid') then
    raise exception 'The recipient email was not normalised';
  end if;
  -- The token itself must never be stored.
  if exists (select 1 from client_review_link where id = lnk and "tokenHash" <> h) then
    raise exception 'The stored hash does not match what was supplied';
  end if;

  -- Retrying the same request returns the same link rather than minting another.
  perform issue_client_review_link(lnk, ver, h, 'Client Person', 'client@example.invalid', now() + interval '14 days');
  if (select count(*) from client_review_link where "versionId" = ver) <> 1 then
    raise exception 'A retry minted a second link';
  end if;

  -- Writing to the table directly is not possible even for staff.
  denied := false;
  begin insert into client_review_link(id, "versionId", "tokenHash", "recipientName", "recipientEmail", "createdById", "expiresAt")
    values (gen_random_uuid(), ver, repeat('d',64), 'Direct', 'd@example.invalid', app_current_user_id(), now() + interval '1 day');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'A link was inserted directly, bypassing the checks'; end if;
end $$;
reset role;

-- ------------------------------------------- the link works without being signed in
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
declare ctx jsonb; h text := repeat('a', 64);
begin
  -- An unknown token yields nothing, and says nothing about why.
  if client_review_context(repeat('f', 64)) is not null then
    raise exception 'An unknown token returned a context';
  end if;
  if client_review_context('not-a-hash') is not null then
    raise exception 'A malformed token returned a context';
  end if;

  ctx := client_review_context(h);
  if ctx is null then raise exception 'A valid token returned nothing'; end if;
  if ctx->>'copy' <> 'CRL version one copy' then raise exception 'The client cannot see the copy they are reviewing'; end if;
  if ctx->>'brief' <> 'CRL brief' then raise exception 'The brief is missing from the client context'; end if;
  if (ctx->>'expired')::boolean then raise exception 'A fresh link reads as expired'; end if;

  -- Nothing internal may leak through the context.
  if ctx::text ilike '%CRL internal approval%' then raise exception 'Internal review notes leaked to the client'; end if;
  if ctx::text ilike '%CRL test manager%' or ctx::text ilike '%CRL test writer%' then
    raise exception 'Internal staff names leaked to the client';
  end if;
  if ctx ? 'projectId' or ctx ? 'taskId' or ctx ? 'versionId' then
    raise exception 'Internal identifiers leaked to the client';
  end if;
end $$;
reset role;

-- An anonymous caller must get no rows from the tables themselves, whether the
-- table refuses outright or RLS simply returns nothing. Both are acceptable;
-- reading a row is not.
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
declare n int;
begin
  begin
    select count(*) into n from client_review_link;
    if n > 0 then raise exception 'Anonymous callers can read review links'; end if;
  exception when insufficient_privilege then null; end;

  begin
    select count(*) into n from content_version;
    if n > 0 then raise exception 'Anonymous callers can read content versions'; end if;
  exception when insufficient_privilege then null; end;

  begin
    select count(*) into n from content_review;
    if n > 0 then raise exception 'Anonymous callers can read internal review notes'; end if;
  exception when insufficient_privilege then null; end;

  begin
    select count(*) into n from project;
    if n > 0 then raise exception 'Anonymous callers can read projects'; end if;
  exception when insufficient_privilege then null; end;

  begin
    select count(*) into n from app_user;
    if n > 0 then raise exception 'Anonymous callers can read staff'; end if;
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ------------------------------------------------------ the client's own decision
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
declare denied boolean; result jsonb; h text := repeat('a', 64);
begin
  -- Validation applies to an anonymous caller too.
  denied := false;
  begin perform submit_client_review(h, 'MAYBE', 'Client Person', 'Looks fine');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'An invented decision was accepted'; end if;

  denied := false;
  begin perform submit_client_review(h, 'APPROVED', '   ', 'Looks fine');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'A decision with no approver name was accepted'; end if;

  denied := false;
  begin perform submit_client_review(h, 'APPROVED', 'Client Person', '   ');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'A decision with no comment was accepted'; end if;

  -- A token nobody issued cannot approve anything.
  denied := false;
  begin perform submit_client_review(repeat('9', 64), 'APPROVED', 'Attacker', 'Approving someone else work');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'An unknown token recorded an approval'; end if;

  result := submit_client_review(h, 'APPROVED', '  Client Person  ', '  Happy with this.  ');
  if result->>'decision' <> 'APPROVED' then raise exception 'The decision was not returned'; end if;

  -- The same link cannot be used twice.
  denied := false;
  begin perform submit_client_review(h, 'CHANGES_REQUESTED', 'Client Person', 'Changed my mind');
  exception when unique_violation then denied := true; end;
  if not denied then raise exception 'A used link recorded a second decision'; end if;
end $$;
reset role;

-- The decision must have landed in content_review exactly where staff-recorded
-- ones do, and be marked as having come from the client directly.
select set_config('request.jwt.claim.sub', (select id::text from crl_fixture where k='manager'), true);
set local role authenticated;
do $$
declare r content_review%rowtype; ver uuid := (select id from crl_fixture where k='version');
begin
  select * into r from content_review where "versionId" = ver and stage = 'CLIENT';
  if not found then raise exception 'The client decision did not reach content_review'; end if;
  if r.decision <> 'APPROVED' then raise exception 'The wrong decision was recorded'; end if;
  if r."clientApprover" <> 'Client Person' then raise exception 'The approver name was not trimmed or stored'; end if;
  if r.evidence <> 'Happy with this.' then raise exception 'The client comment was not stored'; end if;
  if r."viaLinkId" is null then raise exception 'A client-made decision is indistinguishable from a transcribed one'; end if;
  if r."reviewedById" <> (select id from crl_fixture where k='manager') then
    raise exception 'The sending staff member was not recorded';
  end if;
end $$;
reset role;

-- --------------------------------------------- reopening a used link shows the decision
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
declare ctx jsonb;
begin
  ctx := client_review_context(repeat('a', 64));
  if ctx->'decision' is null or ctx->'decision' = 'null'::jsonb then
    raise exception 'A used link does not show what was decided';
  end if;
  if ctx->'decision'->>'approver' <> 'Client Person' then raise exception 'The recorded approver is not shown back'; end if;
  if ctx->>'usedAt' is null then raise exception 'The link does not record when it was used'; end if;
end $$;
reset role;

-- ------------------------------------- a used link cannot be withdrawn afterwards
select set_config('request.jwt.claim.sub', (select id::text from crl_fixture where k='manager'), true);
set local role authenticated;
do $$
declare denied boolean; lnk uuid := (select id from crl_fixture where k='link');
begin
  denied := false;
  begin perform revoke_client_review_link(lnk);
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'A used link was withdrawn, hiding a real decision'; end if;
end $$;
reset role;

-- ------------------------- a second version needs its own approval, and its own link
select set_config('request.jwt.claim.sub', (select id::text from crl_fixture where k='writer'), true);
set local role authenticated;
select add_content_version((select id from crl_fixture where k='v2'),
  (select id from crl_fixture where k='task'), 1, 1, 'CRL version two copy');
reset role;

select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
declare denied boolean; ctx jsonb;
begin
  -- The old link now points at stale work; it must not approve the new version
  -- or re-approve the old one.
  ctx := client_review_context(repeat('a', 64));
  if ctx->>'copy' = 'CRL version two copy' then
    raise exception 'An old link silently started showing a newer version';
  end if;
end $$;
reset role;

-- A link for the superseded version cannot be issued now either.
select set_config('request.jwt.claim.sub', (select id::text from crl_fixture where k='manager'), true);
set local role authenticated;
do $$
declare denied boolean; ver uuid := (select id from crl_fixture where k='version');
begin
  denied := false;
  begin perform issue_client_review_link(gen_random_uuid(), ver, repeat('e',64), 'Client', 'c@example.invalid', now() + interval '7 days');
  exception when serialization_failure or unique_violation then denied := true; end;
  if not denied then raise exception 'A link was issued for a superseded version'; end if;
end $$;
reset role;

-- --------------------------------- an expired or withdrawn link decides nothing
select set_config('request.jwt.claim.sub', (select id::text from crl_fixture where k='reviewer'), true);
set local role authenticated;
select review_content_version(gen_random_uuid(), (select id from crl_fixture where k='v2'),
  'INTERNAL', 'APPROVED', 'CRL internal approval of version two');
reset role;

select set_config('request.jwt.claim.sub', (select id::text from crl_fixture where k='manager'), true);
set local role authenticated;
select issue_client_review_link((select id from crl_fixture where k='link2'),
  (select id from crl_fixture where k='v2'), repeat('1', 64),
  'Second Client', 'second@example.invalid', now() + interval '7 days');
select revoke_client_review_link((select id from crl_fixture where k='link2'));
reset role;

select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
declare denied boolean; ctx jsonb;
begin
  ctx := client_review_context(repeat('1', 64));
  if not (ctx->>'revoked')::boolean then raise exception 'A withdrawn link does not read as withdrawn'; end if;

  denied := false;
  begin perform submit_client_review(repeat('1', 64), 'APPROVED', 'Second Client', 'Approving anyway');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'A withdrawn link recorded a decision'; end if;
end $$;
reset role;

select 'client review links verified' as result;
