-- The case form's Source list (picklist case_source) gains the assistant, so a
-- case it raised keeps its source when someone edits it.
insert into picklist_value ("picklistKey", value, label, "sortOrder")
select 'case_source', 'CHATBOT', 'Portal assistant', coalesce(max("sortOrder"), 0) + 10
from picklist_value where "picklistKey" = 'case_source'
having not exists (select 1 from picklist_value where "picklistKey" = 'case_source' and value = 'CHATBOT');
