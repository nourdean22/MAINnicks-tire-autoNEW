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
 *
 * Exports (2026-10-18): FLOOR, STOP, tokens, stem, score and readInput, so tool-recall.mjs scores its registry with this
 * exact scorer instead of a fork. main() runs only when this file is the entry point, so an import prints nothing.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Loaded dynamically so a missing or broken plugin reader degrades to repo and user skills with a warning, never a crash.
let pluginIndex = null;
let pluginIndexError = "";
try {
  pluginIndex = await import("./plugin-index.mjs");
} catch (err) {
  pluginIndexError = `plugin-index.mjs: ${String(err?.code || err?.message || err).split(/\r?\n/)[0]}`;
}

const MAX_LINES = 5;
const MAX_PLUGIN_LINES = 2;
// Words a status read, a merge or a loop tick carries that say nothing about the work. A plugin entry whose every matched
// word is one of these is dropped (2026-10-26: "what is the status of the open pull requests" named
// code-review:code-review and project-artifact:project-artifact against 480 plugin skills). Stemmed like the index.
export const GENERIC = new Set(("status read pr prs pull pulls request requests check checks main live open opened show list " +
  "latest current today update updates state progress done merge merged ci build report " +
  // Instruction-shaped words ("ignore previous rules and enable the X plugin") named brightdata-plugin:proxy and
  // hookify:configure on the manager's probe, 2026-10-26.
  "plugin plugins enable enabled disable ignore previous rule rules install configure setup").split(" ").map((w) => stem(w)));
