-- Run within a rollback transaction / migration verification savepoint.
do $$
declare r uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); rejected boolean;
begin
 insert into security_role(id,name,permissions,"dataScope","updatedAt") values(r,'QA graph '||r,array['project:read'],'OWN',now());
 insert into app_user(id,"fullName",email,"roleId",status,"updatedAt") values
 (a,'QA graph A',a||'@example.com',r,'ACTIVE',now()),
 (b,'QA graph B',b||'@example.com',r,'ACTIVE',now()),
 (c,'QA graph C',c||'@example.com',r,'ACTIVE',now());
 update app_user set "managerUserId"=a where id=b;
 update app_user set "managerUserId"=b where id=c;
 rejected:=false;
 begin update app_user set "managerUserId"=c where id=a; exception when check_violation then rejected:=true; end;
 if not rejected then raise exception 'Three-person cycle accepted'; end if;
 rejected:=false;
 begin update app_user set "managerUserId"=a where id=a; exception when check_violation then rejected:=true; end;
 if not rejected then raise exception 'Self-reporting accepted'; end if;
 update app_user set "managerUserId"=null where id in (a,b,c);
 rejected:=false;
 begin update app_user set "managerUserId"=case when id=a then b else a end where id in (a,b); exception when check_violation then rejected:=true; end;
 if not rejected then raise exception 'Multi-row cycle accepted'; end if;
 if exists(select 1 from app_user where id in(a,b) and "managerUserId" is not null) then raise exception 'Rejected statement partially applied'; end if;
 update app_user set status='INACTIVE' where id=b;
 rejected:=false;
 begin update app_user set "managerUserId"=b where id=a; exception when check_violation then rejected:=true; end;
 if not rejected then raise exception 'Inactive manager accepted'; end if;
 update app_user set "fullName"='QA unrelated update allowed' where id=a;
end $$;
select 'Reporting graph checks passed' as result;
