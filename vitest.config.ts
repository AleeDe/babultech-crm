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
    testTimeout: 30_000,
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
