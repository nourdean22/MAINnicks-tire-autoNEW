#!/usr/bin/env node
/**
 * skill-forge tooling (2026-10-15): the repo gates around the official skill-creator. Zero dependencies.
 *
 *   node forge.mjs check <skill dir> [--git] [--existing]
 *                                               conventions + evidence; exit 1 lists every problem. --git also proves the baseline was
 *                                               committed before SKILL.md and not edited after it (run on the branch: a squash erases the order).
 *                                               --existing is for tuning a skill that predates this tool: it waives only the "Use when" start, and with --git it orders
 *                                               the baseline against the first commit on this branch that changes SKILL.md (a branch that does not touch it passes).
 *   node forge.mjs mine --keywords a,b [--skills s1,s2] [--adjacent s3,s4] [--days 60] [--limit 60] [--root <projects dir>]
 *                                               candidate trigger queries from your own session transcripts, redacted, to stdout only:
 *                                               sibling = the turn fired a skill like yours (a likely positive), adjacent = it fired a
 *                                               neighbour you must NOT collide with (a real near-miss negative), keyword = it mentions the topic
 *   node forge.mjs split <skill dir> [--write]  assigns the held-out flag by hash (of the origin id for mined rows, of the text for written ones)
 *   node forge.mjs verify-origins <skill dir> [--days 400] [--root <projects dir>]
 *                                               confirms every tx: id resolves to a real prompt in YOUR transcripts (cannot run in CI)
 *   node forge.mjs score <skill dir> [--set heldout|train|all] [--model haiku] [--runs 1] [--workers 3] [--out file]
 *                                               trigger score on the real routing, with a positive control; a crashed run is VOID, never a miss
 *   node forge.mjs prove <skill dir> [--model haiku]   starts a FRESH `claude -p` session and records whether the Skill tool
 *                                               loads the skill by its exact name (evals/invocation.json, bound to the description's hash)
 *
 * Why each exists is in references/gates.md. This repo is public: nothing mined from a transcript may be committed raw.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

// The official quick_validate.py list, plus the keys Claude Code itself reads that the official validator would reject.
// "triggers" is the repo's routing line: scripts/agent-os/skill-recall.mjs scores it like the name (2026-10-16).
const ALLOWED_KEYS = new Set(["name", "description", "license", "allowed-tools", "metadata", "compatibility", "argument-hint", "disable-model-invocation", "user-invocable", "triggers"]);
const MIN_QUERIES = 12;
const TX = /^tx:[0-9a-f]{8}$/;
// fire_audit.py's notion of "has a routing trigger": position 0 is style, a trigger anywhere is what routes.
const TRIGGER = /\buse\s+(when|whenever|this|these|it|before|after|at\b|as\b|for\b|during|on\b)|\byou\s+must\s+use\b|\bapply\s+(when|whenever|before|after)\b/i;
const sha = (alg, s) => createHash(alg).update(s).digest("hex");
// A fence may sit behind `> ` or a list marker (`- `, `* `, `1. `); the closing fence carries the same kind of prefix.
const PREFIX = "(?:>[ \\t]*|[-*+][ \\t]+|\\d+[.)][ \\t]+)*";
const FENCE = new RegExp(`^[ \\t]*${PREFIX}(\`{3,}|~{3,})[^\\n]*\\n[\\s\\S]*?^[ \\t]*${PREFIX}\\1[\`~]*[ \\t]*\\r?$`, "gm");

/**
 * Shapes that must not be committed in a trigger query: the repo is public and transcripts hold real names, numbers and paths.
 * A name cannot be detected; read every query. Order matters for redact(): an email goes before the domain inside it.
 */
const PII = [
  ["email", /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ["obfuscated email", /\b[\w.-]+\s+(?:at|\[at\])\s+[\w-]+\s+(?:dot|\[dot\])\s+\w+/i],
  ["url", /https?:\/\/\S+/],
  // Windows drive and UNC paths, ~/..., and ANY POSIX path of two or more segments (a lone /health is a route, not a path). A path starts where the
  // previous character is not a word character, dot, hyphen or @: `/opt/x/y`, =/opt/x/y, [/opt/x/y], file:/opt/x/y and file:///opt/x/y are paths;
  // and/or/maybe, 2026/10/15 and a/b/c are not (a slash inside them follows a word character).
  ["absolute path", /(?:[A-Za-z]:[\\/]|\\\\|(?<![\w.@-])(?:~\/|\/[\w.@-]+(?:\/[\w.@-]+)+))\S*/],
  ["ssn", /\b\d{3}-\d{2}-\d{4}\b/],
  ["phone number", /(?<![\w.])\+?\d{0,2}[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w])/],
  ["ip address", /\b\d{1,3}(?:\.\d{1,3}){3}\b/],
  ["vin", /\b(?=[A-HJ-NPR-Z0-9]*\d)[A-HJ-NPR-Z0-9]{17}\b/],
  ["domain", /\b[a-z0-9-]+\.(?:org|com|net|io|info|app|dev|us)\b(?:\/\S*)?/i],
  ["street address", /\b\d{2,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:Ave|Avenue|St|Street|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Way)\b/],
  ["token", /\b(?:(?:sk|pk|rk|ghp|gho|xox[bp])[-_][A-Za-z0-9_-]{10,}|(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,})\b/],
];

