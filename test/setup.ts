import { config } from "dotenv";

// The scope tests talk to a real database, so they need the same DATABASE_URL
// the app uses. Next.js loads .env itself; vitest does not.
config({ path: ".env" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — tests need a database to run against.");
}