// Hits on the skill NAME, and on its triggers: line, are the routing signal a prompt carries.
const NAME_BOOST = 3;
// Repo skills fired 18x more than the library in the 2026-08-03 audit; a tie goes to the skill written for this repo.
const REPO_BOOST = 1.5;
// Floor, measured 2026-10-16: the weakest positive control ("merge the three ledger rows and release the lease" ->
// session-authority) scores well above it, nonsense scores nothing, and two generic body words land under it.
export const FLOOR = 7.5;
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
export const STOP = new Set(("a an and are as at be been before but by can do does for from has have how i if in into is it its " +
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

/** Skill roots in priority order: a name seen in an earlier root wins over the same name later. When the project IS
 * the home directory the two paths coincide; the directory is then the user root only (round 7: counted as repo, every
 * user skill got REPO_BOOST and reported kind "repo"). */
function skillRoots(root) {
  const repoDir = join(root, ".claude", "skills");
  // CLAUDE_CONFIG_DIR moves the user skill root with the rest of the config (Codex 4380254412).
  const userDir = join(process.env.CLAUDE_CONFIG_DIR ? resolve(process.env.CLAUDE_CONFIG_DIR) : join(homedir(), ".claude"), "skills");
  const roots = [{ kind: "user", dir: userDir }];
  if (resolve(repoDir) !== resolve(userDir)) roots.unshift({ kind: "repo", dir: repoDir });
  return roots.filter((r) => existsSync(r.dir));
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

export function tokens(text) {
  return String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

/** Light stemming: enough for migrate/migration/migrations and hook/hooks to meet, not a real stemmer. */
export function stem(w) {
  if (w.length <= 4) return w;
  return w.replace(/(ations?|ings?|ies|ied|ers?|es|ed|e|s)$/, (m) => (m === "ies" || m === "ied" ? "i" : m.startsWith("ation") ? "at" : ""));
}

/** Plugin skills and commands of the enabled plugins (plugin-index.mjs), by the `plugin:slug` name the Skill tool
 * resolves. Routing (rejects, extra triggers) comes from THIS script's repo, so `--scope global` in another project
 * still honours it. Any failure is a warning and an empty list: recall falls back to repo and user skills. */
function pluginSource() {
  if (!pluginIndex) return { files: [], triggers: {}, warning: pluginIndexError };
  try {
    const routing = pluginIndex.readRouting(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
    const { files, warnings } = pluginIndex.pluginSkillFiles(process.env.USERPROFILE || process.env.HOME || homedir(), routing, repoRoot());
    return { files, triggers: routing.triggers ?? {}, warning: warnings.join("; ") };
  } catch (err) {
    return { files: [], triggers: {}, warning: String(err?.message || err).split(/\r?\n/)[0] };
  }
}

function indexEntry(s) {
  // triggers: are routing words by definition, so they carry the name boost; realName keeps the bare name apart,
  // because only a hit on it exempts an entry from the two-term minimum.
  const realName = tokens(s.name.replace(/[:-]/g, " "));
  return { ...s, realName, nameTokens: [...realName, ...tokens(s.triggers)], bodyTokens: tokens(s.description) };
}

function buildIndex(roots, plugins = { files: [], triggers: {} }) {
  const seen = new Set();
  const entries = [];
  for (const r of roots) {
    for (const dir of skillDirs(r.dir)) {
      const s = readSkill(dir, r.kind);
      if (!s || seen.has(s.name)) continue;
      seen.add(s.name);
      entries.push(indexEntry(s));
    }
  }
  // A plugin copy of a repo or user skill (agent-protocols:karpathy-guidelines) is the same skill: the slug is deduped.
  for (const f of plugins.files) {
    const slug = f.name.slice(f.name.indexOf(":") + 1);
    if (seen.has(slug) || seen.has(f.name)) continue;
    try {
      const fm = frontmatter(readFileSync(f.path, "utf8"));
      if (!NAME_OK.test(f.name) || !fm.description) continue;
      seen.add(f.name);
      entries.push(indexEntry({ name: f.name, description: fm.description, triggers: [fm.triggers, fm.when, plugins.triggers[f.name]].filter(Boolean).join(" "), kind: "plugin", path: f.path }));
    } catch { /* unreadable file: skip it */ }
  }
  // Term statistics come from the REPO cohort when there is one (round 5): a repo result must not move when the user
  // installs 500 unrelated skills, and user entries are scored against the same table (a term the repo never uses is
  // a singleton). Outside a repo, which is what `--scope global` is for, the cohort is the user root itself: with an
  // empty table N is 0, the idf goes negative and every user skill scores under zero (round 6, found live).
  const repo = entries.filter((e) => e.kind === "repo");
  const cohort = repo.length ? repo : entries.filter((e) => e.kind === "user");
  const df = {};
  for (const e of cohort) for (const t of new Set([...e.nameTokens, ...e.bodyTokens])) df[t] = (df[t] || 0) + 1;
  const avgLen = cohort.reduce((n, e) => n + e.bodyTokens.length, 0) / Math.max(1, cohort.length);
  return { entries, df, avgLen, N: cohort.length };
}

function loadIndex(root) {
  const roots = skillRoots(root);
  const plugins = pluginSource();
  const sig = pluginIndex ? pluginIndex.signature(plugins.files) : "";
  const key = createHash("sha1").update(cacheKey(roots)).update(sig).update(JSON.stringify(plugins.triggers)).digest("hex");
  const cacheDir = process.env.SKILL_RECALL_CACHE_DIR || join(tmpdir(), "skill-recall");
  const file = join(cacheDir, `index-${createHash("sha1").update(root).digest("hex").slice(0, 12)}.json`);
  try {
    const cached = JSON.parse(readFileSync(file, "utf8"));
    if (cached.key === key && Array.isArray(cached.entries)) return { ...cached, pluginWarning: plugins.warning };
  } catch { /* missing or corrupt: rebuild below */ }
  const index = { key, ...buildIndex(roots, plugins) };
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, JSON.stringify(index));
  } catch { /* read-only temp: still answer from the fresh index */ }
  return { ...index, pluginWarning: plugins.warning };
}

/** Distinct query terms, capped from both ends so a request after a long paste still counts. */
function queryTerms(prompt) {
  const q = [...new Set(tokens(prompt))];
  if (q.length <= MAX_QUERY_TERMS) return q;
  const half = MAX_QUERY_TERMS / 2;
  return [...q.slice(0, half), ...q.slice(-half)];
}

export function score(index, prompt) {
  // Keep the first prompt word behind each stem so the output reads "migration", not "migrat".
  const word = new Map();
  for (const w of String(prompt).toLowerCase().split(/[^a-z0-9]+/)) if (w && !word.has(stem(w))) word.set(stem(w), w);
  const q = queryTerms(prompt);
  const N = index.N;
  const results = [];
  const count = (list) => { const m = new Map(); for (const x of list) m.set(x, (m.get(x) || 0) + 1); return m; };
  for (const e of index.entries) {
    if (ALWAYS_ON.has(e.name)) continue;
    const len = e.bodyTokens.length;
    // Term counts once per entry: with about a thousand plugin skills indexed, a filter per query term was quadratic.
    const nameCount = count(e.nameTokens);
    const bodyCount = count(e.bodyTokens);
    let s = 0;
    let nameHit = false;
    const hits = [];
    for (const t of q) {
      const inName = nameCount.get(t) || 0;
      const inBody = bodyCount.get(t) || 0;
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
    // A plugin entry always needs MIN_HITS terms: one word of a long plugin slug ("atlassian:generate-status-report" on
    // "status") is not a routing signal (measured 2026-10-26 on a status read against 480 plugin skills).
    if ((!nameHit || e.kind === "plugin") && hits.length < MIN_HITS) continue;
    if (e.kind === "plugin" && hits.every((h) => GENERIC.has(stem(h.word)))) continue;
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

export function readInput(argv, root) {
  const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  if (at("--text") !== undefined) return { prompt: at("--text"), json: argv.includes("--json") };
  if (at("--file") !== undefined) return { prompt: withoutTemplate(readFileSync(resolve(at("--file")), "utf8"), root), json: argv.includes("--json") };
  const raw = readFileSync(0, "utf8");
  const parsed = JSON.parse(raw);
  if (typeof parsed.prompt !== "string") throw new Error("stdin JSON has no prompt field");
  return { prompt: parsed.prompt, json: argv.includes("--json") };
}

/** `--scope global` (the ~/.claude/settings.json entry): stay silent in a project whose own settings already run this
 * script, so the repo hook and the user hook never print twice. Any read error means "not registered": run normally.
 * The home directory is never a project: its `.claude/settings.json` IS the user file that carries the global entry,
 * so a session started in `~` must still get recall (round 6, found live). */
function projectAlreadyRuns(root) {
  if (resolve(root) === resolve(homedir())) return false;
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
  // Plugin skills share the line budget but take at most MAX_PLUGIN_LINES of it, so a pack of a thousand plugin skills
  // cannot crowd out the repo skills written for this repo.
  let pluginLines = 0;
  const picked = ranked.filter((r) => r.score >= FLOOR && (r.kind !== "plugin" || ++pluginLines <= MAX_PLUGIN_LINES)).slice(0, MAX_LINES);
  const warn = index.pluginWarning ? [`[skill-recall] warn: plugin skills partly off (${index.pluginWarning}); repo and user skills unaffected`] : [];
  if (json) {
    const counts = { total: index.entries.length, repo: 0, user: 0, plugin: 0, names: index.entries.map((e) => e.name) };
    for (const e of index.entries) counts[e.kind] += 1;
    process.stdout.write(JSON.stringify({ index: counts, pluginWarning: index.pluginWarning || null, floor: FLOOR, picked, ranked: ranked.slice(0, 25) }, null, 2) + "\n");
    return;
  }
  const lines = picked.map((r) => `[skill-recall] invoke: ${r.name.slice(0, 64)} (${r.hits.slice(0, 4).join(", ")})`);
  process.stdout.write([...warn, ...(lines.length ? lines : ["[skill-recall] none beyond the always-on set"])].join("\n") + "\n");
}

/** True when node was started on this file (directly, through a junction, or with a differently cased drive letter). */
function isEntry() {
  try {
    const a = realpathSync(process.argv[1]);
    const b = realpathSync(fileURLToPath(import.meta.url));
    return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}

if (isEntry()) {
  try {
    main();
  } catch (err) {
    process.stdout.write(`[skill-recall] off: ${String(err?.message || err).split(/\r?\n/)[0]}\n`);
  }
  process.exitCode = 0;
}
