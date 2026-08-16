#!/usr/bin/env bash
#
# Full cutover to Supabase. Run after DATABASE_URL / DIRECT_URL point at the
# cloud project in .env.
#
#   bash scripts/cutover-supabase.sh
#
# Stops at the first failure rather than leaving a half-migrated database.
set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

step "1/5 Preflight — validating connection strings"
node scripts/preflight-supabase.mjs

step "2/5 Schema — creating the 64 tables"
npx prisma db push

step "3/5 Seed — roles, users, partners, demo data"
npm run db:seed

step "4/5 RLS — applying scope helpers and 24 policies"
# psql is not required locally: pipe each file through Prisma's connection.
for f in prisma/rls/001_scope_helpers.sql \
         prisma/rls/002_policies_pilot.sql \
         prisma/rls/003_policies_rollout.sql; do
  echo "    - $f"
  node scripts/apply-sql.mjs "$f"
done

step "5/5 Acceptance gate — 20 characterization tests"
npm test

printf '\n\033[1;32mCutover complete.\033[0m Start the app with: npm run dev\n\n'