/** Replace PII with placeholders and collapse whitespace. */
export function redact(text) {
  let t = text.replace(/\s+/g, " ").trim();
  for (const [kind, re] of PII) t = t.replace(new RegExp(re.source, "g" + re.flags.replace("g", "")), `[${kind}]`);
  return t.slice(0, 300);
}

/**
 * Stable held-out assignment (about 40%). A mined row is assigned by its origin id, so re-wording a real prompt cannot move it;
 * a written row by its text, so it can be moved only by changing its words, in view of the reviewer, who sees it is "written".
 */
export const heldOut = (query, origin) => parseInt(sha("sha256", TX.test(origin ?? "") ? origin : query.trim().toLowerCase()).slice(0, 2), 16) % 10 < 4;
export const originId = (redacted) => `tx:${sha("sha1", redacted.toLowerCase()).slice(0, 8)}`;

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const out = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv && !/^\s/.test(line)) {
      key = kv[1];
      out[key] = kv[2].replace(/^[>|]-?$/, "").trim();
    } else if (key && line.trim()) out[key] = `${out[key]} ${line.trim()}`.trim();
  }
  for (const k of Object.keys(out)) out[k] = out[k].replace(/^(["'])([\s\S]*)\1$/, "$2");
  return out;
}

/** Things a real YAML parser rejects that parseFrontmatter reads happily: a duplicate key, or a plain description with ": " or " #" in it. */
function yamlProblems(text) {
  const body = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  const out = [];
  const seen = new Set();
  for (const line of body.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    if (seen.has(kv[1])) out.push(`frontmatter key "${kv[1]}" appears twice: a YAML parser rejects the file`);
    seen.add(kv[1]);
    if (kv[1] === "description" && kv[2] && !/^["'>|]/.test(kv[2]) && /: | #/.test(kv[2])) out.push('the description is an unquoted YAML scalar containing ": " or " #", which a YAML parser rejects: wrap it in double quotes');
  }
  return out;
}

const gitOut = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8", env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))) });
const listFiles = (dir, rel = "") => (existsSync(join(dir, rel)) ? readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(dir, `${rel}${e.name}/`) : [`${rel}${e.name}`])) : []);
const descriptionOf = (dir) => parseFrontmatter(readFileSync(join(dir, "SKILL.md"), "utf8"))?.description ?? "";
export const descriptionHash = (desc) => sha("sha256", desc.trim());

/** Every way the skill at `dir` breaks the repo's conventions or lacks its evidence. One string each. */
export function checkSkill(dir, { git = false, existing = false } = {}) {
  const errors = [];
  dir = resolve(dir);
  const name = basename(dir);
  const skillsRoot = dirname(dir);
  if (basename(skillsRoot) !== "skills" || basename(dirname(skillsRoot)) !== ".claude") errors.push(`layout: ${dir} must be .claude/skills/<slug>/ (the only place Claude Code loads a skill from; deeper never loads)`);
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) return [...errors, "SKILL.md is missing"];
  const text = readFileSync(file, "utf8");
  const fm = parseFrontmatter(text);
  if (!fm) return [...errors, "SKILL.md has no frontmatter"];

  errors.push(...yamlProblems(text));
  for (const k of Object.keys(fm)) if (!ALLOWED_KEYS.has(k)) errors.push(`frontmatter key "${k}" is not one of ${[...ALLOWED_KEYS].join(", ")}`);
  if (fm.name !== name) errors.push(`name "${fm.name}" must equal the directory name "${name}" (a mismatch is not invocable by exact name)`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name ?? "") || (fm.name ?? "").length > 64) errors.push(`name "${fm.name}" must be kebab-case, at most 64 characters`);
  const desc = fm.description ?? "";
  if (existing ? !TRIGGER.test(desc) : !/^Use when\b/.test(desc)) errors.push(existing ? "description has no routing trigger (\"use when ...\" or similar) anywhere" : 'description must start with "Use when": routing lives in the description, not in prose elsewhere');
  if (desc.length < 80) errors.push(`description is ${desc.length} characters; a routing description needs at least 80 (the trigger, then what it is not for)`);
  if (!/\bnot for\b/i.test(desc)) errors.push('description must say what the skill is "Not for", so a neighbour that fits better can win');
  if (desc.length > 1024) errors.push(`description is ${desc.length} characters; the limit is 1024`);
  if (/[<>]/.test(desc)) errors.push("description must not contain angle brackets");
  if (text.split(/\r?\n/).length > 500) errors.push("SKILL.md is over 500 lines: move detail into references/");

  // No prose-only references: a bundled file is read only if SKILL.md links it by its exact relative path (outside code fences and
  // comments, where a link is not a link), every link resolves, and every bundled file at any depth is linked individually.
  // Fenced blocks (``` or ~~~, any length, also inside a blockquote or a list item), HTML comments and inline code spans hold examples, not links.
  const visible = text.replace(FENCE, "").replace(/<!--[\s\S]*?-->/g, "").replace(/`[^`\n]*`/g, "");
  const named = new Set([...visible.matchAll(/\]\(([^)\s#]+)[^)]*\)/g)].map((m) => m[1].replace(/^\.\//, "")).filter((p) => !/^([a-z]+:|\/)/i.test(p)));
  for (const p of named) if (!existsSync(join(dir, p))) errors.push(`SKILL.md links ${p}, which does not exist`);
  for (const sub of ["references", "scripts", "assets"]) for (const f of listFiles(dir, `${sub}/`)) if (!named.has(f)) errors.push(`${f} exists but SKILL.md does not link it by exact path, so nothing will read it`);

  // Leftovers from the official eval tooling.
  for (const f of existsSync(skillsRoot) ? readdirSync(skillsRoot) : []) if (/-workspace$/.test(f)) errors.push(`${f} sits in .claude/skills/: skill-creator's workspace goes in the scratchpad, never beside the skill`);
  const commands = join(dirname(skillsRoot), "commands");
  for (const f of existsSync(commands) ? readdirSync(commands) : []) if (new RegExp(`^${name}-skill-[0-9a-f]{8}\\.md$`).test(f)) errors.push(`.claude/commands/${f} is a leftover of run_eval.py: delete it`);

  errors.push(...checkBaseline(join(dir, "evals", "baseline.md")));
  errors.push(...checkQueries(join(dir, "evals", "trigger-queries.json")));

  const skeptic = join(dir, "evals", "skeptic.md");
  if (!existsSync(skeptic)) errors.push("evals/skeptic.md is missing: a separate reviewer must try to refute the skill");
  else {
    const section = /^## Findings\s*$([\s\S]*?)(?=^## |(?![\s\S]))/im.exec(readFileSync(skeptic, "utf8"))?.[1] ?? "";
    const bullets = section.split(/\r?\n/).filter((l) => l.startsWith("- "));
    // The disposition is its own clause: "<finding>. fixed", "<finding>: fixed", "<finding>; rejected: <why>". "not yet fixed" is not one.
    const closed = /[.;:]\s+fixed\.?$|\brejected: \S.*$|\bnone found after trying: \S.*$/i;
    if (!bullets.length) errors.push('evals/skeptic.md needs a "## Findings" section with one "- " line per finding');
    for (const b of bullets) if (!closed.test(b.trim())) errors.push(`evals/skeptic.md finding has no disposition: "${b.trim().slice(0, 70)}". End it with a clause: ". fixed", "; rejected: <why>" or "; none found after trying: <what>"`);
  }

  const inv = join(dir, "evals", "invocation.json");
  if (!existsSync(inv)) errors.push("evals/invocation.json is missing: run `forge.mjs prove` from a fresh session, after the description is final");
  else {
    try {
      const j = JSON.parse(readFileSync(inv, "utf8"));
      if (j.skill !== name || j.toolUse !== true || j.loaded !== true) errors.push(`evals/invocation.json does not show the Skill tool loading "${name}" (skill=${j.skill}, toolUse=${j.toolUse}, loaded=${j.loaded})`);
      else if (j.descriptionSha256 !== descriptionHash(desc)) errors.push("evals/invocation.json was recorded for a different description than SKILL.md has now: run `forge.mjs prove` again");
      if (!j.claude) errors.push("evals/invocation.json has no claude version: it was not produced by `forge.mjs prove`");
    } catch {
      errors.push("evals/invocation.json is not valid JSON");
    }
  }

  if (existsSync(join(dir, "provenance", "source.json"))) {
    const validate = resolve(dir, "..", "..", "..", "scripts", "skill-compiler", "validate.mjs");
    const r = existsSync(validate) ? spawnSync(process.execPath, [validate, dir], { encoding: "utf8" }) : { status: 1, stdout: "", stderr: "scripts/skill-compiler/validate.mjs not found" };
    if (r.status !== 0) errors.push(`compiled from a source: validate.mjs exited ${r.status}\n${(r.stderr || r.stdout).trim()}`);
  }

  if (git) errors.push(...baselineBeforeSkill(dir, { existing }));
  return errors;
}

