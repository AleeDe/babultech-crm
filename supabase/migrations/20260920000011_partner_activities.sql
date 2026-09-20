-- One conversation with each partner, kept where both sides can see it.
--
-- Everything a partner needs to say to us today happens somewhere we cannot
-- search: an email to whoever they have the address of, a WhatsApp message to
-- their partner manager. When that person is away, or leaves, the thread goes
-- with them. This is the same conversation, against the partnership, visible to
-- the partner in their portal and to us on the partner's page.
--
-- Chat and email are one table on purpose. They are one conversation to the
-- people having it: a partner sends a message, we reply by email, they answer
-- the message. Split across two tables, the thread can only be reassembled by
-- interleaving two queries on timestamps, and it would be wrong the first time
-- the clocks disagreed. `kind` records how something was sent; it does not
-- change where it lives.
--
-- Sent email is ALSO written to the email table, which is where the rest of the
-- application looks for correspondence. This table holds the conversation; that
-- one holds the mail.

create table if not exists partner_message (
  id uuid primary key,

  "partnerId" uuid not null references partner (id) on delete cascade,

  -- MESSAGE: typed in a portal or on the partner page.
  -- EMAIL:   composed here and actually sent.
  kind text not null default 'MESSAGE' check (kind in ('MESSAGE', 'EMAIL')),

  -- Which side of the partnership wrote it. Derived from the author when the
  -- row is written rather than at read time, because a person's userType can
  -- change and the record of who said what must not move with it.
  "authorSide" text not null check ("authorSide" in ('PARTNER', 'INTERNAL')),
  "authorUserId" uuid references app_user (id) on delete set null,
  -- The author's name as it was. An author who is later deleted still said
  -- this, and "Unknown" reads as a bug rather than as history.
  "authorName" varchar(200) not null,

  -- Email only.
  subject varchar(500),
  "toAddresses" jsonb,
  "emailId" uuid references email (id) on delete set null,

  body text not null,

  -- Set when the other side has seen it, which is what drives the unread count
  -- rather than a per-person read table: a partnership is two sides, not n
  -- individuals, and nobody needs to know which colleague opened it.
  "readAt" timestamp(3),

  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp,
  "deletedAt" timestamp(3)
);

create index if not exists "partner_message_partnerId_idx"
  on partner_message ("partnerId", "createdAt" desc);
create index if not exists "partner_message_unread_idx"
  on partner_message ("partnerId", "authorSide") where "readAt" is null;

create table if not exists partner_message_attachment (
  id uuid primary key,
  "messageId" uuid not null references partner_message (id) on delete cascade,
  -- The name the uploader saw. The stored object is named by a uuid, so a
  -- caller-supplied filename can never steer the storage path.
  "fileName" varchar(255) not null,
  "mimeType" varchar(120) not null,
  "fileSizeBytes" integer not null,
  -- Path inside the private bucket, never a public URL.
  "storagePath" text not null,
  "isImage" boolean not null default false,
  "uploadedById" uuid references app_user (id) on delete set null,
  "createdAt" timestamp(3) not null default current_timestamp
);

create index if not exists "partner_message_attachment_messageId_idx"
  on partner_message_attachment ("messageId");

-- ---------------------------------------------------------------------------
-- Who may read it
-- ---------------------------------------------------------------------------

alter table partner_message enable row level security;
alter table partner_message force row level security;
alter table partner_message_attachment enable row level security;
alter table partner_message_attachment force row level security;

drop policy if exists partner_message_internal_read on partner_message;
create policy partner_message_internal_read on partner_message
  for select using (app_is_internal() and "deletedAt" is null);

drop policy if exists partner_message_partner_read on partner_message;
create policy partner_message_partner_read on partner_message
  for select using (
    app_current_partner_id() is not null
    and "partnerId" = app_current_partner_id()
    and "deletedAt" is null
  );

drop policy if exists partner_message_attachment_read on partner_message_attachment;
create policy partner_message_attachment_read on partner_message_attachment
  for select using (
    "messageId" in (select id from partner_message)
  );

-- Writes go through the functions below on both sides, as everywhere else in
-- the partner surface: the rules about who may post as whom live in one place.

