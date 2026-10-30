#!/usr/bin/env node
/**
 * Rule evals for monorepo-manager v4 (2026-10-30). Each case is a scenario a manager meets on a session-heavy job
 * (evals/baseline.md T1-T7). decide(text) derives the manager's answer from the skill's own text (SKILL.md plus every
 * references/*.md it links) with a fixed parser, and the case passes when that answer equals the expected one.
 *
 * What this proves: the text states each rule precisely enough to decide the scenario (a threshold, an order, a
 * recipient, an escalation), not merely that a word appears. What it does not prove: that a model follows it (that is
 * the manager's next real job; see the PR body). C0 is the positive control: a v3 rule, so the parser must PASS on v3.
 *
 * Run:  node .claude/skills/monorepo-manager/evals/v4-rules.mjs               (the working tree)
 *       node .claude/skills/monorepo-manager/evals/v4-rules.mjs --ref <git ref> (the skill at a ref, e.g. the v3 base)
 * Exit 0 when every case passes, 1 otherwise. No dependencies, no network, reads only.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(SKILL_DIR, "..", "..", "..");
const REL = ".claude/skills/monorepo-manager";
const refArg = process.argv.indexOf("--ref");
const ref = refArg > 0 ? process.argv[refArg + 1] : null;

function read(rel) {
  if (!ref) return existsSync(join(SKILL_DIR, rel)) ? readFileSync(join(SKILL_DIR, rel), "utf8") : "";
  const r = spawnSync("git", ["show", `${ref}:${REL}/${rel}`], { cwd: REPO, encoding: "utf8" });
  return r.status === 0 ? r.stdout : "";
}

const skill = read("SKILL.md");
if (!skill) {
  console.error(`no SKILL.md at ${ref ?? "the working tree"}`);
  process.exit(2);
}
const linked = [...new Set([...skill.matchAll(/\]\((references\/[A-Za-z0-9._-]+\.md)\)/g)].map((m) => m[1]))];
const text = [skill, ...linked.map(read)].join("\n");
const num = (s) => Number(String(s).replace(/,/g, ""));
const section = (heading) => new RegExp(`^## ${heading}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(skill)?.[1] ?? null;
const lineWith = (re) => text.split(/\r?\n/).find((l) => re.test(l)) ?? null;

/** The RAM gate as the text states it: { under, writer, cap } or null when the text gives no numbers. */
function ramGate() {
  const under = /under ([\d,]+) MB start nothing/.exec(text)?.[1];
  const writer = /([\d,]+) MB and up a writer session/.exec(text)?.[1];
  const cap = /cap: (\d+) running sessions/.exec(text)?.[1];
  return under && writer ? { under: num(under), writer: num(writer), cap: cap ? num(cap) : null } : null;
}