/** A baseline with a date, at least two task rows that say what happened and how it is known, and a failure shape with substance. */
function checkBaseline(file) {
  if (!existsSync(file)) return ["evals/baseline.md is missing: record how the task fails WITHOUT the skill before you write it"];
  const b = readFileSync(file, "utf8");
  const errors = [];
  const date = /^recorded:\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(b)?.[1];
  if (!date || Number.isNaN(Date.parse(date)) || Date.parse(date) > Date.now() + 86_400_000 || date < "2025-01-01") errors.push("evals/baseline.md needs a `recorded: yyyy-mm-dd` line with a real, past date");
  const tasks = /^## Tasks run without the skill\s*$([\s\S]*?)(?=^## |(?![\s\S]))/im.exec(b)?.[1];
  const shape = /^## Failure shape\s*$([\s\S]*?)(?=^## |(?![\s\S]))/im.exec(b)?.[1];
  if (tasks === undefined || shape === undefined) return [...errors, 'evals/baseline.md needs "## Tasks run without the skill" and "## Failure shape" sections'];
  const rows = tasks.split(/\r?\n/).filter((l) => l.startsWith("|")).slice(2).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
  const solid = rows.filter((r) => r.length >= 3 && r[0].length >= 5 && r[1].length >= 15 && r[2].length >= 15);
  if (solid.length < 2) errors.push("evals/baseline.md needs at least two task rows of three filled cells (task, what happened, evidence), each of real length");
  if (shape.replace(/\s+/g, " ").trim().length < 100) errors.push("evals/baseline.md: the failure shape is under 100 characters; say what fails and which step of the skill must prevent it");
  return errors;
}

