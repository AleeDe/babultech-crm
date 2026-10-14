-- Links that let someone set their own password.
--
-- A login used to be created with a temporary password and nothing sent, so a
-- new hire waited on whoever made the account to pass it on. Now an email
-- carries a single-use link instead: on a new login (WELCOME), or when an
-- administrator sends one from the user's page (RESET).
--
-- Only the SHA-256 of the token is stored. A link works once, until it
-- expires, and a newer link for the same login replaces it. Read and written
-- by the server with the service role only, so there are no policies.

create table if not exists password_link (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null references app_user(id) on delete cascade,
  purpose text not null check (purpose in ('WELCOME', 'RESET')),
  "tokenHash" text not null unique,
  "expiresAt" timestamptz not null,
  "usedAt" timestamptz,
  "createdById" uuid references app_user(id) on delete set null,
  "createdAt" timestamptz not null default now()
);

create index if not exists password_link_user_idx on password_link ("userId");

alter table password_link enable row level security;
revoke all on password_link from anon, authenticated;
