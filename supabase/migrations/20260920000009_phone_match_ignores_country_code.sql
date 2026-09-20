-- Match a phone number the way a person would read it.
--
-- partner_find_conflict compared every digit of a number, which made
-- +92 300 7654321 and 03007654321 different numbers. They are the same number:
-- one carries the country code, the other the trunk zero that replaces it.
-- That was precisely the duplicate-by-reformatting hole the digit comparison
-- was there to close, and a boundary test caught it before any partner did.
--
-- The fix compares the last nine digits - the end of the national significant
-- number, which both forms share. Nine rather than ten because a trunk zero
-- makes one form a digit longer, and rather than fewer because short suffixes
-- start colliding between unrelated numbers.
--
-- This is a heuristic, not a phone-number parser. It will occasionally flag two
-- genuinely different numbers as the same, which is the safe direction to be
-- wrong in: a false conflict shows the partner a company name they can see is
-- not theirs, while a missed one creates a duplicate customer and a commission
-- dispute months later.

create or replace function partner_find_conflict(
  p_account_name text,
  p_email        text default null,
  p_phone        text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_partner uuid := app_current_partner_id();
  v_account record;
  v_digits  text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_tail    text;
begin
  if v_partner is null then
    raise exception 'Only a partner may check for a conflict.';
  end if;

  -- Only worth comparing once there is enough of a number to be distinctive.
  v_tail := case when length(v_digits) >= 9 then right(v_digits, 9) else null end;

  select a.id, a.name, a."billingAddress" ->> 'city' as city,
         a."accountType", a."customerStatus",
         a."sourcePartnerId", a."createdAt",
         p."displayName" as "sourcePartnerName"
    into v_account
  from account a
  left join partner p on p.id = a."sourcePartnerId"
  where a."deletedAt" is null
    and (
      lower(btrim(a.name)) = lower(btrim(p_account_name))
      or (
        nullif(btrim(coalesce(p_email, '')), '') is not null
        and exists (
          select 1 from contact c
          where c."accountId" = a.id
            and c."deletedAt" is null
            and lower(c.email) = lower(btrim(p_email))
        )
      )
      or (
        v_tail is not null
        and exists (
          select 1 from contact c
          where c."accountId" = a.id
            and c."deletedAt" is null
            and length(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) >= 9
            and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9) = v_tail
        )
      )
    )
  order by a."createdAt"
  limit 1;

  if v_account.id is null then
    return jsonb_build_object('conflict', false);
  end if;

  return jsonb_build_object(
    'conflict', true,
    'mine', v_account."sourcePartnerId" is not distinct from v_partner,
    'accountName', v_account.name,
    'city', v_account.city,
    'accountType', v_account."accountType",
    'customerStatus', v_account."customerStatus",
    'registeredOn', to_char(v_account."createdAt", 'YYYY-MM-DD'),
    'broughtBy', case
      when v_account."sourcePartnerId" is null then null
      when v_account."sourcePartnerId" = v_partner then 'you'
      else v_account."sourcePartnerName"
    end
  );
end;
$$;

revoke all on function partner_find_conflict(text, text, text) from public;
grant execute on function partner_find_conflict(text, text, text) to authenticated;