function checkQueries(file) {
  if (!existsSync(file)) return ["evals/trigger-queries.json is missing: mine real prompts with `forge.mjs mine`, paraphrase them, label them"];
  let q;
  try {
    q = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return ["evals/trigger-queries.json is not valid JSON"];
  }
  if (!Array.isArray(q)) return ["evals/trigger-queries.json must be an array of { query, should_trigger, heldOut, origin }"];
  const errors = [];
  if (q.length < MIN_QUERIES) errors.push(`evals/trigger-queries.json has ${q.length} queries; at least ${MIN_QUERIES} are needed for a held-out set that means anything`);
  const seen = new Set();
  q.forEach((e, i) => {
    const at = `trigger-queries[${i}]`;
    if (typeof e?.query !== "string" || typeof e.should_trigger !== "boolean" || typeof e.heldOut !== "boolean") return errors.push(`${at}: needs string query, boolean should_trigger, boolean heldOut`);
    if (e.query.length < 20 || e.query.length > 400) errors.push(`${at}: query length ${e.query.length} must be 20 to 400 characters`);
    if (seen.has(e.query.trim().toLowerCase())) errors.push(`${at}: duplicate query`);
    seen.add(e.query.trim().toLowerCase());
    for (const [kind, re] of PII) if (re.test(e.query)) errors.push(`${at}: contains a ${kind}. The repo is public: paraphrase it`);
    if (!(TX.test(e.origin ?? "") || e.origin === "written")) errors.push(`${at}: origin must be "tx:<id from forge.mjs mine>" or "written" (invented, and said so)`);
    if (e.heldOut !== heldOut(e.query, e.origin)) errors.push(`${at}: heldOut is ${e.heldOut} but the hash rule says ${heldOut(e.query, e.origin)}. Run \`forge.mjs split --write\`; the held-out set is not yours to pick`);
  });
  for (const [label, set] of [["train", q.filter((e) => e?.heldOut === false)], ["held-out", q.filter((e) => e?.heldOut === true)]]) {
    const pos = set.filter((e) => e.should_trigger).length;
    if (pos < 3 || set.length - pos < 3) errors.push(`the ${label} set has ${pos} should-trigger and ${set.length - pos} should-not queries; it needs at least 3 of each (add queries; do not edit the flag)`);
  }
  const fromTx = q.filter((e) => TX.test(e?.origin ?? "")).length;
  if (q.length && fromTx * 3 < q.length) errors.push(`only ${fromTx} of ${q.length} queries come from real transcripts (origin tx:...); at least a third must. Mine more (--adjacent finds real near-miss negatives); do not relabel`);
  return errors;
}

