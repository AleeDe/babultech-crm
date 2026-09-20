-- Three things the first partner login through the new portal found.
--
-- 1. More than one person per partner may sign in.
--
--    app_user."partnerId" carried a UNIQUE index, which allowed exactly one
--    login per partnership. That matched the old model, where a partner was a
--    single contact we had a password for. It does not match a partner company
--    whose people each need their own login, which is what the portal is now
--    for - and the portal-access panel already lists several people with a
--    "Give access" button each, the second of which would have failed on a raw
--    constraint violation.
--
--    The index becomes non-unique. Nothing depended on the uniqueness:
--    app_current_partner_id() reads the partnership off the signed-in user's
--    own row, not by searching for the partner's one user.
drop index if exists "app_user_partnerId_key";
create index if not exists "app_user_partnerId_idx" on app_user ("partnerId");

-- 2. A partner may see their own account.
--
--    account_partner_read showed a partner only the customers they sourced,
--    which left their own company invisible to them - getPortalAccounts reads
--    partner.accountId expressly to show it, and got nothing back. Their own
--    account is the one account they are most obviously entitled to.
drop policy if exists account_partner_read on account;
create policy account_partner_read on account
  for select
  using (
    app_current_partner_id() is not null
    and (
      "sourcePartnerId" = app_current_partner_id()
      or id in (select p."accountId" from partner p where p.id = app_current_partner_id())
    )
  );

-- 3. Their own account's contacts, for the same reason.
drop policy if exists contact_partner_read on contact;
create policy contact_partner_read on contact
  for select
  using (
    app_current_partner_id() is not null
    and "accountId" in (
      select a.id from account a
      where a."sourcePartnerId" = app_current_partner_id()
      union
      select p."accountId" from partner p
      where p.id = app_current_partner_id() and p."accountId" is not null
    )
  );
