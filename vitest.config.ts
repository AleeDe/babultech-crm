import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    // Scope tests hit a real database and mutate team/department membership,
    // so they must not run concurrently against the same rows.
    fileParallelism: false,
    environment: "node",
    setupFiles: ["test/setup.ts"],
    include: ["test/**/*.test.ts"],
    // These legacy suites connect to .env and some rewrite actual staff rows.
    // Run only against a disposable database, with explicit opt-in.
    exclude: process.env.RUN_DATABASE_TESTS === "1" ? [] : [
      "test/auth-identity.test.ts", "test/authz-scope.test.ts",
      "test/hierarchical-scope.test.ts", "test/portal-boundary.test.ts",
    ],
    testTimeout: 30_000,
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
