// Temporary isolated graph; no existing staff assignments are edited.
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
config({ path: '.env', quiet: true });
const token = process.env.SUPABASE_ACCESS_TOKEN || readFileSync(0, 'utf8').trim();
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const [role, a, b] = [randomUUID(), randomUUID(), randomUUID()];
async function query(sql, allowError = false) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }),
  });
  const result = await response.json();
  if (!response.ok && !allowError) throw new Error(JSON.stringify(result));
  return { ok: response.ok, result };
}
try {
  await query(`insert into security_role(id,name,permissions,"dataScope","updatedAt") values('${role}','QA concurrency ${role}',array['project:read'],'OWN',now());
    insert into app_user(id,"fullName",email,"roleId",status,"updatedAt") values
    ('${a}','QA concurrency A','${a}@example.com','${role}','ACTIVE',now()),
    ('${b}','QA concurrency B','${b}@example.com','${role}','ACTIVE',now());`);
  for (const isolation of ['READ COMMITTED', 'REPEATABLE READ']) {
    await query(`update app_user set "managerUserId"=null where id in ('${a}','${b}');`);
    const first = query(`begin isolation level ${isolation}; update app_user set "managerUserId"='${b}' where id='${a}'; select pg_sleep(2); commit;`, true);
    const second = query(`begin isolation level ${isolation}; select count(*) from app_user where id='${b}'; select pg_sleep(0.5); update app_user set "managerUserId"='${a}' where id='${b}'; commit;`, true);
    const results = await Promise.all([first, second]);
    assert.equal(results.filter(r => r.ok).length, 1, `${isolation}: exactly one conflicting assignment must commit`);
    const rejected = results.find(r => !r.ok);
    assert.match(JSON.stringify(rejected.result), /cycle|serializ/i, 'Expected cycle or stale-snapshot rejection');
    const state = await query(`select count(*)::int as linked from app_user where id in ('${a}','${b}') and "managerUserId" is not null;`);
    assert.equal(state.result[0].linked, 1);
    console.log(`PASS ${isolation}: competing assignments cannot create a cycle`);
  }
} finally {
  await query(`begin; update app_user set "managerUserId"=null where id in ('${a}','${b}'); delete from app_user where id in ('${a}','${b}'); delete from security_role where id='${role}'; commit;`);
  const remaining = await query(`select count(*)::int as remaining from app_user where id in ('${a}','${b}');`);
  assert.equal(remaining.result[0].remaining, 0);
  console.log('PASS temporary graph cleanup');
}