/** The field names every brief must carry, from "carries the lines A, B and C". */
function requiredBriefLines() {
  const m = /carries the lines ([A-Z][A-Z ,]*?(?: and [A-Z][A-Z ]*?)?)(?= from| \(|\.|$)/m.exec(text);
  return m ? m[1].split(/, | and /).map((s) => s.trim()).filter(Boolean) : [];
}

// A brief built only from the v3 template's fields (it has no loop, standard or sibling lines), one that adds all three, and
// one that adds all but LOOP RULE (mutation pass 2026-10-30: dropping LOOP RULE alone from the rule survived a two-brief case).
const V3_BRIEF = ["LANE: platform", "MODEL / EFFORT: opus / high", "GOAL: x", "ACCEPTANCE: x", "SELF-AUDIT: x", "RETURN: x"].join("\n");
const V4_BRIEF = `${V3_BRIEF}\nLOOP RULE: x\nSTANDARD: x\nSIBLINGS: x`;
const NO_LOOP_BRIEF = `${V3_BRIEF}\nSTANDARD: x\nSIBLINGS: x`;
const lint = (brief, req) => (req.every((f) => new RegExp(`^${f}:`, "m").test(brief)) ? "accept" : "reject");

const CASES = [
  {
    id: "C0",
    rule: "control (a v3 rule): a step inside Nour's order is done, not asked",
    scenario: "Nour ordered the job; a docs PR is green. Ask him before merging?",
    want: "act",
    decide: () => (/Ask Nour only about the four protected classes/.test(text) ? "act" : "unknown"),
  },
  {
    id: "R1",
    rule: "RAM gate before every session start (baseline T1)",
    scenario: "free RAM 400 MB docs-only / 900 MB docs-only / 900 MB writer / 1,600 MB writer: start or wait?",
    want: "wait,start,wait,start",
    decide: () => {
      const g = ramGate();
      if (!g) return "no thresholds in the text";
      const gate = (mb, kind) => (mb < g.under ? "wait" : kind === "writer" && mb < g.writer ? "wait" : "start");
      return [gate(400, "docs"), gate(900, "docs"), gate(900, "writer"), gate(1600, "writer")].join(",");
    },
  },
  {
    id: "R2",
    rule: "machine-wide session cap, other managers' sessions included (baseline T1)",
    scenario: "12 sessions run on the laptop (8 of them another manager's), 2,000 MB free: start a docs session?",
    want: "wait",
    decide: () => {
      const g = ramGate();
      if (!g?.cap) return "no session cap in the text";
      return /other managers'/.test(lineWith(/cap: \d+ running sessions/) ?? "") ? (12 >= g.cap ? "wait" : "start") : "cap ignores other managers";
    },
  },
  {
    id: "R3",
    rule: "every brief carries the loop, standard and sibling lines (baseline T2, T3, T5)",
    scenario: "lint a brief made only of v3 template fields, one with every v4 line but LOOP RULE, then one with all three",
    want: "reject,reject,accept",
    decide: () => {
      const req = requiredBriefLines();
      return `${lint(V3_BRIEF, req)},${lint(NO_LOOP_BRIEF, req)},${lint(V4_BRIEF, req)}`;
    },
  },
  {
    id: "R4",
    rule: "the manager's sweep cadence while sessions run (baseline T2)",
    scenario: "the manager's own loop: is a 1,500 s delay right? is 700 s?",
    want: "too slow,ok",
    decide: () => {
      const m = /sweep every ([\d,]+) to ([\d,]+) s/.exec(text);
      if (!m) return "no sweep cadence in the text";
      const ok = (s) => (s > num(m[2]) ? "too slow" : s < num(m[1]) ? "too fast" : "ok");
      return `${ok(1500)},${ok(700)}`;
    },
  },
  {
    id: "R5",
    rule: "what each sweep reads (baseline T1, T2)",
    scenario: "one tick: which readings must the sweep take?",
    want: "complete",
    decide: () => {
      const l = lineWith(/sweep every [\d,]+ to [\d,]+ s/);
      if (!l) return "no sweep line";
      const missing = ["minutes since its last commit", "gh pr checks", "free RAM"].filter((t) => !l.includes(t));
      return missing.length ? `missing: ${missing.join("; ")}` : "complete";
    },
  },
  {
    id: "R6",
    rule: "a ruling reaches every running session of the job in the same tick (baseline T3)",
    scenario: "Nour rules on one question while sessions A, B and C of the job run: who hears it, and when?",
    want: "all running sessions,same tick",
    decide: () => {
      const l = lineWith(/ruling/i);
      const all = /every running session of the job/.test(text) && /[Rr]uling[^\n]*every running session of the job/.test(text);
      const tick = /every running session of the job[^\n]*same tick|same tick[^\n]*every running session of the job/.test(text);
      return l && all && tick ? "all running sessions,same tick" : "not stated";
    },
  },
  {
    id: "R7",
    rule: "a finished doc becomes a digest for the still-running sessions (baseline T3)",
    scenario: "session D finishes its doc while E and F still run: what do E and F get?",
    want: "digest",
    decide: () => (/finished doc[^\n]*digest[^\n]*still-running sessions/.test(text) ? "digest" : "nothing stated"),
  },
  {
    id: "R8",
    rule: "close-out order: memory, then archive, then one line to Nour (baseline T4)",
    scenario: "a session's PR merged and its result is checked: order the close-out",
    want: "memory,archive,report",
    decide: () => {
      const l = lineWith(/Close out/);
      if (!l) return "no close-out line";
      const at = { memory: l.indexOf("takeover memory"), archive: l.indexOf("archive_session"), report: l.indexOf("one line per finished piece") };
      if (Object.values(at).some((i) => i < 0)) return `missing: ${Object.keys(at).filter((k) => at[k] < 0).join(",")}`;
      return Object.keys(at).sort((a, b) => at[a] - at[b]).join(",");
    },
  },
  {
    id: "R9",
    rule: "never archive a session whose PR is open or whose tree holds uncommitted work (baseline T4)",
    scenario: "a session's PR is still open: archive it now?",
    want: "no",
    decide: () => (/never while its PR is open or its worktree holds uncommitted work/.test(text) ? "no" : "unknown"),
  },
  {
    id: "R10",
    rule: "send-back limit for sessions (baseline T5)",
    scenario: "a session returns an unlabelled number: first time? second time on the same gap?",
    want: "send back once,higher tier or replace",
    decide: () => {
      const first = /send it back once with the exact gap/.test(text);
      const second = /second miss[^\n]*(a higher tier|replace)/.test(text);
      return first && second ? "send back once,higher tier or replace" : `first:${first} second:${second}`;
    },
  },
  {
    id: "R11",
    rule: "parked-decisions register (baseline T6)",
    scenario: "Nour says \"leave these for later, remind me\" on three decisions: where do they go, and when are they shown again?",
    want: "park,show again",
    decide: () => {
      const park = /## Parked for Nour/.test(text);
      const again = /show (?:them|each|it) again[^\n]*(next decision gate|final report)/.test(text);
      return park && again ? "park,show again" : `park:${park} again:${again}`;
    },
  },
  {
    id: "R12",
    rule: "queue a blocked session: write the brief now, start it when a slot frees (baseline T1)",
    scenario: "the RAM gate says wait, the brief is ready: what now?",
    want: "queue",
    decide: () => (/QUEUED[^\n]*start it the moment a slot frees|start it the moment a slot frees[^\n]*QUEUED/.test(text) ? "queue" : "not stated"),
  },
  {
    id: "R13",
    rule: "lane agents missing: dispatch as sessions (baseline T7)",
    scenario: "the Agent tool says lane-platform is not available: what carries the brief?",
    want: "start_session",
    decide: () => (/lane agents? (?:are |is )?(?:missing|not available)[^\n]*start_session/i.test(text) ? "start_session" : "not stated"),
  },
  {
    id: "R14",
    rule: "job start loads who Nour is, how the shop works and the money frame (brief DESIGN 1)",
    scenario: "a fresh manager with no memory: which files first, and what does it state per job?",
    want: "ok",
    decide: () => {
      const s = section("Job start");
      if (s === null) return "no Job start section";
      const paths = [...s.matchAll(/`([\w./-]+\.(?:md|ts))`/g)].map((m) => m[1]);
      const need = ["USER.md", "SHOP-SOUL.md", "business.ts", "NOUR-RUNTIME-KERNEL.md"];
      const missing = need.filter((n) => !paths.some((p) => p.endsWith(n)));
      const absent = paths.filter((p) => p.includes("/") && !existsSync(join(REPO, p)));
      if (missing.length || absent.length) return `missing: ${missing.join(",")} absent on disk: ${absent.join(",")}`;
      return /money frame/i.test(s) ? "ok" : "no money frame line";
    },
  },
];

let failed = 0;
for (const c of CASES) {
  let got;
  try {
    got = c.decide();
  } catch (e) {
    got = `threw: ${e.message}`;
  }
  const pass = got === c.want;
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${c.id}  ${c.rule}\n      scenario: ${c.scenario}\n      want: ${c.want}   got: ${got}`);
}
console.log(`\n${ref ?? "working tree"}: ${CASES.length - failed} of ${CASES.length} pass`);
process.exit(failed ? 1 : 0);
