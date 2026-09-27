-- A lead brought back from a merge is checked like one brought back from deletion.
--
-- 20260928000001 checks a lead in full when its deletedAt is cleared, but the
-- trigger did not fire at all when mergedIntoId was cleared. merge_leads sets
-- both, so the app never clears one without the other - but a row written as
-- merged and then un-merged would have come back as a live duplicate without a
-- look. Clearing either is now a return, and is checked as one.

create or replace function lead_refuse_duplicate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full boolean;
  v_hit  jsonb;
begin
  -- A lead being retired - deleted, or merged into another - claims nobody.
  if new."deletedAt" is not null or new."mergedIntoId" is not null then
    return new;
  end if;

  -- An insert that is about to collide with a lead's id or number is an
  -- upsert on it: the row becomes an update of that lead, and is checked as an
  -- edit by the UPDATE half of this trigger. Checked here it would match the
  -- lead's own contact, or itself under its old id.
  if tg_op = 'INSERT' and exists (
    select 1 from lead where id = new.id or "leadNumber" = new."leadNumber"
  ) then
    return new;
  end if;

  v_full := tg_op = 'INSERT'
    or old."deletedAt" is not null
    or old."mergedIntoId" is not null;

  v_hit := person_match(
    'lead',
    case when v_full or email_key(new.email) is distinct from email_key(old.email) then new.email end,
    case when v_full or phone_key(new.phone) is distinct from phone_key(old.phone) then new.phone end,
    case when v_full or phone_key(new.whatsapp) is distinct from phone_key(old.whatsapp) then new.whatsapp end,
    null,
    new.id, null);

  if v_hit is not null then
    raise exception using
      message = person_match_message(v_hit, 'lead'),
      errcode = '23505',
      detail  = person_match_visible(v_hit)::text,
      hint    = 'duplicate_person';
  end if;

  return new;
end $$;

revoke all on function lead_refuse_duplicate() from public, anon, authenticated;

drop trigger if exists lead_refuse_duplicate on lead;
create trigger lead_refuse_duplicate
  before insert or update of email, phone, whatsapp, "deletedAt", "mergedIntoId"
  on lead
  for each row execute function lead_refuse_duplicate();
