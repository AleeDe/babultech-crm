# Supabase Platform Migration

Status: **planning — step 0 in progress.** Nothing in `src/` has been changed yet.

Target: move from local Postgres + Prisma + NextAuth to the Supabase platform —
Supabase Postgres, Supabase Auth, `supabase-js`, and RLS-enforced row security.

## Why this is staged

The migration replaces the authorization model, not just the database. Today
row security lives in `src/lib/authz.ts` and is enforced in application code.
Under RLS it moves into the database. Both are valid designs; the risk is
entirely in the handover between them, because a scoping mistake does not
throw — the app keeps working and quietly returns rows the user should not see.

Each step below ends at a point where the app runs and is verifiable.

## What the audit found

Two facts that shape the work, established by reading the code rather than
assumed:

**1. Internal scoping is uniform, not per-model.** `scopedContext()` is called
in exactly four places, always with `"ownerUserId"`:

- `src/server/crm.ts:106`
- `src/server/crm.ts:600`
- `src/server/opportunities.ts:308`
- `src/server/opportunities.ts:373`

So OWN / TEAM / DEPARTMENT / ALL is one repeated pattern over a single column,
not 64 bespoke rules. The RLS surface is far smaller than a model count suggests.

**2. There is a second, independent access path.** The partner portal
(`src/server/portal.ts`) gates on `user.partnerId` and never goes through
`scopeFilter`. Per the schema comment on `User.partnerId`, the presence of that
column is what makes a user *external*.

RLS therefore needs **two policy families**:

| Family   | Applies to             | Rule                                               |
| -------- | ---------------------- | -------------------------------------------------- |
| Internal | `partnerId IS NULL`    | `dataScope` over `ownerUserId` (OWN/TEAM/DEPT/ALL) |
| External | `partnerId IS NOT NULL`| rows reachable from that one partner only          |

**The dangerous failure is an external user falling through to an internal
policy.** That is the first thing the tests must rule out.

## The stale-claims decision

`authz.ts` loads `dataScope`, `teamIds`, and `departmentId` from the database on
every request, so a team change takes effect immediately. RLS can get those
values two ways:

- **JWT claims baked at login** — fast, but *stale*. Someone moved between teams
  keeps their old access until the token refreshes (session `maxAge` is 8h).
- **`SECURITY DEFINER` helper functions** re-querying per check — always correct,
  costs a lookup per row-check.

Recommendation: **helper functions**, with the membership lookups indexed. Silent
staleness in an access-control path is a worse failure than a query cost, and
today's behavior is already "immediate", so claims would be a *regression* in
security semantics that nobody would notice.

This is a real decision, not a detail — it needs an explicit sign-off before
step 3.

## Steps

### Step 0 — characterization tests (no credentials needed) — IN PROGRESS

No test framework is installed. Before changing an authorization model, pin
current behavior:

- a sales exec (`OWN`) cannot read another rep's records
- a sales manager (`TEAM`) sees teammates, not the whole company
- an admin (`ALL`) sees everything
- a portal user reaches only their own partner's rows
- a portal user is refused by every internal entry point

These tests must pass identically before and after the migration. They are the
contract.

### Step 1 — database only — ✅ DONE (local Supabase)

Completed against the **local Supabase stack** (`supabase start`), not cloud.
The stack is real Supabase — Postgres, Auth, PostgREST, Studio — so this is a
genuine step 1, and the cloud move later is a connection-string change only.

