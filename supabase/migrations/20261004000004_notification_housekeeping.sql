-- Notifications are cleared away once they have done their job, so the table
-- does not grow for ever.
--
--   * Read ones go 7 days after they were read.
--   * Email-only ones (never shown under the bell, so never read) go 7 days
--     after the email was dealt with - sent, skipped or failed. One still
--     waiting to be sent is never touched.
--   * Overdue reminders are kept 31 days. The daily reminder check reminds
--     about an overdue task for up to 30 days and knows it already has by
--     finding this row; removing it sooner would remind again every week.
--   * Unread ones are kept.

create or replace function notification_housekeeping()
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from notification
     where (
             ("inApp" and "readAt" < now() - interval '7 days')
          or (not "inApp" and coalesce("emailStatus", 'SKIPPED') <> 'PENDING'
                and coalesce("emailedAt", "createdAt") < now() - interval '7 days')
           )
       and (
             coalesce("dedupeKey", '') not like 'overdue:%'
          or coalesce("readAt", "emailedAt", "createdAt") < now() - interval '31 days'
           )
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function notification_housekeeping() from public, anon, authenticated;
grant execute on function notification_housekeeping() to service_role;

select cron.schedule('babultech-notification-housekeeping', '45 22 * * *', 'select public.notification_housekeeping()');
