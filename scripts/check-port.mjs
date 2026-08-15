/**
 * Guards against a port that "succeeds" by deleting code.
 *
 * Compares each server module against its committed version and fails if the
 * export list shrank or the file lost most of its bulk. A truncating edit
 * otherwise looks like a perfect result: zero Prisma references, zero type
 * errors, because there is no code left.
 *
 * Run: node scripts/check-port.mjs
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dir = "src/server";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));

let failed = false;

for (const file of files) {
  const p = path.join(dir, file);
  // git wants forward slashes even on Windows; path.join gives backslashes and
  // `git show` then fails, which would silently skip every file.
  const gitPath = `${dir}/${file}`;
  const current = fs.readFileSync(p, "utf8");

  let committed;
  try {
    committed = execSync(`git show HEAD:${gitPath}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    console.log(`  -- ${file.padEnd(24)} not in HEAD (new file), skipped`);
    continue;
  }

  const exportsOf = (s) => (s.match(/^export (async )?function (\w+)/gm) ?? []).map((m) => m.split(/\s+/).pop());

  const before = exportsOf(committed);
  const after = exportsOf(current);
  const missing = before.filter((e) => !after.includes(e));

  const shrank = current.length < committed.length * 0.5;
  const prisma = (current.match(/prisma\.|Prisma\./g) ?? []).length;

  const flags = [];
  if (missing.length) flags.push(`LOST EXPORTS: ${missing.join(", ")}`);
  if (shrank) flags.push(`SHRANK ${committed.length} -> ${current.length} chars`);

  if (flags.length) {
    failed = true;
    console.error(`  x ${file}: ${flags.join("; ")}`);
  } else {
    const state = prisma === 0 ? "ported" : `${prisma} prisma refs`;
    console.log(`  ok ${file.padEnd(24)} ${after.length} exports, ${state}`);
  }
}

if (failed) {
  console.error("\nPort check FAILED — a module lost code rather than being ported.\n");
  process.exit(1);
}
console.log("\nAll modules intact.\n");
