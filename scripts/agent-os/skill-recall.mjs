#!/usr/bin/env node
/**
 * skill-recall: name the installed skills a prompt should invoke.
 *
 * UserPromptSubmit hook (stdin JSON with a `prompt` field) and a CLI for lane briefs:
 *   node scripts/agent-os/skill-recall.mjs --text "<prompt>"     one-line prompt
 *   node scripts/agent-os/skill-recall.mjs --file <path>         a brief or any text file (template boilerplate dropped)
 *   add --json for the full ranking and the index counts
 *   --scope global: the ~/.claude/settings.json entry; silent in a project whose own settings run this script
 *
 * Index: the flat `<root>/<slug>/SKILL.md` files under the two roots the Skill tool provably resolves,
 * `<project>/.claude/skills` and `~/.claude/skills` (review round 3b, 2026-10-16: the plugin trees on disk cannot be
 * told apart from catalog copies, and names indexed from them were failed Skill calls for the reader; round 5: a
 * SKILL.md nested deeper, a draft or a reference, is not loadable either). Cached in the OS temp dir, keyed by the
 * roots, their mtimes and this script's own source; never written inside the repo.
 *
 * Scoring is plain BM25 over description, with name and `triggers:` tokens boosted, a floor and a two-term minimum.
 * Output: at most MAX_LINES "[skill-recall] invoke: <name> (<matched words>)" lines, or the none line.
 *
 * Fail OPEN by design: any error prints one "[skill-recall] off: <reason>" line and exits 0.
 * Exit 2 blocks the prompt in Claude Code; this file has no path to it. Canary: skillRecall.test.mjs.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_LINES = 5;
// Hits on the skill NAME, and on its triggers: line, are the routing signal a prompt carries.
const NAME_BOOST = 3;
// Repo skills fired 18x more than the library in the 2026-08-03 audit; a tie goes to the skill written for this repo.
const REPO_BOOST = 1.5;
// Floor, measured 2026-10-16: the weakest positive control ("merge the three ledger rows and release the lease" ->
// session-authority) scores well above it, nonsense scores nothing, and two generic body words land under it.
const FLOOR = 7.5;
// The whole rule for both roots, review rounds 1 to 4 (2026-10-16): the floor, plus every entry needs a hit on a REAL
// name token or at least MIN_HITS matched terms, because one generic word inside a trigger phrase ("home screen",
// "expired row", "debt ledger") carries the name boost and printed a repo skill on its own. A higher bar for the user
// root was measured against the real binary in round 4 and removed: it dropped only true matches (receiving-code-review
// on "the feedback is unclear", pptx on "slides for the deck") and no noise, once the plugin roots were gone.
const MIN_HITS = 2;
// A prompt is at most this many distinct terms, taken from both ends: a 547 KB pasted report took 7 s against a 10 s
// hook timeout, and the request usually sits at the end of a paste (round 5), so the head alone would lose it.
const MAX_QUERY_TERMS = 2000;
// Exactly the names other hooks and the lane frontmatter force every turn. Anything scoped to a kind of work
// (monorepo-manager, antislop, harness-worktree-setup, positive-control-first...) must be able to score (round 5).
const ALWAYS_ON = new Set([
  "using-superpowers", "ponytail", "karpathy-guidelines", "i-have-adhd", "verification-before-completion",
  "nour-command", "find-skill",
]);
// A skill name is what the Skill tool accepts; anything else on disk is skipped so the output never prints junk.
const NAME_OK = /^[a-z0-9][\w:.-]{0,63}$/i;
const SKIP_DIRS = new Set([".git", "node_modules", ".trash", ".staging", "_archive"]);
const STOP = new Set(("a an and are as at be been before but by can do does for from has have how i if in into is it its " +
  "me my no not of on one or our so that the their them then there these they this to up us use used using was we " +
  "what when where which while who why will with would you your please make fix get set run any all some " +
  "just like want need help also over about after again should").split(" "));
const K1 = 1.2;
const B = 0.75;
const TEMPLATE = ".agents/core/templates/subagent-brief.md";
// Bump when the shape of an index entry changes (the script hash below catches code changes; this is for a cache
// written by a script whose text happens to be identical, which cannot happen, so it is documentation as much as key).
const INDEX_VERSION = 4;

function repoRoot() {
  return resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

/** Skill roots in priority order: a name seen in an earlier root wins over the same name later. */
function skillRoots(root) {
  return [
    { kind: "repo", dir: join(root, ".claude", "skills") },
    { kind: "user", dir: join(homedir(), ".claude", "skills") },
  ].filter((r) => existsSync(r.dir));
}