```
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

Local Supabase does not run pgbouncer by default (`supabase_pooler` is
stopped), so both point at 54322. On cloud they diverge to 6543/5432 — see
`.env.example`.

Verified:

- `prisma db push` — 64 tables created
- `npm run db:seed` — roles, users, partners, demo data
- `npm test` — **20/20 pass**, so scoping is unchanged by the move
- login end-to-end — `POST /api/auth/callback/credentials` → 302, `/` → 200,
  session resolves to the seeded Administrator

Studio: http://127.0.0.1:54323 · Mailpit: http://127.0.0.1:54324

Previous `.env` saved as `.env.backup-preSupabase`. The old Docker container
`babultech-crm-db` was displaced from port 5432 when the Supabase stack
started; its data volume `babultech-crm-pgdata` still exists and was not
deleted.

### Step 1 (cloud) — ✅ DONE, no database password needed

Cloud project **BabulTechCRM** (`ocuiticodkbcnutrftub`), region **Oceania
(Sydney)** — note `aws-0-ap-southeast-2`, not the `ap-south-1` assumed earlier.

**The password turned out not to be required.** `supabase db push --linked`
authenticates with the access token, so schema and RLS can be pushed without
`DATABASE_URL`. `supabase-js` then works from the anon/service keys alone.
Prisma still needs the password — which is exactly why removing Prisma (step 4)
also removes the last thing blocking cloud.

Live on cloud now:

- **64 tables** — `supabase/migrations/20260815000000_init_crm.sql`, generated
  with `prisma migrate diff` and combined with the RLS/function scripts
- **24 RLS policies + 9 functions**
- **Seed data** — 4 roles, 4 users, department, team, 19 number sequences,
  2 currencies, via `scripts/seed-cloud.mjs` (supabase-js, no Prisma)

RLS verified in production:

| client                  | `app_user` rows |
| ----------------------- | --------------- |
| anon (RLS applies)      | **0**           |
| service role (bypasses) | 4               |

#### `011_db_defaults.sql` — a systemic issue found here

Prisma fills `@default(...)` and `@updatedAt` **in the client**, so the
generated SQL leaves those columns NOT NULL with no DEFAULT. Fine while Prisma
is the only writer; fatal through PostgREST, which fails with
`null value in column "..." violates not-null constraint`.

The schema has **~265** such declarations, so this had to be fixed in the
database rather than per call site: the migration adds `gen_random_uuid()`,
`now()` and boolean defaults, plus a `set_updated_at` trigger on all 65 tables
carrying `updatedAt` (Prisma's `@updatedAt` also advanced on UPDATE, which a
column default alone does not reproduce).

**Every remaining supabase-js write depends on this.** Without it the 173 call
sites would each need explicit `id`/`updatedAt`/boolean values.

#### Schema assumptions the seed disproved

Caught by running it, not by reading:

- `Department.name` and `Team.name` are **not unique** — `upsert` has no index
  to conflict on, so those use an insert-if-absent helper instead.
- `Team` has `teamType` (required) and `managerUserId` — **no** `departmentId`.
- `Currency` is keyed on `code` (`@id`) and has **no `id` column**.

### Step 1 (cloud) — original notes

Cloud project **`ocuiticodkbcnutrftub`** exists and is reachable
(`/rest/v1/` and `/auth/v1/health` both answer 401, i.e. up and requiring a key).

The CLI is *not* logged in, and that does not block anything — but note it also
cannot help with the missing piece. `supabase link` takes `--password` as an
*input*; there is no command that retrieves a database password. It is shown
once at project creation and is otherwise only resettable, never readable.

**You provide** (Dashboard > Project Settings > Database > Connection string):

```
DATABASE_URL="postgresql://postgres.ocuiticodkbcnutrftub:[PW]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.ocuiticodkbcnutrftub:[PW]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
```

(Region shown as `ap-south-1` / Mumbai — adjust if the project was created
elsewhere. The dashboard string is authoritative.)

**Then run:**

```sh
bash scripts/cutover-supabase.sh
```

which does, stopping at the first failure:

1. `scripts/preflight-supabase.mjs` — validates both strings and connects to
   each before anything is created
2. `prisma db push` — 64 tables
3. `npm run db:seed`
4. `scripts/apply-sql.mjs` × 3 — helpers + 24 RLS policies
5. `npm test` — the 20-test acceptance gate

Both scripts were tested before being relied on:

- The preflight was fed a deliberately **swapped** 6543/5432 pair and correctly
  rejected all four faults. A preflight that never fails is worthless.
- `apply-sql.mjs` originally used Prisma's `$executeRawUnsafe` and **failed** —
  Prisma sends one prepared statement, which cannot carry multi-statement
  scripts or the dollar-quoted `$$ ... $$` function bodies. Rewritten on the
  `pg` driver, which sends a simple-query batch like psql. Verified: all three
  files apply, 24 policies created.

### Step 1 (cloud) — original notes

Everything on this side is prepared. `prisma/schema.prisma` now declares
`directUrl`, and `.env.example` documents both connection strings.

**What you must do (cannot be automated):** create the project at
https://supabase.com/dashboard. The database password is displayed **once, at
creation, and is not recoverable from any API token** — including a `sbp_`
personal access token, which is a management-API credential and not a database
one. If lost, reset it under Database > Database password.

Then set in `.env`:

```
DATABASE_URL="postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:5432/postgres"
```

Port 6543 is the transaction-mode pooler, correct for the app's many
short-lived server-action connections. Port 5432 is session mode, required
because migrations cannot run through a transaction pooler. Getting these
backwards produces confusing intermittent failures rather than a clean error.

**Then the cutover is:**

```sh
npx prisma db push     # create the 64 tables on Supabase
npm run db:seed        # roles, users, demo data
npm test               # all 20 must still pass
npm run dev            # smoke-test /login
```

The characterization tests are the acceptance gate. If they pass against
Supabase, scoping behaviour is unchanged by the move.

### Step 1 (original notes) — database only

Point `DATABASE_URL` at Supabase, `prisma db push`, seed, verify. Prisma,
NextAuth and `authz.ts` all unchanged. Checkpoint: app runs on Supabase Postgres
with local Docker no longer required.

### Step 2 — Supabase Auth — DATABASE SIDE DONE, APP SIDE PENDING

Model chosen: **Supabase Auth owns identity, `app_user` is the profile**, both
sharing the same id. Every existing FK (`ownerUserId`, `createdById`,
`partnerId`, …) keeps working untouched.

Done:

- `scripts/migrate-auth-users.mjs` — moved all 4 users into `auth.users`,
  passing `id` explicitly so `auth.users.id === app_user.id`. Verified: all four
  MATCH. The script refuses to continue if it ever finds a divergence, because a
  mismatch would silently point every FK at the wrong person.
- `012_auth_uid.sql` — `app_current_user_id()` now reads `auth.uid()` first and
  falls back to the `app.user_id` session variable. That fallback is deliberate:
  the characterization tests and server-side tooling connect directly to
  Postgres with no JWT.

Verified against cloud with real logins:

| user                        | uid resolves | scope | internal |
| --------------------------- | ------------ | ----- | -------- |
| admin@babultech.com         | matches      | ALL   | true     |
| sales.exec@babultech.com    | matches      | OWN   | true     |
| anon (no session)           | —            | —     | 0 rows   |

This removes a whole class of bug: identity now comes from the verified JWT, so
a forgotten `set_config()` can no longer silently widen or blank a user's
visibility.

Note `security_role` returns 0 rows to clients — it has no SELECT policy, which
is correct. The helpers read it via `SECURITY DEFINER`, so scoping still
resolves; only direct client reads are denied.

#### Still pending on the app side

- `src/lib/auth.ts`, `src/app/login/page.tsx`,
  `src/app/api/auth/[...nextauth]/route.ts` still use NextAuth
- `middleware.ts` still checks the `authjs.session-token` cookie
- `requireUser()` in `authz.ts` still resolves the session via NextAuth + Prisma

### Step 2 (original notes) — Supabase Auth

Replace the NextAuth credentials provider; map `User` to `auth.users`; rework
`middleware.ts` (note its current comment: it is a cookie-presence gate only,
because bcrypt cannot run on Edge — that constraint changes under Supabase Auth).
Prisma and `authz.ts` still unchanged. Step 0 tests must still pass.

### Step 3 — authz to RLS, incrementally — POLICIES DRAFTED AND PROVEN

SQL lives in `prisma/rls/`:

- `001_scope_helpers.sql` — `app_current_user_id()`, `app_current_scope()`,
  `app_current_partner_id()`, `app_visible_owner_ids()`, `app_is_internal()`
- `002_policies_pilot.sql` — pilot policies on `opportunity`,
  `commission_record`, `account`

These were applied to a throwaway clone (`rls_probe`) of the real seeded
database and queried as a **non-superuser** role, since `postgres` bypasses RLS
and would make any policy look like it works. Results:

| Query as               | opportunity | commission_record | account |
| ---------------------- | ----------- | ----------------- | ------- |
| admin (ALL)            | 3 of 3      | 2 of 2            | 3       |
| sales exec (OWN)       | 2 of 3      | —                 | —       |
| sales manager (TEAM)   | 3 of 3      | —                 | —       |
| portal user, partner A | 2 (linked)  | 1 — `COM-2026-00001` | **0** |
| portal user, partner B | 2 (linked)  | 1 — `PROBE-B-1`   | **0**  |
| no `app.user_id` set   | **0**       | —                 | —       |
| unknown user id        | **0**       | —                 | —       |

The partner rows were checked **by identity, not count** — A sees only its own
commission number and B only its own. Equal counts would have hidden a swapped
policy.

Deny-by-default holds: an unconfigured connection sees nothing, so a code path
that forgets to set `app.user_id` fails closed rather than open.

Note the seed had to be supplemented — partner B has no commission record, so
an isolation test against stock seed data passes vacuously. Same gap as in
`test/portal-boundary.test.ts`.

**How the application must set identity.** Every request must run its queries in
a transaction that first does:

```sql
SELECT set_config('app.user_id', $1, true);
```

The `true` makes it transaction-local, so a pooled connection cannot leak
identity into the next request. This is the single most important integration
detail, and it is why step 4 (Prisma → supabase-js) should come after: Supabase
Auth sets this automatically from the JWT, whereas Prisma needs it wired by hand.

#### Full rollout — all 16 tables proven (SELECT)

`003_policies_rollout.sql` extends the pilot to every scoped table: 24 policies
across 16 tables. Applied to a clone of the Supabase database and queried as a
**non-superuser** over TCP.

**A real bug was found and fixed here.** The first rollout attempt failed with:

```
ERROR: infinite recursion detected in policy for relation "opportunity"
```

`opportunity`'s external policy read `opportunity_partner`, whose own policy
read `opportunity` — a cycle. The pilot had passed only because
`opportunity_partner` had no RLS yet; adding it closed the loop. Fixed with two
`SECURITY DEFINER` helpers (`app_partner_opportunity_ids()`,
`app_internal_visible_opportunity_ids()`) that resolve the id sets without
re-entering the policies.

This is the class of failure the staged approach exists to catch: it would have
taken the whole partner portal down in production, and no amount of reading the
SQL would have revealed it.

Verified after the fix:

| table                 | admin | exec | portal A | portal B | unset |
| --------------------- | ----- | ---- | -------- | -------- | ----- |
| opportunity           | 3     | 2    | 2        | 2        | **0** |
| account               | 3     | 1    | **0**    | **0**    | **0** |
| lead                  | 1     | 1    | **0**    | **0**    | **0** |
| campaign              | 1     | 0    | **0**    | **0**    | **0** |
| partner               | 2     | 2    | 1        | 1        | **0** |
| commission_record     | 1     | 1    | 1        | 1        | **0** |
| opportunity_partner   | 4     | 3    | 2        | 2        | **0** |
| commission_payout     | 1     | 1    | —        | —        | **0** |
| app_user              | 4     | 4    | 1        | 1        | **0** |

Commission rows were checked **by identity**: portal A sees only
`COM-2026-00001`, portal B only `PROBE-B-1`.

Also confirmed: enabling RLS on `app_user` does **not** break the helper
functions that read it, because they are `SECURITY DEFINER`. Without that they
would recurse and every user would see zero rows.

#### Gap found: constraints and views were missing from cloud

`prisma migrate diff` generates tables, indexes and enums — it does **not**
carry `prisma/sql/`, which holds integrity rules Prisma's schema language
cannot express (`01_constraints.sql`) and four reporting views
(`02_views.sql`). Both were silently absent from the cloud database.

This was nearly missed: querying `v_campaign_performance` through PostgREST
returned *empty* rather than an error, which looks identical to "no data yet".
Only a schema dump showed 0 views and 0 CHECK constraints.

Now applied as `20260815000005_constraints.sql` and `20260815000006_views.sql`.
Verified functionally, not just by presence: inserting a `COMPANY` partner with
no `accountId` is now **rejected**, which is the rule that makes
"partner as contact only" safe.

#### Still to do in step 3

- Policies for `INSERT` / `UPDATE` / `DELETE` — only `SELECT` is written so far.
- The remaining 8 `ownerUserId` tables: `activity`, `campaign`, `contract`,
  `lead`, `milestone`, `project_issue`, `project_phase`, `project_risk`,
  `support_case`.
- The remaining 4 `partnerId` tables: `commission_payout`,
  `opportunity_partner`, `partner_contact`, plus `app_user` itself.
- Sign-off on helper-functions-vs-JWT-claims (above).

### Step 3 (original notes) — authz to RLS, incrementally

Not all 64 models at once. Start with three representative tables — one
`OWN`-scoped, one `TEAM`-scoped, one partner-portal-scoped — and get the step 0
tests passing against RLS with the application filter *removed*. Only then roll
the pattern outward.

Run both enforcement layers simultaneously during transition: RLS on, app filter
still in place. Belt and braces, and a disagreement between them is a bug signal.

### Step 4 — Prisma removal — IN PROGRESS

Goal restated: remove Prisma entirely, use Supabase cloud. Measured scope:

- **31** files import `@/lib/prisma`
- **173** Prisma call sites (100 `findMany`, 24 `findUnique`, 15
  `findUniqueOrThrow`, plus writes/aggregates)
- **52** `prisma.$transaction` blocks

**The blocking constraint: `supabase-js` has no transaction API.** It speaks to
PostgREST over HTTP, one request per call. The 52 transactions are money
operations — commission calculation, clawbacks, payout batching. A straight port
would turn a clawback into three independent HTTP calls with no atomicity: fail
between them and the ledger double-counts, silently.

Decision: **each multi-step operation becomes a Postgres function called via
`.rpc()`.** Reads and single-row writes go to `supabase-js` directly.

#### Done

- `src/lib/supabase.ts` — three clients, deliberately separated:
  `supabaseServer()` (acts as the user, **RLS applies** — the default),
  `supabaseAdmin()` (service role, **RLS bypassed**, never for user-driven
  work), `supabaseAnon()` (pre-auth).
- `009_fn_numbering.sql` — `next_sequence_number()`, ported from
  `src/lib/numbering.ts`. Needed first: the TS version only works inside a
  Prisma transaction alongside the insert it numbers.
- `010_fn_clawback.sql` — `claw_back_commission()`, the reference port of the
  hardest case (`commission-engine.ts` `clawback()`).

Verified against a clone of real data:

| check                                | result |
| ------------------------------------ | ------ |
| reversal created, amount negated     | `-226000.00`, `reversesRecordId` set |
| original marked CLAWED_BACK          | yes |
| audit row written                    | `status: PAYABLE → CLAWED_BACK` |
| double clawback refused              | "already been clawed back" |
| unknown record refused               | "not found" |
| failed call leaves no partial rows   | count unchanged |

Two corrections caught while porting: the sequence key is `'CommissionRecord'`
(the `NumberSequence.entityType` value), not `'COMMISSION'`; and the original
relied on transaction isolation for its status check, so the function takes an
explicit `FOR UPDATE` lock to stop two concurrent clawbacks both passing.

#### A latent bug in `create_record`, found while porting billing

The first `create_record` built its row with:

```sql
insert into <t> select * from json_populate_record(null::<t>, $1)
```

`json_populate_record` expands to **every** column, so keys absent from the
payload became explicit NULLs — and an explicit NULL overrides a column
DEFAULT. The database defaults added in `011`/`019` therefore never applied,
and any insert omitting a NOT NULL defaulted column failed.

It surfaced on `invoice."discountAmount"`, but it affected **every**
`createRecord` call in the port. `020_fn_create_record_v2.sql` names only the
columns present in the payload, so omitted ones fall through to their defaults
— which is exactly what Prisma's client-side defaults did.

Verified after the fix: invoice + 2 lines created in order, and
`discountAmount`/`writeOffAmount`/`paidAmount` all defaulted to `0.00`.
Re-checked `create_record` and `update_record` for regressions — both fine.

`019_numeric_defaults.sql` covers the numeric half that `011` missed: Prisma
declares 43 Int/Decimal fields with `@default`, all client-side. Columns that
are genuine business input (`invoice_line.unitPrice`, `opportunity.amount`) are
deliberately left without defaults — silently defaulting those to 0 would let
an empty value through as a real number.

#### Remaining

- 51 further transaction ports (billing, projects, partners, opportunities, crm)
- 173 call-site rewrites to `supabase-js`
- Step 2 (Supabase Auth) — still NextAuth; `auth.ts` and `authz.ts` both read
  `app_user` via Prisma
- Delete `src/lib/prisma.ts`, drop `@prisma/client`/`prisma`, retire
  `schema.prisma` (keep it as the schema of record until migrations are moved)

**These 20 characterization tests are Prisma-based by design** — they are the
before/after contract. They get ported last, once the app no longer uses Prisma.

### Step 4 (original notes) — Prisma to supabase-js

Last, once the security model is proven. 31 files import `@/lib/prisma`. This is
the largest mechanical change but the least dangerous, because by this point the
database is enforcing security regardless of what the client sends.

## Credentials

Needed in `.env` (gitignored, untracked — verified):

```
DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres"
NEXT_PUBLIC_SUPABASE_URL="https://[ref].supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="[anon key]"
SUPABASE_SERVICE_ROLE_KEY="[service role key]"
```

A `sbp_...` personal access token is **not** one of these — that is a
management-API token for the Supabase CLI/API, not a database connection, and it
is account-scoped. Do not put one in `.env` and do not paste one into a chat.