/**
 * The baseline must be committed before SKILL.md, in an earlier commit, and left alone after it. A squash merge erases both, so this runs on the branch.
 * For a skill that predates the tool (`existing`), "the SKILL.md commit" is the first commit on this branch that changes it (the commit that created it
 * is long before any baseline); a branch that never touches SKILL.md has nothing to order.
 */
function baselineBeforeSkill(dir, { existing = false } = {}) {
  const rel = (p) => join(dir, p);
  const commits = (p, extra = []) => gitOut(dir, ["log", "--format=%H", ...extra, "--", rel(p)]).stdout.split("\n").filter(Boolean);
  let skillRange = ["--diff-filter=A", "--reverse"];
  if (existing) {
    const base = ["origin/main", "main"].map((ref) => gitOut(dir, ["merge-base", "HEAD", ref])).find((r) => r.status === 0)?.stdout.trim();
    if (!base) return ["--git --existing: no origin/main or main to compare this branch with, so its commits cannot be told apart from history"];
    skillRange = ["--reverse", `${base}..HEAD`];
  }
  const b = commits("evals/baseline.md", ["--diff-filter=A", "--reverse"])[0];
  const s = commits("SKILL.md", skillRange)[0];
  if (!b) return ["--git: evals/baseline.md is not committed yet: commit it before SKILL.md"];
  if (!s) return [];
  if (b === s) return ["--git: baseline.md and SKILL.md were added in the same commit; the baseline must come first, in its own commit"];
  if (gitOut(dir, ["merge-base", "--is-ancestor", b, s]).status !== 0) return ["--git: the baseline commit is not an ancestor of the SKILL.md commit"];
  // s itself counts: a baseline touched in the commit that adds SKILL.md was rewritten once the skill was visible.
  const after = commits("evals/baseline.md").filter((c) => gitOut(dir, ["merge-base", "--is-ancestor", s, c]).status === 0);
  if (after.length) return [`--git: evals/baseline.md was edited in ${after[0].slice(0, 9)}, after SKILL.md was ${existing ? "first changed on this branch" : "added"}: a baseline rewritten once the skill exists records nothing`];
  return [];
}

/** Interpret a `claude -p --output-format stream-json` transcript: did the Skill tool load `name`, and did the load succeed? */
export function parseInvocation(streamText, name) {
  let toolUseId = null;
  let loaded = false;
  let errored = false;
  for (const line of streamText.split(/\r?\n/)) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const c = o?.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type === "tool_use" && b.name === "Skill" && (b.input?.skill === name || b.input?.skill?.endsWith(`:${name}`))) toolUseId = b.id;
      if (b.type === "tool_result" && toolUseId && b.tool_use_id === toolUseId) {
        loaded = true;
        errored = b.is_error === true;
      }
    }
  }
  return { toolUse: toolUseId !== null, loaded: loaded && !errored };
}

/** Names passed to the Skill tool in a `claude -p --output-format stream-json` transcript, in order. */
export function skillCalls(streamText) {
  const out = [];
  for (const line of streamText.split(/\r?\n/)) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o?.type === "assistant") for (const b of o.message?.content ?? []) if (b.type === "tool_use" && b.name === "Skill" && typeof b.input?.skill === "string") out.push(b.input.skill);
  }
  return out;
}
const calls = (called, name) => called === name || called.endsWith(`:${name}`);
const controlPrompt = (name) => `Use the Skill tool to invoke the skill named exactly ${name}. After it loads, reply with the single word DONE and nothing else.`;

/**
 * The claude executable. On Windows `claude` is a .cmd shim, which Node and Python cannot start without a shell; the real
 * claude.exe sits beside it under node_modules. CLAUDE_BIN (and CLAUDE_BIN_ARGS, a JSON array) override it, which is also how the tests fake it.
 */
export function claudeCommand(env = process.env, platform = process.platform) {
  if (env.CLAUDE_BIN) return env.CLAUDE_BIN;
  if (platform !== "win32") return "claude";
  for (const dir of (env.PATH ?? env.Path ?? "").split(";").filter(Boolean)) {
    for (const rel of ["claude.exe", join("node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")]) if (existsSync(join(dir, rel))) return join(dir, rel);
  }
  return "claude";
}
const claudePrefix = () => (process.env.CLAUDE_BIN_ARGS ? JSON.parse(process.env.CLAUDE_BIN_ARGS) : []);

