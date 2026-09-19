import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
config({ path: '.env', quiet: true });
const base = process.argv[2] || 'http://localhost:3100';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Local targets only');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const run = randomUUID().slice(0, 8), now = () => new Date().toISOString();
const ids = { adminRole: randomUUID(), workerRole: randomUUID(), department: randomUUID(), project: randomUUID(), task: randomUUID(), admin: null, worker: null };
const email = `qa-created-${run}@example.com`, adminEmail = `qa-admin-${run}@example.com`, password = `Qa9${randomBytes(20).toString('hex')}`;
const output = 'artifacts/browser-qa';
await mkdir(output, { recursive: true });
const report = { passed: [], failed: null, errors: [], cleanup: [] };
let browser, page;
async function checked(query) { const r = await query; if (r.error) throw Error(r.error.message); return r.data; }
function pass(message) { report.passed.push(message); console.log(`PASS ${message}`); }
async function login(p, address) {
  await p.goto(`${base}/login`);
  await p.getByRole('button', { name: 'Show password', exact: true }).click();
  await p.getByRole('button', { name: 'Hide password', exact: true }).waitFor();
  await p.locator('[name=email]').fill(address);
  await p.locator('[name=password]').fill(password);
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await p.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 45000 });
}
try {
  await checked(db.from('security_role').insert([
    { id: ids.adminRole, name: `QA Admin ${run}`, permissions: ['*'], dataScope: 'ALL', updatedAt: now() },
    { id: ids.workerRole, name: `QA Contributor ${run}`, permissions: ['project:read', 'project:write'], dataScope: 'OWN', updatedAt: now() },
  ]));
  const auth = await checked(db.auth.admin.createUser({ email: adminEmail, password, email_confirm: true }));
  ids.admin = auth.user.id;
  await checked(db.from('app_user').insert({ id: ids.admin, email: adminEmail, fullName: `QA Admin ${run}`, roleId: ids.adminRole, status: 'ACTIVE', updatedAt: now() }));
  await checked(db.from('department').insert({ id: ids.department, name: `QA Delivery ${run}`, active: true, updatedAt: now() }));
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => report.errors.push(e.message));
  await login(page, adminEmail); pass('Administrator signs in');
  await page.goto(`${base}/users/new`);
  await page.getByRole('heading', { name: 'New user', exact: true }).waitFor();
  await page.getByRole('button').filter({ hasText: `QA Contributor ${run}` }).click();
  await page.locator('[name=email]').fill(email);
  await page.locator('[name=notificationEmail]').fill(`qa-notify-${run}@example.com`);
  await page.locator('[name=password]').fill(password);
  await page.locator('[name=fullName]').fill(`QA Created ${run}`);
  await page.locator('[name=jobTitle]').fill('Content writer');
  await page.locator('[name=departmentId]').selectOption(ids.department);
  await page.locator('[name=managerUserId]').selectOption(ids.admin);
  await page.screenshot({ path: `${output}/user-create-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'Create user', exact: true }).click();
  await page.waitForURL(/\/users\/[^/]+\/teams$/, { timeout: 45000 });
  const created = await checked(db.from('app_user').select('id,roleId,departmentId,managerUserId,notificationEmail,jobTitle').eq('email', email).single());
  ids.worker = created.id;
  await page.locator('[name=name]').fill(`QA Team ${run}`);
  await page.locator('[name=teamType]').selectOption('PROJECT');
  await page.getByRole('button', { name: 'Create team', exact: true }).click();
  const teamRow = page.locator('div.border-b').filter({ hasText: `QA Team ${run}` });
  await teamRow.getByRole('button', { name: 'Add', exact: true }).click();
  await teamRow.getByRole('button', { name: 'Remove', exact: true }).waitFor();
  const team = await checked(db.from('team').select('id').eq('name', `QA Team ${run}`).single());
  assert.equal((await checked(db.from('team_member').select('id').eq('teamId', team.id).eq('userId', ids.worker))).length, 1);
  pass('New-user onboarding creates a team and assigns one membership');
  await teamRow.getByRole('button', { name: 'Remove', exact: true }).click();
  await teamRow.getByRole('button', { name: 'Add', exact: true }).waitFor();
  assert.equal((await checked(db.from('team_member').select('id').eq('teamId', team.id).eq('userId', ids.worker))).length, 0);
  pass('Removing membership persists');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/user-teams-mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  pass('Team onboarding fits mobile viewport');
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(created.roleId, ids.workerRole); assert.equal(created.departmentId, ids.department); assert.equal(created.managerUserId, ids.admin);
  assert.equal(created.notificationEmail, `qa-notify-${run}@example.com`); assert.equal(created.jobTitle, 'Content writer');
  pass('UI-created user persists role, department, manager, title and notification email');
  await page.goto(`${base}/users/${ids.worker}/edit`);
  assert.equal(await page.locator('[name=departmentId]').inputValue(), ids.department);
  assert.equal(await page.locator('[name=managerUserId]').inputValue(), ids.admin);
  await page.locator('[name=notificationEmail]').fill('');
  await page.getByRole('button', { name: 'Save user', exact: true }).click();
  await page.waitForURL(`${base}/users`);
  assert.equal((await checked(db.from('app_user').select('notificationEmail').eq('id', ids.worker).single())).notificationEmail, null);
  pass('Edit form preserves assignments and clears notification override');
  const worker = await browser.newPage({ viewport: { width: 390, height: 844 } });
  worker.on('pageerror', e => report.errors.push(e.message));
  await login(worker, email); pass('Newly created user can actually sign in');
  for (const route of ['/users/new', `/users/${ids.worker}/teams`, '/resources/capacity']) {
    await worker.goto(`${base}${route}`);
    assert.equal(await worker.locator('[name=departmentId]').count(), 0);
    assert.equal(await worker.getByRole('heading', { name: 'Capacity planning', exact: true }).count(), 0);
    assert.equal(await worker.getByRole('heading', { name: 'Team membership', exact: true }).count(), 0);
  }
  pass('Contributor cannot open user administration or capacity management');
  await checked(db.from('project').insert({ id: ids.project, projectNumber: `QA-${run}`, name: `QA Capacity ${run}`, projectManagerId: ids.admin, projectType: 'INTERNAL', billingType: 'FIXED', status: 'PLANNING', updatedAt: now() }));
  await checked(db.from('project_task').insert({ id: ids.task, projectId: ids.project, name: `QA overdue ${run}`, assignedUserId: ids.worker, estimatedHours: 16, startDate: '2026-01-01', dueDate: '2026-01-02', updatedAt: now() }));
  await page.goto(`${base}/resources/capacity`);
  await page.getByRole('heading', { name: 'Capacity planning', exact: true }).waitFor();
  const summary = page.locator('summary').filter({ hasText: 'Overloaded days' });
  assert.ok(await summary.count() > 0); pass('Capacity renders overdue work and daily overload');
  await page.locator('[name=weeks]').selectOption('2');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.waitForURL(/weeks=2/); pass('Capacity period filter works');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/capacity-mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  pass('Capacity fits mobile viewport');
  await page.goto(`${base}/users/new`);
  await page.getByRole('heading', { name: 'New user', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/user-create-mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  pass('User form fits mobile viewport');
  assert.equal(report.errors.length, 0);
} catch (e) {
  report.failed = e.message; process.exitCode = 1; console.error(e.message);
  await page?.screenshot({ path: `${output}/users-capacity-failure.png`, fullPage: true }).catch(() => {});
} finally {
  await browser?.close();
  async function clean(label, query) { try { await checked(query); report.cleanup.push(`${label}: OK`); } catch(e) { report.cleanup.push(`${label}: ${e.message}`); process.exitCode = 1; } }
  if (!ids.worker) { const found = await db.from('app_user').select('id').eq('email', email).maybeSingle(); ids.worker = found.data?.id; }
  await clean('Task', db.from('project_task').delete().eq('id', ids.task));
  await clean('Project', db.from('project').delete().eq('id', ids.project));
  const teams = await db.from('team').select('id').eq('name', `QA Team ${run}`);
  for (const team of teams.data ?? []) {
    await clean('Team memberships', db.from('team_member').delete().eq('teamId', team.id));
    await clean('Team', db.from('team').delete().eq('id', team.id));
  }
  if (ids.worker) await clean('User audit', db.from('audit_history').delete().eq('entityType', 'User').eq('entityId', ids.worker));
  for (const id of [ids.worker, ids.admin].filter(Boolean)) {
    await clean('Profile', db.from('app_user').delete().eq('id', id));
    await clean('Auth', db.auth.admin.deleteUser(id));
  }
  await clean('Department', db.from('department').delete().eq('id', ids.department));
  await clean('Roles', db.from('security_role').delete().in('id', [ids.adminRole, ids.workerRole]));
  await writeFile(`${output}/users-capacity-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