/** The flat `<root>/<slug>` skill directories: what Claude Code loads (forge.mjs enforces the same layout). */
function skillDirs(rootDir) {
  return readdirSync(rootDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
    .map((e) => join(rootDir, e.name))
    .filter((d) => existsSync(join(d, "SKILL.md")))
    .sort();
}

/** Cache key: this script's own source, the root list, each root's mtime, each skill dir's mtime and its SKILL.md
 * mtime (sessions edit those in place, which bumps no directory; review round 2 hit exactly that). */
function cacheKey(roots) {
  const h = createHash("sha1");
  h.update(`v${INDEX_VERSION}\n`);
  h.update(readFileSync(fileURLToPath(import.meta.url)));
  for (const r of roots) {
    h.update(`${r.kind}:${r.dir}:${statSync(r.dir).mtimeMs}\n`);
    for (const d of skillDirs(r.dir)) {
      try { h.update(`${d}:${statSync(d).mtimeMs}:${statSync(join(d, "SKILL.md")).mtimeMs}\n`); } catch { /* vanished mid-walk */ }
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

function readSkill(dir, kind) {
  try {
    const fm = frontmatter(readFileSync(join(dir, "SKILL.md"), "utf8"));
    const name = (fm.name || dir.split(/[\\/]/).pop()).trim();
    if (!NAME_OK.test(name)) return null;
    return { name, description: fm.description || "", triggers: [fm.triggers, fm.when].filter(Boolean).join(" "), kind, path: join(dir, "SKILL.md") };
  } catch {
    return null; // unreadable file: skip it, the rest of the index still works
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
    for (const dir of skillDirs(r.dir)) {
      const s = readSkill(dir, r.kind);
      if (!s || seen.has(s.name)) continue;
      seen.add(s.name);
      // triggers: are routing words by definition, so they carry the name boost; realName keeps the bare name apart,
      // because only a hit on it exempts an entry from the two-term minimum.
      const realName = tokens(s.name.replace(/[:-]/g, " "));
      entries.push({ ...s, realName, nameTokens: [...realName, ...tokens(s.triggers)], bodyTokens: tokens(s.description) });
    }
  }
  // Term statistics come from the REPO cohort alone (round 5): a repo result must not move when the user installs
  // 500 unrelated skills. User entries are scored against the same table; a term the repo never uses is a singleton.
  const repo = entries.filter((e) => e.kind === "repo");
  const df = {};
  for (const e of repo) for (const t of new Set([...e.nameTokens, ...e.bodyTokens])) df[t] = (df[t] || 0) + 1;
  const avgLen = repo.reduce((n, e) => n + e.bodyTokens.length, 0) / Math.max(1, repo.length);
  return { entries, df, avgLen, N: repo.length };
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

/** Distinct query terms, capped from both ends so a request after a long paste still counts. */
function queryTerms(prompt) {
  const q = [...new Set(tokens(prompt))];
  if (q.length <= MAX_QUERY_TERMS) return q;
  const half = MAX_QUERY_TERMS / 2;
  return [...q.slice(0, half), ...q.slice(-half)];
}

function score(index, prompt) {
  // Keep the first prompt word behind each stem so the output reads "migration", not "migrat".
  const word = new Map();
  for (const w of String(prompt).toLowerCase().split(/[^a-z0-9]+/)) if (w && !word.has(stem(w))) word.set(stem(w), w);
  const q = queryTerms(prompt);
  const N = index.N;
  const results = [];
  for (const e of index.entries) {
    if (ALWAYS_ON.has(e.name)) continue;
    const len = e.bodyTokens.length;
    let s = 0;
    let nameHit = false;
    const hits = [];
    for (const t of q) {
      const inName = e.nameTokens.filter((x) => x === t).length;
      const inBody = e.bodyTokens.filter((x) => x === t).length;
      if (!inName && !inBody) continue;
      if (e.realName.includes(t)) nameHit = true;
      const df = index.df[t] || 1;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      // Body hits: BM25 with length normalization. Name and trigger hits: saturated but NOT length-normalized, so a
      // skill with fourteen triggers is not penalized for having them, times the name boost (a real 3x: the boost
      // multiplies the saturated term instead of bumping tf, which BM25 would flatten to about 1.5x).
      let w = 0;
      if (inBody) w += idf * (inBody * (K1 + 1)) / (inBody + K1 * (1 - B + B * len / index.avgLen));
      if (inName) w += idf * (inName * (K1 + 1)) / (inName + K1) * NAME_BOOST;
      s += w;
      hits.push({ word: word.get(t) || t, w });
    }
    if (!nameHit && hits.length < MIN_HITS) continue;
    if (e.kind === "repo") s *= REPO_BOOST;
    // Printed hits are the heaviest terms first, so a brief's real subject shows before its filler words.
    hits.sort((a, b) => b.w - a.w);
    if (s > 0) results.push({ name: e.name, kind: e.kind, score: Number(s.toFixed(3)), hits: hits.map((h) => h.word) });
  }
  results.sort((a, b) => b.score - a.score || (b.kind === "repo") - (a.kind === "repo") || a.name.localeCompare(b.name));
  return results;
}

/** A lane brief is mostly the template; every line that appears verbatim in the template says nothing about the task. */
function withoutTemplate(text, root) {
  let template;
  try { template = readFileSync(join(root, TEMPLATE), "utf8"); } catch { return text; }
  const boiler = new Set(template.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 12));
  return text.split(/\r?\n/).filter((l) => !boiler.has(l.trim())).join("\n");
}

function readInput(argv, root) {
  const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  if (at("--text") !== undefined) return { prompt: at("--text"), json: argv.includes("--json") };
  if (at("--file") !== undefined) return { prompt: withoutTemplate(readFileSync(resolve(at("--file")), "utf8"), root), json: argv.includes("--json") };
  const raw = readFileSync(0, "utf8");
  const parsed = JSON.parse(raw);
  if (typeof parsed.prompt !== "string") throw new Error("stdin JSON has no prompt field");
  return { prompt: parsed.prompt, json: argv.includes("--json") };
}

/** `--scope global` (the ~/.claude/settings.json entry): stay silent in a project whose own settings already run this
 * script, so the repo hook and the user hook never print twice. Any read error means "not registered": run normally. */
function projectAlreadyRuns(root) {
  try {
    const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
    return (settings.hooks?.UserPromptSubmit ?? []).some((g) => (g.hooks ?? []).some((h) => String(h.command || "").includes("skill-recall.mjs")));
  } catch {
    return false;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const root = repoRoot();
  const scope = argv.indexOf("--scope");
  if (scope >= 0 && argv[scope + 1] === "global" && projectAlreadyRuns(root)) return;
  const { prompt, json } = readInput(argv, root);
  const index = loadIndex(root);
  const ranked = score(index, prompt);
  const picked = ranked.filter((r) => r.score >= FLOOR).slice(0, MAX_LINES);
  if (json) {
    const counts = { total: index.entries.length, repo: 0, user: 0, names: index.entries.map((e) => e.name) };
    for (const e of index.entries) counts[e.kind] += 1;
    process.stdout.write(JSON.stringify({ index: counts, floor: FLOOR, picked, ranked: ranked.slice(0, 25) }, null, 2) + "\n");
    return;
  }
  const lines = picked.map((r) => `[skill-recall] invoke: ${r.name.slice(0, 64)} (${r.hits.slice(0, 4).join(", ")})`);
  process.stdout.write((lines.length ? lines : ["[skill-recall] none beyond the always-on set"]).join("\n") + "\n");
}

try {
  main();
} catch (err) {
  process.stdout.write(`[skill-recall] off: ${String(err?.message || err).split(/\r?\n/)[0]}\n`);
}
process.exitCode = 0;
