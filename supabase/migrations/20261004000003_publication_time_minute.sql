-- Recording publication refused a time in the same minute as the last
-- approval. The publication time is entered to the minute, so a post published
-- moments after approval read as "before" it. Compare at minute precision.
CREATE OR REPLACE FUNCTION public.record_content_publication(p_id uuid, p_version uuid, p_url text, p_published timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v content_version%rowtype; t project_task%rowtype; p project_content_plan%rowtype; saved content_publication%rowtype; tid uuid; actor uuid:=app_current_user_id();
begin
 select "taskId" into tid from content_version where id=p_version;
 select * into t from project_task where id=tid for update;
 if t.id is null or not coalesce(app_project_access(t."projectId"),false) or not coalesce((app_project_access(t."projectId",true) or t."assignedUserId"=actor),false) then raise exception 'Assigned publisher or project manager required' using errcode='42501'; end if;
 select * into saved from content_publication where id=p_id;
 if found then
 if saved."versionId"=p_version and saved."liveUrl"=trim(p_url) and saved."publishedAt"=p_published and saved."recordedById"=actor then return saved.id; end if;
 raise exception 'Request conflict' using errcode='23505'; end if;
 select * into v from content_version where id=p_version;
 select * into p from project_content_plan where "taskId"=tid;
 if t.status='CANCELLED' or p.revision is distinct from v."planRevision" or exists(select 1 from content_version where "taskId"=tid and "versionNumber">v."versionNumber")
 or not exists(select 1 from content_review where "versionId"=v.id and stage='INTERNAL' and decision='APPROVED')
 or (p."clientApprovalRequired" and not exists(select 1 from content_review where "versionId"=v.id and stage='CLIENT' and decision='APPROVED')) then raise exception 'Current version and required approvals needed' using errcode='22023'; end if;
 if p_id is null or p_url is null or trim(p_url) !~ '^https?://[^[:space:]/?#]+[^[:space:]]*$' or length(p_url)>2048 or p_published is null or not isfinite(p_published) or p_published>clock_timestamp()
 or p_published<date_trunc('minute',(select max("createdAt") from content_review where "versionId"=v.id and decision='APPROVED')) then
 raise exception 'Live HTTP(S) URL and actual publication time after recorded approvals required' using errcode='22023'; end if;
 insert into content_publication(id,"versionId","liveUrl","publishedAt","recordedById") values(p_id,v.id,trim(p_url),p_published,actor);
 return p_id;
end $function$;
