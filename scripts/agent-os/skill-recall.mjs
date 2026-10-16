#!/usr/bin/env node
/**
 * skill-recall: name the installed skills a prompt should invoke.
 *
 * UserPromptSubmit hook (stdin JSON with a `prompt` field) and a CLI for lane briefs:
 *   node scripts/agent-os/skill-recall.mjs --text "<prompt>"     one-line prompt
 *   node scripts/agent-os/skill-recall.mjs --file <path>         a brief or any text file
 *   add --json for the full ranking and the index counts
 *
 * Index: every SKILL.md under the repo roots (.claude/skills, apps/*\/.claude/skills, .agents/skills),
 * ~/.claude/skills and the plugin roots under ~/.claude/plugins (marketplaces, synced, cache when present).
 * Cached in the OS temp dir, keyed by the roots and their mtimes; never written inside the repo.
 *
 * Scoring is plain BM25 over name + description + triggers/when, with two documented boosts.
 * Output: at most MAX_LINES "[skill-recall] invoke: <name> (<matched words>)" lines, or the none line.
 *
 * Fail OPEN by design: any error prints one "[skill-recall] off: <reason>" line and exits 0.
 * Exit 2 blocks the prompt in Claude Code; this file has no path to it. Canary: skillRecall.test.mjs.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const MAX_LINES = 5;
// Hits on the skill NAME are the strongest routing signal a prompt carries ("prisma migration" -> statenour-migration).
const NAME_BOOST = 3;
// Repo skills fired 18x more than the library in the 2026-08-03 audit; a tie goes to the skill written for this repo.
const REPO_BOOST = 1.5;
// Floor, measured 2026-10-16 over 498 indexed skills: the weakest positive control ("merge the three ledger rows" ->
// stranded-branch-rescue) scores 8.5 and the library noise under it (body hits on "ledger" and "rows") 5.9 to 7.3;
// nonsense scores nothing. 7.5 keeps every control and cuts that noise. A lone generic word ("test") still prints its
// skills (9 and up): a one-word prompt naming a domain is a real request, not noise.
const FLOOR = 7.5;
// Forced by other hooks and the lane frontmatter already; printing them again would bury the real matches.
const ALWAYS_ON = new Set([
  "karpathy-guidelines", "ponytail", "verification-before-completion", "i-have-adhd", "using-superpowers",
  "antislop", "find-skill", "nour-command", "monorepo-manager", "harness-worktree-setup",
  "positive-control-first", "assert-the-consumer", "prior-art-grep",
]);
const SKIP_DIRS = new Set([".git", "node_modules", ".trash", ".staging"]);
const STOP = new Set(("a an and are as at be been before but by can do does for from has have how i if in into is it its " +
  "me my no not of on one or our so that the their them then there these they this to up us use used using was we " +
  "what when where which while who will with would you your please make fix get set run add new any all some " +
  "just like want need help also into over about after again").split(" "));
const K1 = 1.2;
const B = 0.75;

function repoRoot() {
  return resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

/** Skill roots in priority order: a name seen in an earlier root wins over the same name later. */
function skillRoots(root) {
  const home = homedir();
  const roots = [
    { kind: "repo", dir: join(root, ".claude", "skills") },
    { kind: "repo", dir: join(root, ".agents", "skills") },
  ];
  const apps = join(root, "apps");
  if (existsSync(apps)) {
    for (const e of readdirSync(apps, { withFileTypes: true })) {
      if (e.isDirectory()) roots.push({ kind: "repo", dir: join(apps, e.name, ".claude", "skills") });
    }
  }
  roots.push({ kind: "user", dir: join(home, ".claude", "skills") });
  for (const sub of ["marketplaces", "synced", "cache"]) roots.push({ kind: "plugin", dir: join(home, ".claude", "plugins", sub) });
  return roots.filter((r) => existsSync(r.dir));
}

/** Cache key: the root list plus each root's mtime and its direct children's mtimes (cheap, one readdir per root).
 * shortcut: an edit two levels down does not bump these, so a changed description is picked up only when a skill
 * dir is added, removed or renamed; upgrade to a full stat walk if descriptions start changing without renames. */
function cacheKey(roots) {
  const h = createHash("sha1");
  for (const r of roots) {
    h.update(`${r.kind}:${r.dir}:${statSync(r.dir).mtimeMs}\n`);
    for (const e of readdirSync(r.dir, { withFileTypes: true })) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      try { h.update(`${e.name}:${statSync(join(r.dir, e.name)).mtimeMs}\n`); } catch { /* vanished mid-walk */ }
    }
  }
  return h.digest("hex");
}

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      out[key] = kv[2].replace(/^["'>|-]+\s*|["']$/g, "");
    } else if (key && /^\s+/.test(line)) {
      out[key] += " " + line.trim().replace(/^-\s*/, "");
    }
  }
  return out;
}

function pluginName(dir) {
  try {
    const p = join(dir, ".claude-plugin", "plugin.json");
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")).name || null;
  } catch { /* a broken manifest just means no prefix */ }
  return null;
}

