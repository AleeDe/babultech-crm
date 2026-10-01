-- Each person's own preferences: the time zone and date format they read dates
-- in, and the page they land on after signing in. Not permissions - a
-- preference never decides what anybody may see.

create table if not exists user_preference (
  "userId" uuid primary key default app_current_user_id() references app_user (id) on delete cascade,
  -- An IANA zone such as Asia/Karachi or America/Toronto; null follows the company's.
  "timeZone" varchar(64),
  "dateFormat" varchar(3) not null default 'DMY' check ("dateFormat" in ('DMY', 'MDY', 'YMD')),
  -- A path inside the app, such as /my-work; null is the dashboard.
  "startPage" varchar(100) check ("startPage" is null or "startPage" ~ '^/[a-z0-9/_-]*$'),
  "updatedAt" timestamp(3) not null default now()
);

alter table user_preference enable row level security;
drop policy if exists user_preference_own on user_preference;
create policy user_preference_own on user_preference for all to authenticated
  using ("userId" = app_current_user_id())
  with check ("userId" = app_current_user_id());
grant select, insert, update, delete on user_preference to authenticated;
