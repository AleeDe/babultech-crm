-- Let the client record their own approval, instead of staff typing in what
-- the client said.
--
-- Today a client approval is an internal staff member writing "client approved
-- by email, see thread" into content_review. That is a record of what somebody
-- remembers being told. This gives the client a way to say it themselves.
--
-- WHY A LINK AND NOT AN ACCOUNT
--
-- Every new CRM identity is a new way into the CRM. app_is_internal() is
-- defined as "signed in, no partnerId, has a scope", so a client user created
-- without a partnerId would read as INTERNAL STAFF and see the whole system.
-- Rather than thread a second external identity type through every policy that
-- already exists, a review link carries no identity at all: it is an
-- unguessable token that grants one specific content version, for a while.
--
-- The blast radius of a leaked link is therefore one deliverable, not an
-- account, and it expires on its own.
--
-- WHAT IS STORED
--
-- Only a SHA-256 of the token. The token itself is generated in the
-- application, shown once to the staff member who will send it, and never
-- written here. A dump of this table does not yield working links. Lookup is
-- by hash, so a stolen database cannot be replayed as a URL.
--
-- The client's decision is written into the existing content_review table with
-- stage='CLIENT', so it lands in the same place staff-recorded approvals
-- already do and every existing publication gate keeps working unchanged.
-- "viaLinkId" distinguishes the two: an approval the client made themselves is
-- evidentially different from one a staff member transcribed, and the
-- difference should be visible rather than blurred.

alter table content_review add column if not exists "viaLinkId" uuid;

create table if not exists client_review_link (
  id uuid primary key,
  "versionId" uuid not null references content_version(id),
  -- SHA-256 of the token, hex. The token is never stored.
  "tokenHash" text not null unique,
  -- Who the link was issued to, for the audit trail. Not an authentication
  -- factor: anyone holding the link can use it, which is why it expires.
  "recipientName" text not null,
  "recipientEmail" text not null,
  "createdById" uuid not null references app_user(id),
  "createdAt" timestamptz not null default clock_timestamp(),
  "expiresAt" timestamptz not null,
  -- Set when the client submits their decision. A link is single-use for
  -- deciding; it can still be opened afterwards to see what was decided.
  "usedAt" timestamptz,
  -- Set when staff withdraw the link before it was used.
  "revokedAt" timestamptz,
  "revokedById" uuid references app_user(id),
  constraint client_review_link_expiry check ("expiresAt" > "createdAt")
);

create index if not exists client_review_link_version on client_review_link("versionId", "createdAt" desc);

alter table client_review_link enable row level security;
revoke all on client_review_link from public, anon, authenticated;
grant select on client_review_link to authenticated;

-- Internal staff who can already reach the project can see that a link exists
-- and what became of it. The hash is of no use to them, and of no use to an
-- attacker either.
drop policy if exists client_review_link_internal_read on client_review_link;
create policy client_review_link_internal_read on client_review_link
  for select to authenticated
  using (
    app_is_internal()
    and exists (
      select 1 from content_version v
      join project_task t on t.id = v."taskId"
      where v.id = "versionId" and coalesce(app_project_access(t."projectId", false), false)
    )
  );

-- No insert/update/delete policy: links are only created and withdrawn through
-- the functions below, which check authority themselves.

-- ------------------------------------------------------------- issuing a link

