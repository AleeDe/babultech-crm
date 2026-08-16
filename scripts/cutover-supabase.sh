#!/usr/bin/env bash
#
# Full cutover to Supabase. Run once the project is linked:
#
#   npx supabase link --project-ref <ref>
#   bash scripts/cutover-supabase.sh
#
# Stops at the first failure rather than leaving a half-migrated database.
set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

step "1/4 Schema and policies — applying every migration"
# supabase/migrations/ is the source of truth now: tables, functions, RLS
# helpers and policies all live there in order. Prisma is gone, and so is the
# separate prisma/rls/ pass that used to follow the schema push.
npx supabase db push --linked

step "2/4 Identity — roles, department, users, sequences, currency"
npm run db:seed

step "3/4 Auth — mirroring app_user into auth.users"
# RLS resolves identity through auth.uid(), so a profile with no matching
# auth user can sign in and then see nothing.
node scripts/migrate-auth-users.mjs

step "4/4 Demo data — the CRM records the screens are built around"
npm run db:seed:demo

printf '\n\033[1;32mCutover complete.\033[0m Start the app with: npm run dev\n'
printf 'Sign in with admin@babultech.com — see scripts/seed-cloud.mjs for the password.\n\n'
