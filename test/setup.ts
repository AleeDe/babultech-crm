import { config } from "dotenv";

// Next.js loads .env itself; vitest does not.
config({ path: ".env" });

// The tests reach the database through supabase-js, not a Postgres connection
// string — DATABASE_URL was a Prisma-era requirement and checking for it here
// blocked the whole suite on a variable nothing reads.
const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length) {
  throw new Error(
    `${missing.join(" and ")} must be set — the tests run against a real project. ` +
      "Copy them from Supabase Dashboard > Project Settings > API.",
  );
}
