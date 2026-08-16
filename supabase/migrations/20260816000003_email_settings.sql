-- Branding and message templates for outbound email.
--
-- A single row: there is one organisation sending these, and a table with one
-- row is easier to read and to change than values scattered through the code.
-- The id is pinned so the row can only ever exist once.
--
-- Templates hold placeholders like {{contactFirstName}}, substituted at send
-- time. They are stored rather than hard-coded so the wording can be changed
-- by whoever actually talks to customers, without a deploy.

create table if not exists email_settings (
  id                uuid primary key default '00000000-0000-0000-0000-000000000001'::uuid,

  -- Identity
  "companyName"     varchar(200)  not null default 'BabulTech',
  "logoUrl"         text,
  "websiteUrl"      text,
  "supportEmail"    varchar(255),
  "supportPhone"    varchar(50),
  "addressLine"     text,

  -- Palette. Hex including the leading #, used inline in the email HTML —
  -- email clients strip <style> blocks, so every colour has to be applied
  -- directly to the element that uses it.
  "brandColor"      varchar(9)    not null default '#00B8A4',
  "brandColorDark"  varchar(9)    not null default '#0F172A',
  "textColor"       varchar(9)    not null default '#1A2233',
  "mutedColor"      varchar(9)    not null default '#64748B',
  "backgroundColor" varchar(9)    not null default '#F1F5F9',

  -- Templates
  "quotationSubject" text not null default 'Quotation {{documentNumber}} from {{companyName}}',
  "quotationBody"    text not null default E'Dear {{contactFirstName}},\n\nThank you for your interest. Please find our quotation below for your consideration — it is valid until {{expiryDate}}.\n\nDo let me know if you would like anything adjusted, or if it would help to talk it through.',
  "invoiceSubject"   text not null default 'Invoice {{documentNumber}} from {{companyName}}',
  "invoiceBody"      text not null default E'Dear {{contactFirstName}},\n\nPlease find our invoice below. Payment is due by {{dueDate}} as per our agreed terms.\n\nDo let me know if anything needs clarifying.',

  "emailFooter"      text not null default 'This email and any attachments are confidential and intended solely for the addressee.',

  "createdAt"       timestamp(3) not null default current_timestamp,
  "updatedAt"       timestamp(3) not null default current_timestamp
);

insert into email_settings (id) values ('00000000-0000-0000-0000-000000000001'::uuid)
on conflict (id) do nothing;

-- Readable by any internal user, since every send reads it; writable only at
-- ALL scope, matching the other reference data in Settings.
alter table email_settings enable row level security;

drop policy if exists email_settings_internal_read on email_settings;
create policy email_settings_internal_read on email_settings
  for select using (app_is_internal());

drop policy if exists email_settings_admin_write on email_settings;
create policy email_settings_admin_write on email_settings
  for all
  using (app_current_scope() = 'ALL')
  with check (app_current_scope() = 'ALL');
