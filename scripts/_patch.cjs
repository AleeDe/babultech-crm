const fs=require("fs");const p="src/app/(app)/leads/[id]/edit/page.tsx";
let s=fs.readFileSync(p,"utf8");
const a='    industry: lead.industry,\n    leadSource: lead.leadSource,';
if(!s.includes(a)){console.error("MISS");process.exit(1);}
s=s.replace(a,[
'    industry: lead.industry,',
'    website: lead.website,',
'    businessType: lead.businessType,',
'    companySize: lead.companySize,',
'    street: lead.street,',
'    city: lead.city,',
'    state: lead.state,',
'    postalCode: lead.postalCode,',
'    country: lead.country,',
'    leadSource: lead.leadSource,',
].join("\n"));
fs.writeFileSync(p,s);console.log("edit defaults patched");