function walk(dir, kind, prefix, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  const names = new Set(entries.map((e) => e.name));
  if (names.has(".claude-plugin")) prefix = pluginName(dir) || prefix;
  if (names.has("SKILL.md")) {
    try {
      const fm = frontmatter(readFileSync(join(dir, "SKILL.md"), "utf8"));
      const bare = (fm.name || basename(dir)).trim();
      out.push({
        name: kind === "plugin" && prefix ? `${prefix}:${bare}` : bare,
        description: fm.description || "",
        triggers: [fm.triggers, fm.when].filter(Boolean).join(" "),
        kind,
        path: join(dir, "SKILL.md"),
      });
    } catch { /* unreadable file: skip it, the rest of the index still works */ }
  }
  for (const e of entries) {
    if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".bucket-")) walk(join(dir, e.name), kind, prefix, out);
  }
}

function tokens(text) {
  return String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

/** Light stemming: enough for migrate/migration/migrations and hook/hooks to meet, not a real stemmer. */
function stem(w) {
  if (w.length <= 4) return w;
  return w.replace(/(ations?|ings?|ies|ied|ers?|es|ed|e|s)$/, (m) => (m === "ies" || m === "ied" ? "i" : m.startsWith("ation") ? "at" : ""));
}

function buildIndex(roots) {
  const seen = new Set();
  const entries = [];
  for (const r of roots) {
    const found = [];
    walk(r.dir, r.kind, null, found);
    found.sort((a, b) => a.path.localeCompare(b.path));
    for (const s of found) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      entries.push({ ...s, nameTokens: tokens(s.name.replace(/[:-]/g, " ")), bodyTokens: tokens(`${s.description} ${s.triggers}`) });
    }
  }
  const df = {};
  for (const e of entries) for (const t of new Set([...e.nameTokens, ...e.bodyTokens])) df[t] = (df[t] || 0) + 1;
  const avgLen = entries.reduce((n, e) => n + e.nameTokens.length + e.bodyTokens.length, 0) / Math.max(1, entries.length);
  return { entries, df, avgLen };
}

function loadIndex(root) {
  const roots = skillRoots(root);
  const key = cacheKey(roots);
  const cacheDir = process.env.SKILL_RECALL_CACHE_DIR || join(tmpdir(), "skill-recall");
  const file = join(cacheDir, `index-${createHash("sha1").update(root).digest("hex").slice(0, 12)}.json`);
  try {
    const cached = JSON.parse(readFileSync(file, "utf8"));
    if (cached.key === key && Array.isArray(cached.entries)) return cached;
  } catch { /* missing or corrupt: rebuild below */ }
  const index = { key, ...buildIndex(roots) };
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, JSON.stringify(index));
  } catch { /* read-only temp: still answer from the fresh index */ }
  return index;
}

function score(index, prompt) {
  // Keep the first prompt word behind each stem so the output reads "migration", not "migrat".
  const word = new Map();
  for (const w of String(prompt).toLowerCase().split(/[^a-z0-9]+/)) if (w && !word.has(stem(w))) word.set(stem(w), w);
  const q = [...new Set(tokens(prompt))];
  const N = index.entries.length;
  const results = [];
  for (const e of index.entries) {
    if (ALWAYS_ON.has(e.name.split(":").pop())) continue;
    const len = e.nameTokens.length + e.bodyTokens.length;
    let s = 0;
    const hits = [];
    for (const t of q) {
      const inName = e.nameTokens.filter((x) => x === t).length;
      const inBody = e.bodyTokens.filter((x) => x === t).length;
      if (!inName && !inBody) continue;
      const df = index.df[t] || 1;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const tf = inBody + inName;
      // The name boost multiplies the saturated term, so it is a real 3x and not a tf bump BM25 flattens to 1.5x.
      s += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * len / index.avgLen)) * (inName ? NAME_BOOST : 1);
      hits.push(word.get(t) || t);
    }
    if (e.kind === "repo") s *= REPO_BOOST;
    if (s > 0) results.push({ name: e.name, kind: e.kind, score: Number(s.toFixed(3)), hits });
  }
  results.sort((a, b) => b.score - a.score || (b.kind === "repo") - (a.kind === "repo") || a.name.localeCompare(b.name));
  return results;
}

function readInput(argv) {
  const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  if (at("--text") !== undefined) return { prompt: at("--text"), json: argv.includes("--json") };
  if (at("--file") !== undefined) return { prompt: readFileSync(resolve(at("--file")), "utf8"), json: argv.includes("--json") };
  const raw = readFileSync(0, "utf8");
  const parsed = JSON.parse(raw);
  if (typeof parsed.prompt !== "string") throw new Error("stdin JSON has no prompt field");
  return { prompt: parsed.prompt, json: argv.includes("--json") };
}

function main() {
  const { prompt, json } = readInput(process.argv.slice(2));
  const index = loadIndex(repoRoot());
  const ranked = score(index, prompt);
  const picked = ranked.filter((r) => r.score >= FLOOR).slice(0, MAX_LINES);
  if (json) {
    const counts = { total: index.entries.length, repo: 0, user: 0, plugin: 0 };
    for (const e of index.entries) counts[e.kind] += 1;
    process.stdout.write(JSON.stringify({ index: counts, floor: FLOOR, picked, ranked: ranked.slice(0, 25) }, null, 2) + "\n");
    return;
  }
  const lines = picked.map((r) => `[skill-recall] invoke: ${r.name} (${r.hits.slice(0, 4).join(", ")})`);
  process.stdout.write((lines.length ? lines : ["[skill-recall] none beyond the always-on set"]).join("\n") + "\n");
}

try {
  main();
} catch (err) {
  process.stdout.write(`[skill-recall] off: ${String(err?.message || err).split(/\r?\n/)[0]}\n`);
}
process.exitCode = 0;
