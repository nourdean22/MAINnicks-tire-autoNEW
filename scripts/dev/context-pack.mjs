import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error("usage: node scripts/dev/context-pack.mjs <query>");
  process.exit(2);
}

function run(command, args) {
  const out = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { status: out.status, stdout: String(out.stdout || "").trim() };
}

const commit = run("git", ["rev-parse", "HEAD"]).stdout;
const tree = run("git", ["show", "-s", "--format=%T", "HEAD"]).stdout;
if (!commit || !tree) throw new Error("unable to resolve git source state");

const terms = query.split(/\s+/).filter(Boolean).slice(0, 8);

const fileSet = new Set();
for (const term of terms) {
  const found = run("rg", [
    "-l", "-F", "--hidden",
    "--glob", "!.git/**",
    "--glob", "!node_modules/**",
    "--glob", "!.worktrees/**",
    "--glob", "!.claude/worktrees/**",
    term, ".",
  ]);
  if (found.status !== 0) continue;
  for (const file of found.stdout.split(/\r?\n/).filter(Boolean)) {
    fileSet.add(file);
    if (fileSet.size >= 40) break;
  }
  if (fileSet.size >= 40) break;
}

const files = [...fileSet].slice(0, 40);
const entries = files.map((file) => {
  const matches = terms.map((term) =>
    run("rg", ["-n", "-m", "3", "-F", term, file]).stdout
  ).filter(Boolean).join("\n");

  const history = run("git", ["log", "-5", "--format=%h %ad %s",
    "--date=short", "--", file]).stdout;
  return { file: file.replace(/^\.\\?/, ""), matches, history };
});

const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "").slice(0, 48) || "query";
const payload = {
  generator: "scripts/dev/context-pack.mjs@1",
  generatedAt: new Date().toISOString(),
  sourceCommit: commit,
  sourceTree: tree,
  query,
  terms,
  fileCount: entries.length,
  truncated: fileSet.size >= 40,
  entries,
};

const dir = resolve(root, ".agent-cache", tree);
mkdirSync(dir, { recursive: true });
const output = resolve(dir, `${slug}.json`);
writeFileSync(output, JSON.stringify(payload, null, 2) + "\n");
console.log(output);
console.log(`CONTEXT_FILES=${entries.length}`);
