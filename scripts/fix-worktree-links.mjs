// One-shot worktree repair (2026-09-01): the primary checkout's app trees are gutted,
// so every node_modules junction this worktree inherited dangles. Remove the
// junctions (reparse points only -- never their targets) so a filtered
// `pnpm install --frozen-lockfile` can create real, independent directories, and
// restore the app .env from the last surviving worktree copy.
//
// Safe by construction: fs.rmdirSync on a Windows junction removes the link, not
// the target; we assert lstat().isSymbolicLink() before removing anything, and we
// never recurse into a node_modules directory.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const removed = [];
const skipped = [];

function walk(dir, depth) {
  if (depth > 8) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === ".git") continue;
    const full = path.join(dir, e.name);
    if (e.name === "node_modules") {
      let st;
      try { st = fs.lstatSync(full); } catch { continue; }
      if (st.isSymbolicLink()) {
        try { fs.rmdirSync(full); removed.push(path.relative(root, full)); }
        catch (err) { skipped.push(`${path.relative(root, full)}: ${err.message}`); }
      } else {
        skipped.push(`${path.relative(root, full)}: real directory, untouched`);
      }
      continue; // never descend into node_modules
    }
    if (e.isDirectory() && !e.isSymbolicLink()) walk(full, depth + 1);
  }
}

walk(root, 0);

const envSrc = path.resolve(root, "..", "dua-merge", "apps", "nickstire", ".env");
const envDst = path.resolve(root, "apps", "nickstire", ".env");
let envResult = "not restored";
if (fs.existsSync(envSrc) && !fs.existsSync(envDst)) {
  fs.copyFileSync(envSrc, envDst);
  envResult = `restored from ${path.relative(root, envSrc)} (${fs.statSync(envDst).size} bytes)`;
} else if (fs.existsSync(envDst)) {
  envResult = "already present";
}

console.log(`removed junctions (${removed.length}):`);
for (const r of removed) console.log("  -", r);
console.log(`skipped (${skipped.length}):`);
for (const s of skipped) console.log("  -", s);
console.log("app env:", envResult);