/**
 * One fresh `claude -p` session, not saved to disk (`--no-session-persistence`: a score run must not become a "real prompt" in the transcripts that
 * `mine` and `verify-origins` read). `failed` means the process or the service went wrong, not the model: no assistant message, a nonzero or missing
 * exit code (the turn cap excepted), or a refusal such as a weekly limit. A failed run is VOID, never a miss.
 */
export function runClaude({ prompt, model, cwd, maxTurns = 4, timeoutMs = 240_000 }) {
  return new Promise((done) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "CLAUDECODE")); // the nesting guard is for terminals, not for this
    const args = [...claudePrefix(), "-p", prompt, "--output-format", "stream-json", "--verbose", "--max-turns", String(maxTurns), "--no-session-persistence", "--allowedTools", "Skill", "Read", "Grep", "Glob", ...(model ? ["--model", model] : [])];
    let out = "";
    let err = "";
    const p = spawn(claudeCommand(), args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const finish = (code) => {
      clearTimeout(timer);
      const capped = /"subtype":\s*"error_max_turns"/.test(out);
      // An exit code is evidence: nonzero or no code at all (killed, never started) is a failed run, except the turn cap, which claude reports with a nonzero exit.
      // A refusal from the service (a weekly limit, seen 2026-10-15) arrives as a synthetic assistant message plus a rate_limit_event, not as a model answer.
      const synthetic = /"model":\s*"<synthetic>"/.test(out) || /"rate_limit_event"[^\n]*"status":\s*"rejected"/.test(out);
      const failed = !/"type":\s*"assistant"/.test(out) || synthetic || (code !== 0 && !(capped && typeof code === "number"));
      done({ out, err, code, failed, capped });
    };
    p.on("error", (e) => {
      err += String(e);
      finish(null);
    });
    p.on("close", finish);
  });
}

/**
 * Trigger score on the real routing: each query goes to a fresh `claude -p` session in this repo, where the skill is installed
 * under .claude/skills like any other, and counts as a trigger if the model calls the Skill tool for it. The official run_eval.py
 * cannot do this on Windows (it selects on a pipe and cannot start the .cmd shim) and prints a clean "6/9 passed" anyway, because
 * it counts a crashed query as "did not trigger". Here a crashed run is VOID, and a positive control runs first. A run that hit the
 * turn cap before the model chose is counted as a miss but reported as `capped`, so a too-low cap is visible.
 */
export async function score({ dir, set = "heldout", model, runs = 1, workers = 3, cwd }) {
  if (!["heldout", "train", "all"].includes(set)) throw new Error(`--set must be heldout, train or all, not "${set}"`);
  const name = basename(dir);
  const queries = JSON.parse(readFileSync(join(dir, "evals", "trigger-queries.json"), "utf8")).filter((e) => set === "all" || (set === "heldout") === e.heldOut);
  const control = await runClaude({ prompt: controlPrompt(name), model, cwd });
  if (control.failed || !skillCalls(control.out).some((c) => calls(c, name))) return { void: true, reason: `the positive control failed: an explicit request did not make claude call the Skill tool for "${name}" (${control.failed ? `process failed (exit ${control.code}): ${control.err.trim().slice(0, 200)}` : "claude ran but did not load it"}), so no score can be trusted`, results: [] };
  const results = queries.map((e) => ({ query: e.query, should_trigger: e.should_trigger, triggers: 0, runs, voided: 0, capped: 0, others: [] }));
  const jobs = results.flatMap((r) => Array.from({ length: runs }, () => r));
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, jobs.length) }, async () => {
      while (next < jobs.length) {
        const r = jobs[next++];
        const run = await runClaude({ prompt: r.query, model, cwd, maxTurns: 6 });
        if (run.failed) r.voided++;
        else if (skillCalls(run.out).some((c) => calls(c, name))) r.triggers++;
        else if (run.capped) r.capped++;
        for (const c of skillCalls(run.out)) if (!calls(c, name) && !r.others.includes(c)) r.others.push(c); // which skills answered instead: a routing conflict shows here
      }
    }),
  );
  for (const r of results) r.pass = r.voided === 0 && (r.should_trigger ? r.triggers / runs >= 0.5 : r.triggers / runs < 0.5);
  const sum = (k) => results.reduce((n, r) => n + r[k], 0);
  return { void: false, set, model: model ?? "default", correct: results.filter((r) => r.pass).length, total: results.length, voided: sum("voided"), capped: sum("capped"), results };
}