-- ---------------------------------------------------------------------------
-- Saying something
-- ---------------------------------------------------------------------------
--
-- One function for both sides. Which side the author is on is read from the
-- session rather than passed in, so a partner cannot post a message that
-- appears to come from us.
create or replace function post_partner_message(
  p_partner_id uuid,
  p_body       text,
  p_kind       text default 'MESSAGE',
  p_subject    text default null,
  p_to         jsonb default null,
  p_email_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := app_current_user_id();
  v_partner uuid := app_current_partner_id();
  v_side    text;
  v_name    text;
  v_id      uuid := gen_random_uuid();
begin
  if v_user is null then
    raise exception 'You are not signed in.';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'There is nothing to send.';
  end if;

  if v_partner is not null then
    -- A partner may only ever post to their own partnership, whatever the
    -- caller passed.
    if p_partner_id is distinct from v_partner then
      raise exception 'You can only write to your own partnership.';
    end if;
    v_side := 'PARTNER';
  else
    if not app_is_internal() then
      raise exception 'Only a partner or a colleague may write here.';
    end if;
    v_side := 'INTERNAL';
  end if;

  select "fullName" into v_name from app_user where id = v_user;

  insert into partner_message (
    id, "partnerId", kind, "authorSide", "authorUserId", "authorName",
    subject, "toAddresses", "emailId", body, "createdAt", "updatedAt"
  ) values (
    v_id, p_partner_id,
    case when p_kind = 'EMAIL' then 'EMAIL' else 'MESSAGE' end,
    v_side, v_user, coalesce(v_name, 'Someone'),
    nullif(btrim(coalesce(p_subject, '')), ''), p_to, p_email_id,
    btrim(p_body), now(), now()
  );

  return jsonb_build_object('id', v_id, 'authorSide', v_side, 'authorName', v_name);
end;
$$;

-- Marking the other side's messages as seen. Only ever the OTHER side's: a
-- partner opening the thread has not read their own message, and counting it
-- would make the unread badge wrong for us.
create or replace function mark_partner_messages_read(p_partner_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid := app_current_partner_id();
  v_theirs  text;
  v_rows    integer;
begin
  if v_partner is not null then
    if p_partner_id is distinct from v_partner then
      raise exception 'That is not your partnership.';
    end if;
    v_theirs := 'INTERNAL';
  elsif app_is_internal() then
    v_theirs := 'PARTNER';
  else
    raise exception 'You are not signed in.';
  end if;

  update partner_message
     set "readAt" = now(), "updatedAt" = now()
   where "partnerId" = p_partner_id
     and "authorSide" = v_theirs
     and "readAt" is null;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- Attachment rows. The object itself is uploaded with the service role by the
-- application; this records what it is and checks the message is one the
-- caller may write to.
create or replace function attach_to_partner_message(
  p_message_id uuid,
  p_file_name  text,
  p_mime_type  text,
  p_size_bytes integer,
  p_path       text,
  p_is_image   boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := app_current_user_id();
  v_partner uuid := app_current_partner_id();
  v_message record;
  v_id      uuid := gen_random_uuid();
begin
  if v_user is null then
    raise exception 'You are not signed in.';
  end if;

  select "partnerId", "authorUserId" into v_message
  from partner_message where id = p_message_id and "deletedAt" is null;

  if v_message."partnerId" is null then
    raise exception 'That message no longer exists.';
  end if;
  if v_partner is not null and v_message."partnerId" is distinct from v_partner then
    raise exception 'That message is not yours.';
  end if;
  -- Only onto your own message, on either side: attaching to somebody else's
  -- would put a file under their name.
  if v_message."authorUserId" is distinct from v_user then
    raise exception 'You can only attach files to your own messages.';
  end if;

  insert into partner_message_attachment (
    id, "messageId", "fileName", "mimeType", "fileSizeBytes", "storagePath",
    "isImage", "uploadedById", "createdAt"
  ) values (
    v_id, p_message_id, left(p_file_name, 255), p_mime_type, p_size_bytes,
    p_path, coalesce(p_is_image, false), v_user, now()
  );

  return jsonb_build_object('id', v_id);
end;
$$;

revoke all on function post_partner_message(uuid, text, text, text, jsonb, uuid) from public;
revoke all on function mark_partner_messages_read(uuid) from public;
revoke all on function attach_to_partner_message(uuid, text, text, integer, text, boolean) from public;

grant execute on function post_partner_message(uuid, text, text, text, jsonb, uuid) to authenticated;
grant execute on function mark_partner_messages_read(uuid) to authenticated;
grant execute on function attach_to_partner_message(uuid, text, text, integer, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Where the files live
-- ---------------------------------------------------------------------------
--
-- Private, and its own bucket rather than sharing note-attachments: those are
-- internal evidence on internal notes, and a bucket that external logins can
-- reach should hold only what was always meant for them.
insert into storage.buckets (id, name, public)
values ('partner-attachments', 'partner-attachments', false)
on conflict (id) do nothing;
