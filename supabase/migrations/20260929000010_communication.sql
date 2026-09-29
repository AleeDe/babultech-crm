-- Communication: templates, sender addresses, and consent.
--
-- Templates. A named subject and message with placeholders ({{firstName}},
-- {{companyName}} and so on) that anyone emailing leads, contacts or campaign
-- members can start from. Anyone who sends email can add one; its author or an
-- administrator can change it.
--
-- Sender addresses. The "from" names and addresses a send may go out under -
-- Sales, Support - chosen when sending. They must be on the domain the mail
-- provider has verified; the app checks that before it sends.
--
-- Consent. A contact can now be marked as not wanting email, beside the
-- existing "has consented to marketing". Unsubscribing from any email marks
-- every lead, contact and campaign member at that address, not only the one
-- that was sent to, since the person is telling us about themselves.

create table if not exists email_template (
  id uuid primary key default gen_random_uuid(),
  name varchar(150) not null,
  -- Who it is written for: any list, or one kind of person.
  audience varchar(20) not null default 'ANY' check (audience in ('ANY', 'Lead', 'Contact', 'CampaignMember')),
  subject varchar(300) not null,
  body text not null,
  active boolean not null default true,
  "createdById" uuid references app_user(id) on delete set null,
  "createdAt" timestamp(3) not null default now(),
  "updatedAt" timestamp(3) not null default now()
);

create table if not exists email_sender (
  id uuid primary key default gen_random_uuid(),
  label varchar(80) not null,
  "fromName" varchar(120) not null,
  "fromAddress" varchar(255) not null unique,
  "replyTo" varchar(255),
  "isDefault" boolean not null default false,
  active boolean not null default true,
  "createdAt" timestamp(3) not null default now(),
  "updatedAt" timestamp(3) not null default now()
);
create unique index if not exists email_sender_one_default_idx on email_sender ("isDefault") where "isDefault";

alter table email_template enable row level security;
alter table email_sender enable row level security;

drop policy if exists email_template_read on email_template;
create policy email_template_read on email_template for select to authenticated using (app_is_internal());
drop policy if exists email_template_insert on email_template;
create policy email_template_insert on email_template for insert to authenticated
  with check (app_is_internal() and "createdById" = app_current_user_id()
              and (app_has_permission('lead:write') or app_has_permission('account:write')));
drop policy if exists email_template_change on email_template;
create policy email_template_change on email_template for update to authenticated
  using (app_is_internal() and ("createdById" = app_current_user_id() or app_has_permission('admin:settings')))
  with check (app_is_internal() and ("createdById" = app_current_user_id() or app_has_permission('admin:settings')));
drop policy if exists email_template_delete on email_template;
create policy email_template_delete on email_template for delete to authenticated
  using (app_is_internal() and ("createdById" = app_current_user_id() or app_has_permission('admin:settings')));

drop policy if exists email_sender_read on email_sender;
create policy email_sender_read on email_sender for select to authenticated using (app_is_internal());
drop policy if exists email_sender_write on email_sender;
create policy email_sender_write on email_sender for all to authenticated
  using (app_is_internal() and app_has_permission('admin:settings'))
  with check (app_is_internal() and app_has_permission('admin:settings'));

drop trigger if exists view_as_read_only on email_template;
create trigger view_as_read_only before insert or update or delete on email_template
  for each statement execute function app_refuse_view_as_writes();
drop trigger if exists view_as_read_only on email_sender;
create trigger view_as_read_only before insert or update or delete on email_sender
  for each statement execute function app_refuse_view_as_writes();

alter table contact
  add column if not exists "emailOptOut" boolean not null default false,
  add column if not exists "emailOptOutAt" timestamp(3);

alter table email_batch
  add column if not exists "fromAddress" varchar(255),
  add column if not exists "senderId" uuid references email_sender(id) on delete set null,
  add column if not exists "templateId" uuid references email_template(id) on delete set null;

-- Unsubscribing marks the person everywhere. Otherwise as 20260926000001.
create or replace function unsubscribe_activity(p_activity uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_email text;
begin
  select lower(btrim("toAddress")) into v_email
  from activity
  where id = p_activity and "toAddress" is not null and "deletedAt" is null;

  if v_email is null then
    return jsonb_build_object('done', true);
  end if;

  insert into email_suppression (email, reason, notes, "sourceActivityId")
  values (v_email, 'UNSUBSCRIBED', 'Unsubscribed from an email', p_activity)
  on conflict (email) do nothing;

  update activity set
    "unsubscribedAt" = coalesce("unsubscribedAt", now()),
    "updatedAt" = now()
  where lower(btrim("toAddress")) = v_email
    and "sentAt" is not null
    and "unsubscribedAt" is null;

  update contact set "emailOptOut" = true, "emailOptOutAt" = coalesce("emailOptOutAt", now()), "updatedAt" = now()
   where lower(btrim(email)) = v_email and not "emailOptOut";
  update campaign_member set "emailOptOut" = true, "emailOptOutAt" = coalesce("emailOptOutAt", now()),
         "emailOptOutReason" = coalesce("emailOptOutReason", 'Unsubscribed from an email'), "updatedAt" = now()
   where lower(btrim(email)) = v_email and not "emailOptOut";

  return jsonb_build_object('done', true);
end $$;

revoke all on function unsubscribe_activity(uuid) from public;
grant execute on function unsubscribe_activity(uuid) to anon, authenticated;

-- A person opted out or back in by staff. Opting out suppresses the address
-- for every send; opting back in lifts only an unsubscribe, never a bounce or
-- a spam complaint, which are about the address and not the person's wish.
create or replace function set_email_opt_out(p_email text, p_opt_out boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email = '' then
    return;
  end if;
  if p_opt_out then
    insert into email_suppression (email, reason, notes)
    values (v_email, 'UNSUBSCRIBED', coalesce(p_note, 'Opted out by staff'))
    on conflict (email) do nothing;
  else
    delete from email_suppression where email = v_email and reason = 'UNSUBSCRIBED';
  end if;
  update contact set "emailOptOut" = p_opt_out, "emailOptOutAt" = case when p_opt_out then now() end, "updatedAt" = now()
   where lower(btrim(email)) = v_email;
  update campaign_member set "emailOptOut" = p_opt_out, "emailOptOutAt" = case when p_opt_out then now() end,
         "emailOptOutReason" = case when p_opt_out then coalesce(p_note, 'Opted out by staff') end, "updatedAt" = now()
   where lower(btrim(email)) = v_email;
end $$;

revoke all on function set_email_opt_out(text, boolean, text) from public, anon, authenticated;
grant execute on function set_email_opt_out(text, boolean, text) to service_role;

notify pgrst, 'reload schema';