create or replace function issue_client_review_link(
  p_id uuid, p_version uuid, p_token_hash text,
  p_name text, p_email text, p_expires timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v content_version%rowtype;
  t project_task%rowtype;
  p project_content_plan%rowtype;
  existing client_review_link%rowtype;
  tid uuid;
  actor uuid := app_current_user_id();
begin
  if actor is null or not app_is_internal() then
    raise exception 'Only internal staff can send a review link' using errcode = '42501';
  end if;

  select "taskId" into tid from content_version where id = p_version;
  select * into t from project_task where id = tid;
  if t.id is null or not coalesce(app_project_access(t."projectId", true), false) then
    raise exception 'Project reviewer access required' using errcode = '42501';
  end if;

  -- Retrying the same request must not mint a second link.
  select * into existing from client_review_link where id = p_id;
  if found then
    if existing."versionId" = p_version and existing."tokenHash" = p_token_hash then return existing.id; end if;
    raise exception 'Request conflict' using errcode = '23505';
  end if;

  select * into v from content_version where id = p_version;
  select * into p from project_content_plan where "taskId" = tid;

  if not p."clientApprovalRequired" then
    raise exception 'This plan does not require client approval' using errcode = '22023';
  end if;
  -- The client reviews what the team has already approved. Sending work the
  -- team has not signed off is how a half-finished draft reaches a customer.
  if not exists (
    select 1 from content_review
    where "versionId" = v.id and stage = 'INTERNAL' and decision = 'APPROVED'
  ) then
    raise exception 'Internal approval is required before the client sees this' using errcode = '22023';
  end if;
  if exists (select 1 from content_review where "versionId" = v.id and stage = 'CLIENT') then
    raise exception 'This version already has a client decision' using errcode = '23505';
  end if;
  -- Only the current version of the current plan may be sent out.
  if t.status in ('COMPLETED', 'CANCELLED')
     or p.revision is distinct from v."planRevision"
     or exists (select 1 from content_version where "taskId" = tid and "versionNumber" > v."versionNumber") then
    raise exception 'Send the latest version of the current plan' using errcode = '40001';
  end if;
  if p_token_hash is null or length(p_token_hash) <> 64 then
    raise exception 'A hashed token is required' using errcode = '22023';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 200
     or p_email is null or length(trim(p_email)) not between 3 and 320 then
    raise exception 'Name and email of the client reviewer are required' using errcode = '22023';
  end if;
  if p_expires is null or p_expires <= now() or p_expires > now() + interval '60 days' then
    raise exception 'A review link must expire between now and 60 days from now' using errcode = '22023';
  end if;

  insert into client_review_link(id, "versionId", "tokenHash", "recipientName", "recipientEmail", "createdById", "expiresAt")
  values (p_id, p_version, p_token_hash, trim(p_name), lower(trim(p_email)), actor, p_expires);
  return p_id;
end $$;
revoke all on function issue_client_review_link(uuid, uuid, text, text, text, timestamptz) from public, anon;
grant execute on function issue_client_review_link(uuid, uuid, text, text, text, timestamptz) to authenticated;

-- ------------------------------------------------------------ withdrawing one

create or replace function revoke_client_review_link(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l client_review_link%rowtype; t project_task%rowtype; tid uuid; actor uuid := app_current_user_id();
begin
  if actor is null or not app_is_internal() then
    raise exception 'Only internal staff can withdraw a review link' using errcode = '42501';
  end if;
  select * into l from client_review_link where id = p_id for update;
  if not found then raise exception 'That link no longer exists' using errcode = '22023'; end if;

  select "taskId" into tid from content_version where id = l."versionId";
  select * into t from project_task where id = tid;
  if t.id is null or not coalesce(app_project_access(t."projectId", true), false) then
    raise exception 'Project reviewer access required' using errcode = '42501';
  end if;

  -- Withdrawing a link the client already used would hide a decision that was
  -- genuinely made. The decision stands; only unused links can be withdrawn.
  if l."usedAt" is not null then
    raise exception 'That link has already been used; the decision stands' using errcode = '22023';
  end if;
  update client_review_link
  set "revokedAt" = coalesce("revokedAt", now()), "revokedById" = coalesce("revokedById", actor)
  where id = p_id;
end $$;
revoke all on function revoke_client_review_link(uuid) from public, anon;
grant execute on function revoke_client_review_link(uuid) to authenticated;

-- --------------------------------------------------- what the link can be used for

-- Reading the deliverable behind a link. Takes the hash, never the token, and
-- returns only what a client should see: the copy, the brief it was written
-- against, and the asset reference. No internal review notes, no costs, no
-- other client, no staff names beyond who to contact.
create or replace function client_review_context(p_token_hash text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_review_link%rowtype;
  v content_version%rowtype;
  p project_content_plan%rowtype;
  t project_task%rowtype;
  decided content_review%rowtype;
begin
  if p_token_hash is null or length(p_token_hash) <> 64 then return null; end if;
  select * into l from client_review_link where "tokenHash" = p_token_hash;
  if not found then return null; end if;

  select * into v from content_version where id = l."versionId";
  select * into t from project_task where id = v."taskId";
  select * into p from project_content_plan where "taskId" = v."taskId";
  select * into decided from content_review where "versionId" = v.id and stage = 'CLIENT';

  return jsonb_build_object(
    'linkId', l.id,
    'recipientName', l."recipientName",
    'expiresAt', l."expiresAt",
    'expired', l."expiresAt" <= now(),
    'revoked', l."revokedAt" is not null,
    'usedAt', l."usedAt",
    'taskName', t.name,
    'versionNumber', v."versionNumber",
    'channel', p.channel,
    'format', p.format,
    'objective', p.objective,
    'audience', p.audience,
    'brief', p.brief,
    'plannedFor', p."plannedPublishAt",
    'copy', v.copy,
    'assetUrl', v."assetUrl",
    -- A decision already recorded, so reopening the link shows what was said
    -- rather than inviting a second answer.
    'decision', case when decided.id is null then null else jsonb_build_object(
      'decision', decided.decision,
      'evidence', decided.evidence,
      'approver', decided."clientApprover",
      'at', decided."createdAt"
    ) end
  );
end $$;
revoke all on function client_review_context(text) from public;
-- anon may call this: the client is not signed in. The token hash is the only
-- credential, and an unknown hash returns null.
grant execute on function client_review_context(text) to anon, authenticated;

-- Recording the client's own decision. Writes into content_review exactly as a
-- staff-recorded client approval would, so every downstream gate keeps working,
-- but stamps viaLinkId so the two can be told apart afterwards.
create or replace function submit_client_review(
  p_token_hash text, p_decision text, p_approver text, p_comments text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_review_link%rowtype;
  v content_version%rowtype;
  p project_content_plan%rowtype;
  t project_task%rowtype;
  review_id uuid := gen_random_uuid();
begin
  if p_token_hash is null or length(p_token_hash) <> 64 then
    raise exception 'This review link is not valid' using errcode = '42501';
  end if;
  select * into l from client_review_link where "tokenHash" = p_token_hash for update;
  if not found then raise exception 'This review link is not valid' using errcode = '42501'; end if;
  if l."revokedAt" is not null then raise exception 'This review link has been withdrawn' using errcode = '42501'; end if;
  if l."expiresAt" <= now() then raise exception 'This review link has expired' using errcode = '42501'; end if;
  if l."usedAt" is not null then raise exception 'A decision has already been recorded for this link' using errcode = '23505'; end if;

  if p_decision is null or p_decision not in ('APPROVED', 'CHANGES_REQUESTED') then
    raise exception 'Choose whether this is approved or needs changes' using errcode = '22023';
  end if;
  if p_approver is null or length(trim(p_approver)) not between 1 and 200 then
    raise exception 'Please give your name' using errcode = '22023';
  end if;
  if p_comments is null or length(trim(p_comments)) not between 1 and 4000 then
    raise exception 'Please say something about your decision' using errcode = '22023';
  end if;

  select * into v from content_version where id = l."versionId";
  select * into t from project_task where id = v."taskId";
  select * into p from project_content_plan where "taskId" = v."taskId";

  -- The same conditions staff review is held to. If the work moved on after
  -- the link was sent, the client must not be approving something stale.
  if t.status in ('COMPLETED', 'CANCELLED')
     or p.revision is distinct from v."planRevision"
     or exists (select 1 from content_version where "taskId" = v."taskId" and "versionNumber" > v."versionNumber") then
    raise exception 'This work has changed since the link was sent. Ask for a new link.' using errcode = '40001';
  end if;
  if exists (select 1 from content_review where "versionId" = v.id and stage = 'CLIENT') then
    raise exception 'A client decision already exists for this version' using errcode = '23505';
  end if;
  if not exists (
    select 1 from content_review where "versionId" = v.id and stage = 'INTERNAL' and decision = 'APPROVED'
  ) then
    raise exception 'This version is not ready for client review' using errcode = '22023';
  end if;

  -- reviewedById records the staff member who sent the link, because the
  -- column requires an app_user and the client is not one. clientApprover holds
  -- who actually decided, and viaLinkId records that they decided it directly.
  insert into content_review(id, "versionId", stage, decision, evidence, "clientApprover", "reviewedById", "viaLinkId")
  values (review_id, v.id, 'CLIENT', p_decision, trim(p_comments), trim(p_approver), l."createdById", l.id);

  update client_review_link set "usedAt" = now() where id = l.id;

  return jsonb_build_object('reviewId', review_id, 'decision', p_decision);
end $$;
revoke all on function submit_client_review(text, text, text, text) from public;
grant execute on function submit_client_review(text, text, text, text) to anon, authenticated;
