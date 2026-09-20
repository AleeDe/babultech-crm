-- Anyone who can fill the form can add a value to an open dropdown.
--
-- Campaign types already worked this way, for a good reason: leaving a
-- half-filled form to go and create one lookup value, or to ask an
-- administrator for it, is a worse trade than letting the person who is
-- already entitled to create the record name the thing they are creating.
--
-- Only open lists. Workflow lists (stages, statuses, priority) are still closed
-- to additions at any permission level, because a value the code does not know
-- would have no rules behind it. Renaming, reordering, hiding and deleting
-- values stay with administrators, in Settings.
create or replace function add_picklist_value(p_list text, p_value text, p_label text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_list picklist%rowtype;
  v_value text := btrim(p_value);
  v_label text := btrim(p_label);
  v_row picklist_value%rowtype;
begin
  if not app_can_write() then
    raise exception 'You do not have permission to add dropdown values.' using errcode = '42501';
  end if;

  select * into v_list from picklist where key = p_list;
  if not found then raise exception 'Unknown list.'; end if;
  if v_list.locked then
    raise exception '% is a workflow list. Its values can be renamed or hidden, but not added.', v_list.label;
  end if;
  if coalesce(v_value, '') = '' or coalesce(v_label, '') = '' then
    raise exception 'Give the value a name.';
  end if;
  if length(v_label) > 100 then
    raise exception 'That name is too long.';
  end if;

  -- An existing value wins over a near-duplicate: "Webinar" and "webinar" in
  -- one dropdown is a reporting problem later, not a naming preference now.
  select * into v_row from picklist_value
   where "picklistKey" = p_list and lower(label) = lower(v_label);
  if found then
    if not v_row.active then
      update picklist_value set active = true, "updatedAt" = now() where id = v_row.id returning * into v_row;
    end if;
    return to_jsonb(v_row);
  end if;

  if v_list."enumType" is not null then
    -- Enum values are codes: upper case with underscores.
    v_value := btrim(upper(regexp_replace(v_value, '[^A-Za-z0-9]+', '_', 'g')), '_');
    if v_value = '' then raise exception 'Give the value a name.'; end if;
    execute format('alter type %I add value if not exists %L', v_list."enumType", v_value);
  end if;

  insert into picklist_value ("picklistKey", value, label, "sortOrder")
  values (p_list, v_value, v_label,
          coalesce((select max("sortOrder") from picklist_value where "picklistKey" = p_list), 0) + 10)
  on conflict ("picklistKey", value) do update set active = true, label = excluded.label, "updatedAt" = now()
  returning * into v_row;

  return to_jsonb(v_row);
end $$;