/**
 * Is this transcript line a prompt the operator typed? Measured on 60 days of this machine's transcripts (2026-10-15): operator turns carry
 * turnOrigin "human" (and origin.kind "human"); a headless `claude -p` run, such as this tool's own score runs, carries turnOrigin "sdk" and NO origin
 * field (334 lines), which a default of "human" counted as the operator. task_notification, scheduled and peer turns are not the operator either.
 * entrypoint "sdk-cli" is the print-mode CLI's marker; it was not seen here, so it only guards the old format, where turnOrigin is absent.
 */
export function operatorTurn(o) {
  if (o.entrypoint === "sdk-cli") return false;
  if (o.turnOrigin !== undefined && o.turnOrigin !== "human") return false;
  return (o.origin?.kind ?? "human") === "human";
}

/** Candidate trigger queries from transcripts: prompts whose turn fired a sibling skill, a neighbour, or matched a keyword. */
export async function mine({ root, keywords = [], skills = [], adjacent = [], days = 60, limit = 60, all = false }) {
  const kw = all ? /[\s\S]/ : keywords.length ? new RegExp(keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i") : null;
  const sibling = new Set(skills);
  const neighbour = new Set(adjacent);
  const named = (set, fired) => fired.some((s) => set.has(s) || set.has(s.split(":").pop()));
  const cutoff = Date.now() - days * 86_400_000;
  const found = new Map();
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl") && statSync(p).mtimeMs >= cutoff) files.push(p);
    }
  };
  if (existsSync(root)) walk(root);
  const keep = (turn) => {
    if (!turn) return;
    const q = redact(turn.text);
    const fired = [...turn.fired];
    const source = named(sibling, fired) ? "sibling" : named(neighbour, fired) ? "adjacent" : kw?.test(turn.text) ? "keyword" : null;
    if (source && q.length >= 25) found.set(originId(q), { origin: originId(q), query: q, fired, source });
  };
  for (const f of files) {
    let turn = null;
    for await (const line of createInterface({ input: createReadStream(f, "utf8"), crlfDelay: Infinity })) {
      if (!line.includes('"user"') && !line.includes('"Skill"')) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const c = o.message?.content;
      // isMeta marks text the harness injected (a skill body, a reminder), and a continuation summary is a model's, not the operator's.
      if (o.type === "user" && !o.isSidechain && !o.isMeta && operatorTurn(o)) {
        const text = typeof c === "string" ? c : Array.isArray(c) && !c.some((b) => b.type === "tool_result") ? c.filter((b) => b.type === "text").map((b) => b.text).join(" ") : "";
        if (!text || /^(<|\/|This session is being continued|Base directory for this skill|Caveat:)/.test(text) || text.includes("<command-name>")) continue;
        keep(turn);
        turn = { text, fired: new Set() };
      } else if (o.type === "assistant" && !o.isSidechain && turn && Array.isArray(c)) {
        for (const b of c) if (b.type === "tool_use" && b.name === "Skill" && typeof b.input?.skill === "string") turn.fired.add(b.input.skill);
      }
    }
    keep(turn);
  }
  const rows = [...found.values()].sort((a, b) => a.origin.localeCompare(b.origin));
  return ["sibling", "adjacent", "keyword"].flatMap((s) => rows.filter((e) => e.source === s).slice(0, limit));
}

