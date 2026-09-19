select r.name,r."dataScope",r.permissions,r.active,
(select count(*) from app_user u where u."roleId"=r.id and u."deletedAt" is null) as assigned_users
from security_role r where r.name in ('SDR / Cold Caller','Marketing Executive','Content Editor') order by r.name;
