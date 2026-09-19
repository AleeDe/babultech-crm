create function public.app_content_review_access(p_project uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(app_project_access(p_project,true) or
   (app_has_permission('content:review') and app_project_access(p_project,false)),false);
$$;
revoke all on function public.app_content_review_access(uuid) from public,anon;
grant execute on function public.app_content_review_access(uuid) to authenticated;

-- Only INTERNAL review gains the narrower capability. All existing version,
-- self-review, project isolation and client-review requirements remain intact.
do $$ declare body text; needle text := 'not coalesce(app_project_access(t."projectId",true),false)'; begin
 select pg_get_functiondef('public.review_content_version(uuid,uuid,text,text,text,text)'::regprocedure) into body;
 if position(needle in body)=0 then raise exception 'Review function changed; inspect before migrating'; end if;
 body:=replace(body,needle,'not coalesce((app_project_access(t."projectId",true) or (p_stage=''INTERNAL'' and app_content_review_access(t."projectId"))),false)');
 execute body;
end $$;

-- Add presets without changing existing roles or assigning any staff.
insert into security_role(id,name,description,permissions,"dataScope",active,"updatedAt")
select gen_random_uuid(),v.name,v.description,v.permissions,'OWN',true,now()
from (values
 ('SDR / Cold Caller','Own leads, calling and qualification/handoff. Campaign tools currently share lead permissions.',array['lead:read','lead:write']),
 ('Marketing Executive','Own campaigns and leads. Campaign tools currently share lead permissions; no finance or commercial approval grants.',array['lead:read','lead:write']),
 ('Content Editor','Internal content review on assigned projects. No project management, rates or client approval authority.',array['project:read','content:review'])
) v(name,description,permissions)
where not exists(select 1 from security_role r where lower(r.name)=lower(v.name));
