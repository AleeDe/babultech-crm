-- Attribution cannot be re-pointed. It can still be cleared.
--
-- The write-once guard refused every change to sourcePartnerId and
-- sourcePartnerUserId, including a change to null. Both columns are declared
-- ON DELETE SET NULL, so the guard and the foreign key contradicted each
-- other: deleting a partner login raised
--
--   "Who at the partner brought this cannot be changed once recorded."
--
-- and the delete failed. In practice that meant anybody who had ever brought a
-- customer could never be removed, and neither could a partner - with an error
-- about commission credit that says nothing about why a user will not delete.
--
-- The thing actually worth forbidding is REPOINTING: moving a customer's
-- credit from one partner to another, or from one person to another, which
-- moves the money. Clearing is not that. When a partner login is deleted the
-- person who brought the customer is gone, but the PARTNER still brought them,
-- and sourcePartnerId is untouched - the company keeps the credit and the
-- commission with it.
--
-- So: a non-null value may not become a different non-null value. It may
-- become null, which is what the foreign key does on its own when the row it
-- points at goes.

create or replace function guard_attribution_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then return new; end if;

  if old."sourcePartnerId" is not null
     and new."sourcePartnerId" is not null
     and new."sourcePartnerId" is distinct from old."sourcePartnerId" then
    raise exception
      'This customer is already credited to another partner. Credit decides who is paid commission, so it cannot be moved.'
      using errcode = '42501';
  end if;

  if old."sourcePartnerUserId" is not null
     and new."sourcePartnerUserId" is not null
     and new."sourcePartnerUserId" is distinct from old."sourcePartnerUserId" then
    raise exception
      'This is already credited to somebody else at the partner, and cannot be moved to another person.'
      using errcode = '42501';
  end if;

  return new;
end $$;
