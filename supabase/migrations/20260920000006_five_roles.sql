-- Five roles, and permissions an administrator can change.
--
-- The system shipped with eleven roles, most of them unused, and no way to see
-- or change what any of them could do without a migration. Five remain:
--
--   Super Admin  every permission, all data. Also the only role that can
--                configure roles, so it cannot be edited away.
--   Manager      runs the business day to day: sales, delivery and finance,
--                over their own team's records.
--   Consultant   does the work: their own projects, cases and expenses.
--   Partner      an external partner login. No CRM permissions at all.
--   Customer     an external customer login. No CRM permissions at all.
--
-- More can be added from Settings now, which is the point: the list above is a
-- starting set, not a ceiling.
--
-- The two external roles hold no permissions by design. What keeps a partner or
-- a customer out of the CRM is userType, checked by app_is_internal() in every
-- policy - never the absence of a permission, which a future edit could undo.

-- isSystem marks the three roles the application itself looks up or depends on:
-- Super Admin by its permissions, Partner and Customer by name. They may be
-- described differently but not renamed, re-scoped or deleted.
update security_role set "isSystem" = false where "isSystem";

-- ---------------------------------------------------------------------------
-- The five
-- ---------------------------------------------------------------------------

update security_role
   set name = 'Super Admin',
       description = 'Everything, everywhere. The only role that can manage users, roles and settings.',
       "dataScope" = 'ALL',
       "isSystem" = true,
       active = true,
       "updatedAt" = now()
 where permissions @> array['*'];

-- Manager absorbs Project Manager, Sales Manager and Finance: one role that
-- runs sales, delivery and money over their own team's records. Everything an
-- employee can do except administering the system and reading the credential
-- vault, which stay with Super Admin.
update security_role
   set name = 'Manager',
       description = 'Runs sales, delivery and finance for their team. Cannot manage users, roles, settings or the credential vault.',
       "dataScope" = 'TEAM',
       permissions = array[
         'lead:*', 'account:*', 'opportunity:*', 'quotation:approve', 'contract:*',
         'partner:read', 'commission:read', 'commission:write', 'commission:approve', 'payout:approve',
         'case:*', 'project:*', 'project:rates', 'time:approve', 'content:review',
         'invoice:read', 'invoice:write', 'invoice:approve', 'invoice:issue', 'invoice:void',
         'period:close', 'payable:approve', 'payment:write',
         'expense:read', 'expense:write', 'expense:approve'
       ],
       "isSystem" = false,
       active = true,
       "updatedAt" = now()
 where name = 'Project Manager';

update security_role
   set description = 'Works on projects: their own tasks, cases and expense claims.',
       "dataScope" = 'OWN',
       permissions = array['project:read', 'project:write', 'case:read', 'case:write', 'expense:read', 'expense:write'],
       "isSystem" = false,
       active = true,
       "updatedAt" = now()
 where name = 'Consultant';

update security_role
   set description = 'An external partner login. Sees only their own partnership, through the partner portal.',
       "dataScope" = 'OWN',
       permissions = array[]::text[],
       "isSystem" = true,
       active = true,
       "updatedAt" = now()
 where name = 'Partner';

update security_role
   set description = 'An external customer login. Sees only their own tickets, through the support portal.',
       "dataScope" = 'OWN',
       permissions = array[]::text[],
       "isSystem" = true,
       active = true,
       "updatedAt" = now()
 where name = 'Customer';

-- ---------------------------------------------------------------------------
-- Everyone else moves before their role goes
-- ---------------------------------------------------------------------------

-- Finance and Sales Manager ran things: they become Managers.
update app_user u
   set "roleId" = (select id from security_role where name = 'Manager'),
       "updatedAt" = now()
  from security_role r
 where r.id = u."roleId"
   and r.name in ('Finance', 'Sales Manager');

-- The individual-contributor roles become Consultant. None of them could
-- administer anything, and a Consultant is the closest fit; where that is
-- wrong, the person's role can be changed on their own page, or a new role
-- made in Settings.
update app_user u
   set "roleId" = (select id from security_role where name = 'Consultant'),
       "updatedAt" = now()
  from security_role r
 where r.id = u."roleId"
   and r.name in ('Sales Executive', 'Marketing Executive', 'SDR / Cold Caller', 'Content Editor');

delete from security_role
 where name in ('Finance', 'Sales Manager', 'Sales Executive', 'Marketing Executive', 'SDR / Cold Caller', 'Content Editor')
   and not exists (select 1 from app_user u where u."roleId" = security_role.id);

-- ---------------------------------------------------------------------------
-- Support department
-- ---------------------------------------------------------------------------
--
-- Portal tickets are assigned round-robin to the Support department. Without
-- one they fall back to the account's manager, which works but is not what was
-- asked for. The department is created empty: who belongs in it is a decision
-- for the people who run the team, made on each user's own page.
insert into department (id, name, active, "createdAt", "updatedAt")
select gen_random_uuid(), 'Support', true, now(), now()
where not exists (select 1 from department where lower(name) = 'support');