// Launched through a symlink or junction, argv[1] is the link and import.meta.url the target: compare real paths, or the CLI exits 0 having done nothing.
const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]).toLowerCase() === realpathSync(fileURLToPath(import.meta.url)).toLowerCase();
  } catch {
    return false;
  }
})();
if (isMain) {
  const [cmd, target] = process.argv.slice(2);
  const flag = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
  const list = (n) => (flag(n) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const projects = () => flag("--root") ?? join(homedir(), ".claude", "projects");
  if (cmd === "check") {
    const errors = checkSkill(target, { git: process.argv.includes("--git"), existing: process.argv.includes("--existing") });
    errors.forEach((e) => console.error(`ERROR  ${e}`));
    console.log(`forge check ${basename(resolve(target))}: ${errors.length} problem(s)`);
    process.exit(errors.length ? 1 : 0);
  } else if (cmd === "mine") {
    const out = await mine({ root: projects(), keywords: list("--keywords"), skills: list("--skills"), adjacent: list("--adjacent"), days: Number(flag("--days") ?? 60), limit: Number(flag("--limit") ?? 60) });
    console.error(`mined ${out.length} candidate(s). Paraphrase before committing; keep the origin id.`);
    console.log(JSON.stringify(out, null, 2));
  } else if (cmd === "split") {
    const file = join(resolve(target), "evals", "trigger-queries.json");
    const q = JSON.parse(readFileSync(file, "utf8"));
    for (const e of q) e.heldOut = heldOut(e.query, e.origin);
    if (process.argv.includes("--write")) writeFileSync(file, JSON.stringify(q, null, 2) + "\n");
    console.log(`${q.length} queries: ${q.filter((e) => e.heldOut).length} held out, ${q.filter((e) => !e.heldOut).length} train${process.argv.includes("--write") ? " (written)" : " (dry run; add --write)"}`);
  } else if (cmd === "verify-origins") {
    const q = JSON.parse(readFileSync(join(resolve(target), "evals", "trigger-queries.json"), "utf8")).filter((e) => TX.test(e.origin ?? ""));
    const every = new Set((await mine({ root: projects(), all: true, days: Number(flag("--days") ?? 400), limit: Infinity })).map((e) => e.origin));
    const missing = q.filter((e) => !every.has(e.origin));
    missing.forEach((e) => console.error(`ERROR  ${e.origin} is in no transcript on this machine: ${e.query.slice(0, 70)}`));
    console.log(`verify-origins: ${q.length - missing.length} of ${q.length} tx: ids resolve to a real prompt in ${projects()}`);
    process.exit(missing.length ? 1 : 0);
  } else if (cmd === "prove") {
    const dir = resolve(target);
    const name = basename(dir);
    if (!existsSync(join(dir, "SKILL.md"))) {
      console.error(`ERROR  ${join(dir, "SKILL.md")} does not exist: there is nothing to prove`);
      process.exit(2);
    }
    const r = await runClaude({ prompt: controlPrompt(name), model: flag("--model"), cwd: resolve(dir, "..", "..", "..") });
    const version = spawnSync(claudeCommand(), [...claudePrefix(), "--version"], { encoding: "utf8" }).stdout?.trim();
    const parsed = parseInvocation(r.out, name);
    const result = { skill: name, toolUse: parsed.toolUse, loaded: parsed.loaded && !r.failed, exit: r.code, claude: version, descriptionSha256: descriptionHash(descriptionOf(dir)) };
    console.log(JSON.stringify(result));
    if (r.failed) {
      // The process failed (exit code, a rate limit, no answer): that says nothing about the skill, so an existing good proof is left alone.
      console.error(`prove FAILED (exit ${r.code}): the claude run itself failed, evals/invocation.json left untouched`);
      process.exit(1);
    }
    mkdirSync(join(dir, "evals"), { recursive: true });
    writeFileSync(join(dir, "evals", "invocation.json"), JSON.stringify(result, null, 2) + "\n");
    process.exit(result.toolUse && result.loaded ? 0 : 1);
  } else if (cmd === "score") {
    const dir = resolve(target);
    const set = flag("--set") ?? "heldout";
    if (!["heldout", "train", "all"].includes(set)) {
      console.error(`--set must be heldout, train or all, not "${set}"`);
      process.exit(64);
    }
    const s = await score({ dir, set, model: flag("--model"), runs: Number(flag("--runs") ?? 1), workers: Number(flag("--workers") ?? 3), cwd: resolve(dir, "..", "..", "..") });
    if (flag("--out")) writeFileSync(flag("--out"), JSON.stringify(s, null, 2) + "\n");
    if (s.void) console.error(`VOID: ${s.reason}`);
    else {
      for (const r of s.results) console.log(`${r.pass ? "PASS" : r.voided ? "VOID" : "FAIL"}  expected=${r.should_trigger}  fired ${r.triggers}/${r.runs}${r.capped ? `  (${r.capped} run(s) hit the turn cap)` : ""}  ${r.query.slice(0, 90)}${r.pass ? "" : `
        other skills called: ${r.others.join(", ") || "none"}`}`);
      console.log(`${set}: ${s.correct} of ${s.total} correct${s.capped ? `; ${s.capped} run(s) hit the turn cap before the model chose` : ""}${s.voided ? `; ${s.voided} query run(s) VOID (the claude process failed): the result does not stand` : ""}`);
    }
    process.exit(s.void || s.voided ? 1 : 0);
  } else {
    console.error("usage: forge.mjs check|mine|split|verify-origins|score|prove ... (see the file header)");
    process.exit(64);
  }
}
