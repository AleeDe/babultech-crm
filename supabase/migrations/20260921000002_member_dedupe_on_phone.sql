-- Match an imported member on their phone number when they have no email.
--
-- The first version deduped on email alone, so anybody without an address was
-- added again on every import. Marketing lists are full of such people - a
-- trade-show sheet is often names and mobile numbers and nothing else - and
-- three imports of the same sheet would have produced three copies of each,
-- then mailed nobody and called everybody three times.
--
-- Phone is compared on its last nine digits, the same rule the partner conflict
-- check uses: +92 300 7654321 and 03007654321 are one number written two ways,
-- and a dedupe that misses that is not a dedupe.
--
-- Email still wins where there is one. It is the stronger key: people share
-- office numbers far more often than they share mailboxes.

create or replace function import_campaign_members(p_rows jsonb, p_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      jsonb;
  v_email    text;
  v_digits   text;
  v_tail     text;
  v_existing uuid;
  v_added    integer := 0;
  v_updated  integer := 0;
  v_skipped  integer := 0;
begin
  if not (app_is_internal() and app_has_permission('lead:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    if coalesce(btrim(v_row ->> 'firstName'), '') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_email := nullif(lower(btrim(coalesce(v_row ->> 'email', ''))), '');

    -- Nine digits is enough to identify a number and short enough to survive a
    -- country code or a trunk zero on either side of the comparison.
    v_digits := regexp_replace(coalesce(v_row ->> 'phone', ''), '\D', '', 'g');
    v_tail := case when length(v_digits) >= 9 then right(v_digits, 9) else null end;

    v_existing := null;

    if v_email is not null then
      select id into v_existing
      from campaign_member
      where lower(email) = v_email and "deletedAt" is null
      limit 1;
    end if;

    -- Only where there was no email to go on. A person with an address that
    -- does not match is a new person, even if they share a switchboard with
    -- somebody already on the list.
    if v_existing is null and v_email is null and v_tail is not null then
      select id into v_existing
      from campaign_member
      where "deletedAt" is null
        and length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 9
        and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = v_tail
      limit 1;
    end if;

    if v_existing is not null then
      update campaign_member set
        "firstName"    = coalesce(nullif(btrim(v_row ->> 'firstName'), ''), "firstName"),
        "lastName"     = coalesce(nullif(btrim(coalesce(v_row ->> 'lastName', '')), ''), "lastName"),
        -- An address may be filled in on a later import; it is never cleared.
        email          = coalesce(v_email, email),
        phone          = coalesce(nullif(btrim(coalesce(v_row ->> 'phone', '')), ''), phone),
        whatsapp       = coalesce(nullif(btrim(coalesce(v_row ->> 'whatsapp', '')), ''), whatsapp),
        "companyName"  = coalesce(nullif(btrim(coalesce(v_row ->> 'companyName', '')), ''), "companyName"),
        website        = coalesce(nullif(btrim(coalesce(v_row ->> 'website', '')), ''), website),
        "businessType" = coalesce(nullif(btrim(coalesce(v_row ->> 'businessType', '')), ''), "businessType"),
        "companySize"  = coalesce(nullif(btrim(coalesce(v_row ->> 'companySize', '')), ''), "companySize"),
        street         = coalesce(nullif(btrim(coalesce(v_row ->> 'street', '')), ''), street),
        city           = coalesce(nullif(btrim(coalesce(v_row ->> 'city', '')), ''), city),
        state          = coalesce(nullif(btrim(coalesce(v_row ->> 'state', '')), ''), state),
        "postalCode"   = coalesce(nullif(btrim(coalesce(v_row ->> 'postalCode', '')), ''), "postalCode"),
        country        = coalesce(nullif(btrim(coalesce(v_row ->> 'country', '')), ''), country),
        "updatedAt"    = now()
      where id = v_existing;
      v_updated := v_updated + 1;
    else
      insert into campaign_member (
        id, "firstName", "lastName", email, phone, whatsapp,
        "companyName", website, "businessType", "companySize",
        street, city, state, "postalCode", country,
        source, "ownerUserId", notes, "createdAt", "updatedAt"
      ) values (
        gen_random_uuid(),
        btrim(v_row ->> 'firstName'),
        nullif(btrim(coalesce(v_row ->> 'lastName', '')), ''),
        v_email,
        nullif(btrim(coalesce(v_row ->> 'phone', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'whatsapp', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'companyName', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'website', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'businessType', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'companySize', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'street', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'city', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'state', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'postalCode', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'country', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'source', '')), ''),
        p_owner,
        nullif(btrim(coalesce(v_row ->> 'notes', '')), ''),
        now(), now()
      );
      v_added := v_added + 1;
    end if;
  end loop;

  return jsonb_build_object('added', v_added, 'updated', v_updated, 'skipped', v_skipped);
end $$;

-- The index that makes the phone fallback worth doing rather than a table scan
-- per imported row.
create index if not exists "campaign_member_phone_tail_idx"
  on campaign_member (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9))
  where "deletedAt" is null;
