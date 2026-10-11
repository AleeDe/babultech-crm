-- Editing a project whose manager has since been switched off.
--
-- The update policy checked the saved row with app_project_create(), which
-- requires the project manager to be an active login. So once a manager's
-- login was switched off, nobody could save any change to their projects,
-- not even a name, and the error was a bare row-level security message.
--
-- Now a new or changed manager must still be an active internal login, but a
-- manager left as it was does not hold the edit back. The check reads the
-- stored row, which a WITH CHECK clause sees as it was before the update.

create or replace function app_project_update_check(p_id uuid, p_manager uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_project_create(p_manager)
      or (app_project_access(p_id, true)
          and p_manager is not distinct from (select p."projectManagerId" from project p where p.id = p_id));
$$;
revoke all on function app_project_update_check(uuid, uuid) from public, anon;
grant execute on function app_project_update_check(uuid, uuid) to authenticated;

drop policy if exists project_access_update on project;
create policy project_access_update on project for update
  using (app_project_access(id, true))
  with check (app_project_update_check(id, "projectManagerId"));
