/**
 * Workflow cost guards (CI diet, 2026-10-16).
 *
 * A PR push was billing ~27 runner-minutes before node and e2e: ten jobs of 20 to 110 seconds, each
 * rounded UP to a full minute. The cuts below keep every catch; this file is what stops them from
 * quietly un-doing themselves, and what stops a "saving" from turning into a dropped check.
 *
 *   concurrency-pr    every PR-triggered workflow cancels a superseded run (a second push per PR is normal here)
 *   concurrency-main  a push to main NEVER cancels another main run (the only verdict that commit will get)
 *   e2e-paths         statenour e2e runs when the diff touches app code, not when it only touches apps/statenour/docs
 *   e2e-no-main-push  e2e does not run again on main (the PR head already ran it; node stays as the safety net)
 *   folded-steps      the small checks folded into one job still carry every step, each in exactly one job
 *   required-context  the staged ruleset names only checks that exist ("Workflow / job"), so a fold cannot make
 *                     a required check that nothing reports (a permanent hold the day the ruleset is applied)
 *   adoption-paths    adoption gates skip docs-only diffs but never skip a directory they scan
 *   adoption-no-main-push  adoption gates run on PRs only (the PR head ran them; node covers main)
 *   proof-paths       the post-deploy storefront proof skips apps/nickstire/docs, except docs/reel-packs (read at runtime)
 *   notify-pr         the summary-only notify job does not bill on PRs
 *   security-in-node  the dependency audit is the tail of `node`: blocking, runs when an earlier step is red
 *   needs-resolve     no job `needs:` a job that a fold deleted
 *   node-filter       a diff to the dependency scanner (or its imports) selects node; a README diff does not
 *   policy-orderthe folded PR gates run before the verifier, which carries its own step timeout
 *   diag-no-pr        the always-green typecheck diagnostic does not run on every PR
 *   live-pr-body      the PR-body gates (contradictions, source citation) read the LIVE body, not the payload a re-run reuses
 *
 * Every rule is proven twice: the live tree must be clean, and a mutated COPY of the workflows (temp dir) must
 * trip exactly that rule. Zero dependencies (this runs in the Node-only agent-policy job), so the workflow
 * reader below is a small indentation parser for the YAML subset these files use, not a YAML library.
 *
 * Run:  node --test scripts/agent-os/workflowCostGuards.test.mjs   (or: pnpm agent:verify)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const RULESET = join("config", "agent-os", "ruleset-required-checks.json");

// ── a YAML reader for the subset workflows use ───────────────────────────────────────────────────────────────

function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; } else if (c === "'" || c === '"') q = c;
    else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

function lineList(text) {
  const out = [];
  let skipAbove = null; // a block scalar (`|`, `>`) swallows every deeper line
  for (const raw of text.split(/\r?\n/)) {
    const indent = raw.length - raw.trimStart().length;
    if (skipAbove !== null) {
      if (!raw.trim() || indent > skipAbove) continue;
      skipAbove = null;
    }
    const content = stripComment(raw.trim());
    if (!content) continue;
    out.push({ indent, content });
    if (/:\s*[|>][+-]?\d*$/.test(content) || /^-\s+[|>][+-]?\d*$/.test(content)) skipAbove = indent;
  }
  return out;
}

function scalar(v) {
  v = v.trim();
  if (v === "{}") return {};
  if (v.startsWith("[") && v.endsWith("]")) return v.slice(1, -1).split(",").map((x) => scalar(x)).filter((x) => x !== "");
  if (/^(['"]).*\1$/.test(v)) return v.slice(1, -1);
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

const KEY = /^((?:"[^"]*"|'[^']*'|[^\s'"#\[{][^:]*?)):(?:\s+(.*))?$/;

function parseNode(lines, at, indent) {
  const first = lines[at];
  if (/^-(\s|$)/.test(first.content)) {
    const arr = [];
    while (at < lines.length && lines[at].indent === indent && /^-(\s|$)/.test(lines[at].content)) {
      const rest = lines[at].content.replace(/^-\s*/, "");
      if (rest && KEY.test(rest) && !/^(['"]).*\1$/.test(rest)) {
        const patched = lines.slice();
        patched[at] = { indent: indent + 2, content: rest };
        const [val, next] = parseNode(patched, at, indent + 2);
        arr.push(val);
        at = next;
      } else {
        arr.push(scalar(rest));
        at++;
      }
    }
    return [arr, at];
  }
  const map = {};
  while (at < lines.length && lines[at].indent === indent) {
    const m = KEY.exec(lines[at].content);
    if (!m) throw new Error(`unparseable workflow line: ${lines[at].content}`);
    const key = scalar(m[1]);
    const rest = m[2] ?? "";
    at++;
    if (rest) { map[key] = scalar(rest); continue; }
    const nextLine = lines[at];
    if (nextLine && (nextLine.indent > indent || (nextLine.indent === indent && /^-(\s|$)/.test(nextLine.content)))) {
      const [val, next] = parseNode(lines, at, nextLine.indent);
      map[key] = val;
      at = next;
    } else map[key] = null;
  }
  return [map, at];
}

export function parseWorkflow(text) {
  const lines = lineList(text);
  if (!lines.length) throw new Error("empty workflow");
  return parseNode(lines, 0, lines[0].indent)[0];
}

// ── the expression and path-filter semantics these rules need ────────────────────────────────────────────────

/** Evaluate a `${{ ... }}` template. An unknown identifier throws, so a new construct fails loudly, never green. */
function evalTemplate(template, ctx) {
  if (typeof template === "boolean") return template;
  const run = (expr) => new Function("github", "always", "cancelled", `return (${expr});`)(ctx, () => true, () => false);
  const whole = /^\$\{\{(.*)\}\}$/s.exec(String(template).trim());
  if (whole) return run(whole[1]);
  return String(template).replace(/\$\{\{(.*?)\}\}/g, (_m, expr) => String(run(expr)));
}

/** An `if:` may be bare or wrapped in `${{ }}`; both mean the same expression. */
function evalIf(v, ctx) {
  const m = /^\$\{\{(.*)\}\}$/s.exec(String(v).trim());
  return Boolean(new Function("github", "always", "cancelled", `return (${m ? m[1] : v});`)(ctx, () => true, () => false));
}

const context = (event, over = {}) => ({
  workflow: "W",
  event_name: event,
  ref: event === "pull_request" ? "refs/pull/7/merge" : "refs/heads/main",
  sha: "aaa",
  event: { pull_request: event === "pull_request" ? { number: 7 } : {} },
  ...over,
});

/** GitHub `paths` semantics: patterns in order, `!` un-matches, the last matching pattern decides. */
function globToRegex(g) {
  let re = "";
  for (let i = 0; i < g.length; i++) {
    if (g.startsWith("**/", i)) { re += "(?:.*/)?"; i += 2; }
    else if (g.startsWith("**", i)) { re += ".*"; i += 1; }
    else if (g[i] === "*") re += "[^/]*";
    else if (g[i] === "?") re += "[^/]";
    else re += g[i].replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}
function pathMatches(patterns, file) {
  let hit = false;
  for (const p of patterns) {
    const neg = p.startsWith("!");
    if (globToRegex(neg ? p.slice(1) : p).test(file)) hit = !neg;
  }
  return hit;
}
const triggers = (patterns, files) => files.some((f) => pathMatches(patterns, f));

// ── the checks ───────────────────────────────────────────────────────────────────────────────────────────────

const POLICY_STEPS = [
  "decide live canaries (git diff, no API)",
  "agent-os verify",
  // from completion-authority.yml
  "Validate capability ledger (evidence-gated states)",
  "Reality ledger is in sync with the JSON",
  "DoD compiler (requirements derived from the diff)",
  "Review gate (unresolved P0/P1/P2 threads, stale approvals, changes-requested)",
  "Contradiction detector (claims vs evidence vs ledger vs PR body)",
  // from secret-scan.yml
  "Install gitleaks",
  "Scan the PR's new commits for secrets (hard gate)",
  // from the old `source citation (rule 7)` job
  "collect PR diff and body",
  "check source citation",
];
const ADOPTION_STEPS = [
  "canary - ast-grep must fail on the bad fixtures, on the RULE",
  "gate - no native dialogs in either PWA's client code",
  "canary - dependency-cruiser must fail on the bad fixtures, on the RULES",
  "gate - layer boundaries + deprecated-card ban",
  // from the old `curdate gate` job
  "canary - the gate must FAIL on a planted CURDATE()",
  "canary - the gate must PASS on a clean tree",
  "gate - no NEW bare CURDATE()",
];
const SHARED_NAMES = new Set(["canary - the gate must PASS on a clean tree"]);
// The two knip gates, now steps of test.yml's `node` job (they were adoption-gates.yml jobs). Still blocking.
const KNIP_STEPS = [
  "canary - knip must fail on a planted unused file",
  "knip reachability gate - zero unused files (blocking since 2026-08-27)",
  "canary - the gate must FAIL on a planted orphan",
  "canary - the gate must PASS on a clean tree",
  "gate - no NEW unconsumed exports, files, or scripts",
];
// Directories the adoption gates scan or run in; no ignore pattern may swallow a file under any of them.
const ADOPTION_SCANNED = [
  "apps/statenour/app/x.tsx", "apps/statenour/components/x.tsx", "apps/statenour/features/x.ts", "apps/statenour/hooks/x.ts",
  "apps/statenour/lib/x.ts", "apps/nickstire/client/src/x.tsx", "apps/nickstire/server/services/shopSales.ts",
  "apps/nickstire/shared/reelScore.ts", "config/adoption-gates/sgconfig.yml", "pnpm-lock.yaml", "package.json",
];
// Real diffs, as positive controls: the files of the two UI v3 waves whose six-feet gate must keep running.
const V3_W2_FILES = [
  "apps/statenour/components/home/brief-rows.tsx", "apps/statenour/app/(mastery)/missions/page.tsx",
  "apps/statenour/lib/home/operator-brief.ts", "apps/statenour/hooks/use-brief-feedback.ts",
  "apps/statenour/tests/e2e/fixtures/home.ts", "apps/statenour/docs/RECONCILIATION.md", "docs/agent-os/MANAGER-LEDGER.md",
];
const V3_W3A_FILES = [
  ".github/workflows/e2e-statenour.yml", "apps/statenour/tests/e2e/fixtures/chat.ts", "apps/statenour/tests/e2e/vt-render.ts",
  "apps/statenour/tests/repo/v3-gate.test.ts", "apps/statenour/docs/design/ui-v3/PLAN.md",
];
const DOCS_ONLY_FILES = ["apps/statenour/docs/design/ui-v3/PLAN.md", "apps/statenour/docs/design/outcome-ledger-coverage-2026-10-02.md", "apps/statenour/docs/x/y/z.md"];
// Docs the app READS AT RUNTIME (system.changeDigest, the /system smoke page): not documentation-only. Read from the
// two real sources so a doc added to either cannot fall outside the e2e filter.
const RUNTIME_READ_SOURCES = ["apps/statenour/lib/services/system-change-digest.ts", "apps/statenour/lib/evals/memory-evals.ts"];
// Only literals that are LOADED: system-change-digest.ts in full, and in memory-evals.ts the `groundingDoc:` values
// and the CURRENT_TRUTH constant. Its `sourceHints` strings are citations, never opened (NOT scanned on purpose).
const runtimeReadDocs = () => [...new Set(RUNTIME_READ_SOURCES.flatMap((f) => readFileSync(join(REPO, f), "utf8").split("\n")
  .filter((l) => f.endsWith("system-change-digest.ts") || /groundingDoc:|const CURRENT_TRUTH/.test(l))
  .flatMap((l) => [...l.matchAll(/["'](docs\/[A-Za-z0-9_./-]+\.md)["']/g)].map((m) => m[1]))))];

export function checkWorkflows(root) {
  const bad = [];
  const flag = (rule, msg) => bad.push({ rule, msg });
  const dir = join(root, ".github", "workflows");
  const wfs = {};
  for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x)).sort()) wfs[f] = parseWorkflow(readFileSync(join(dir, f), "utf8"));
  const jobsOf = (f) => Object.entries(wfs[f]?.jobs ?? {});
  const triggersOf = (wf) => (typeof wf.on === "string" ? { [wf.on]: {} } : Array.isArray(wf.on) ? Object.fromEntries(wf.on.map((e) => [e, {}])) : wf.on ?? {});

  // concurrency-pr / concurrency-main
  for (const [f, wf] of Object.entries(wfs)) {
    const on = triggersOf(wf);
    const c = wf.concurrency;
    if ("pull_request" in on) {
      if (!c || !c.group) { flag("concurrency-pr", `${f}: PR-triggered but has no concurrency group`); continue; }
      const grp = (over, ev = "pull_request") => String(evalTemplate(c.group, context(ev, over)));
      const cancel = (ev, over) => Boolean(evalTemplate(c["cancel-in-progress"] ?? false, context(ev, over)));
      if (!cancel("pull_request")) flag("concurrency-pr", `${f}: a superseded PR run is not cancelled`);
      const pr7 = grp({ sha: "a" }), pr7b = grp({ sha: "b" });
      const pr8 = grp({ ref: "refs/pull/8/merge", event: { pull_request: { number: 8 } } });
      if (pr7 !== pr7b) flag("concurrency-pr", `${f}: two pushes to one PR land in different groups, so the first is never cancelled`);
      if (pr7 === pr8) flag("concurrency-pr", `${f}: two different PRs share a group and cancel each other`);
    }
    // Only workflows that ALSO run on PRs verify commits: a main run of one of those is the only verdict that
    // commit gets. nickstire-proof and prerender-refresh have no PR trigger; they measure or regenerate against
    // the live site, where the newest run is the one that matters, so a pending run being superseded is fine.
    if ("push" in on && "pull_request" in on && c?.group) {
      const g = (sha) => String(evalTemplate(c.group, context("push", { sha })));
      if (Boolean(evalTemplate(c["cancel-in-progress"] ?? false, context("push")))) flag("concurrency-main", `${f}: a push to main can cancel an in-flight main run`);
      if (g("a") === g("b")) flag("concurrency-main", `${f}: two main pushes share a group, so GitHub evicts the pending one and that commit is never verified`);
    }
  }

  // e2e-paths / e2e-no-main-push
  const e2e = triggersOf(wfs["e2e-statenour.yml"] ?? {});
  const e2ePaths = e2e.pull_request?.paths ?? [];
  const must = [
    ["W2 UI diff", V3_W2_FILES], ["W3a UI diff", V3_W3A_FILES], ["a component", ["apps/statenour/components/x.tsx"]],
    ["a package", ["packages/utils/src/x.ts"]], ["the lockfile", ["pnpm-lock.yaml"]], ["the workflow", [".github/workflows/e2e-statenour.yml"]],
  ];
  for (const [label, files] of must) if (!triggers(e2ePaths, files)) flag("e2e-paths", `e2e would NOT run for ${label} (${files[0]})`);
  const rtDocs = runtimeReadDocs();
  if (rtDocs.length < 5 || !rtDocs.includes("docs/RECONCILIATION.md")) flag("e2e-paths", `the runtime-read doc scan found ${rtDocs.length} docs: the instrument is blind`);
  for (const d of rtDocs) if (!pathMatches(e2ePaths, `apps/statenour/${d}`)) flag("e2e-paths", `apps/statenour/${d} is read at runtime but a diff to it would skip e2e`);
  if (triggers(e2ePaths, DOCS_ONLY_FILES)) flag("e2e-paths", "e2e still runs for a diff that only touches apps/statenour/docs");
  if (triggers(e2ePaths, ["apps/nickstire/server/x.ts", "docs/agent-os/MANAGER-LEDGER.md"])) flag("e2e-paths", "e2e runs for a diff outside statenour");
  if ("push" in e2e) flag("e2e-no-main-push", "e2e-statenour.yml still triggers on push");
  for (const [f, wf] of Object.entries(wfs)) if ("push" in triggersOf(wf) && "e2e" in (wf.jobs ?? {})) flag("e2e-no-main-push", `${f}: has an e2e job on push`);

  // folded-steps: each listed step exists, in exactly one job anywhere
  const where = new Map();
  for (const f of Object.keys(wfs)) for (const [id, job] of jobsOf(f)) for (const s of job.steps ?? []) if (s?.name) where.set(s.name, [...(where.get(s.name) ?? []), `${f}#${id}`]);
  for (const [file, id, list] of [["agent-policy.yml", "policy", POLICY_STEPS], ["adoption-gates.yml", "static-gates", ADOPTION_STEPS], ["test.yml", "node", KNIP_STEPS]]) {
    const mine = new Set((wfs[file]?.jobs?.[id]?.steps ?? []).map((s) => s?.name));
    for (const name of list) {
      if (!mine.has(name)) flag("folded-steps", `${file}#${id} lost step "${name}"`);
      const at = where.get(name) ?? [];
      // knip-orphan-gate has always had a step with the curdate canary's second name; the curdate-gate-is-back
      // check below covers that copy, so this one name is exempt from the cross-job count.
      if (at.length > 1 && !SHARED_NAMES.has(name)) flag("folded-steps", `step "${name}" runs in ${at.length} jobs (${at.join(", ")}): billed twice`);
    }
  }
  // A step that kept its name but lost its command is a dropped check wearing a name: pin the commands.
  const text = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "");
  for (const frag of ["run: node apps/nickstire/scripts/check-capability-ledger.mjs", "git diff --exit-code apps/nickstire/docs/operations/REALITY-LEDGER.md", 'dod-compiler.mjs --base "origin/${{ github.base_ref }}" --enforce', "check-review-gate.mjs ${{ github.event.pull_request.number }} --enforce --skip-ci-check", "detect-contradictions.mjs --pr-body-file /tmp/pr-body.txt --enforce", "gitleaks git . \\", "--exit-code 1 || {", "--config .gitleaks.toml", "run: node scripts/agent-os/check-source-citation.mjs --diff /tmp/pr.diff --body /tmp/pr-body.txt", "run: node scripts/agent-os/verify.mjs"]) {
    if (!text("agent-policy.yml").includes(frag)) flag("folded-steps", `agent-policy.yml no longer runs \`${frag}\``);
  }
  for (const frag of ["run: cd apps/nickstire && node scripts/lint-curdate.mjs", "--package=@ast-grep/cli@0.45.2 dlx ast-grep scan -c config/adoption-gates/sgconfig.yml apps/statenour/app", "dlx depcruise --config config/adoption-gates/.dependency-cruiser.cjs apps/statenour/app"]) {
    if (!text("adoption-gates.yml").includes(frag)) flag("folded-steps", `adoption-gates.yml no longer runs \`${frag}\``);
  }
  // live-pr-body (2026-10-21): the two PR-body gates must read the LIVE body, not the event payload a re-run reuses.
  // The run block is a block scalar the reader above skips, so it is sliced from the raw text; the behaviour of the
  // script it calls is pinned in readPrBody.test.mjs. The event body stays ONLY as the fallback env, never as the file.
  const polText = text("agent-policy.yml");
  for (const name of ["Contradiction detector (claims vs evidence vs ledger vs PR body)", "collect PR diff and body"]) {
    const at = polText.indexOf(`- name: ${name}\n`);
    const block = at < 0 ? "" : polText.slice(at + 1).split(/\n {6}- (?:name|uses):/)[0];
    if (!block) { flag("live-pr-body", `agent-policy.yml has no step "${name}"`); continue; }
    if (!block.includes("node scripts/agent-os/read-pr-body.mjs --out /tmp/pr-body.txt")) flag("live-pr-body", `step "${name}" does not read the live PR body through read-pr-body.mjs`);
    if (/printf '%s' "\$PR_BODY" > \/tmp\/pr-body\.txt/.test(block)) flag("live-pr-body", `step "${name}" still writes the event-payload body straight to /tmp/pr-body.txt`);
    for (const [k, v] of [["GH_TOKEN", "${{ github.token }}"], ["PR_REPO", "${{ github.repository }}"], ["PR_NUMBER", "${{ github.event.pull_request.number }}"], ["PR_BODY", "${{ github.event.pull_request.body }}"]]) {
      if (!block.includes(`${k}: ${v}`)) flag("live-pr-body", `step "${name}" lacks env ${k}: ${v}`);
    }
  }
  if (!existsSync(join(REPO, "scripts", "agent-os", "read-pr-body.mjs"))) flag("live-pr-body", "scripts/agent-os/read-pr-body.mjs is missing: the steps call a script that does not exist");

  // policy-order (Codex review of #3083): a verifier that hits a JOB timeout cancels the whole job, and `!cancelled()` cannot
  // save the gates behind it. So the cheap gates run first and the verifier has its own, smaller STEP timeout.
  const pol = wfs["agent-policy.yml"]?.jobs?.policy;
  const psteps = pol?.steps ?? [];
  const vi = psteps.findIndex((s) => s?.name === "agent-os verify");
  if (vi < 0) flag("policy-order", "agent-policy.yml has no `agent-os verify` step");
  else {
    for (const n of POLICY_STEPS.slice(2)) {
      const i = psteps.findIndex((s) => s?.name === n);
      if (i < 0 || i > vi) flag("policy-order", `"${n}" must run BEFORE agent-os verify (a hung verifier would cancel it)`);
    }
    const stepT = Number(psteps[vi]["timeout-minutes"]);
    if (!(stepT > 0)) flag("policy-order", "the agent-os verify step has no timeout-minutes of its own");
    if (pol["timeout-minutes"] !== undefined && !(Number(pol["timeout-minutes"]) > stepT)) flag("policy-order", "the job timeout is not larger than the verify step's, so the job dies before the step fails");
  }
  // knip stays BLOCKING and keeps its commands inside `node`; the standalone knip jobs are gone.
  for (const frag of ["pnpm dlx knip@6.32.3 --workspace apps/statenour --reporter markdown | tee -a \"$GITHUB_STEP_SUMMARY\"\n", "run: cd apps/nickstire && node scripts/knip-orphan-gate.mjs", "printf '\\nexport function __orphanCanary__() { return 1; }\\n' >> shared/reelScore.ts"]) {
    if (!text("test.yml").includes(frag)) flag("folded-steps", `test.yml no longer runs \`${frag}\``);
  }
  for (const s of wfs["test.yml"]?.jobs?.node?.steps ?? []) {
    if (!KNIP_STEPS.includes(s?.name)) continue;
    const g = String(s.if ?? "");
    if (!g.includes("!cancelled()") || !g.includes("needs.changes.outputs.")) flag("folded-steps", `node step "${s.name}" lost its changes/!cancelled() guard`);
    if (s["continue-on-error"] !== undefined) flag("folded-steps", `node step "${s.name}" is continue-on-error: knip must stay blocking`);
  }
  for (const id of ["knip-advisory", "knip-orphan-gate"]) if (jobsOf("adoption-gates.yml").some(([j]) => j === id)) flag("folded-steps", `adoption-gates.yml: the ${id} job is back next to its folded copy`);
  // The PR-only steps must stay PR-only (they read the PR event) and must not hide each other's failures.
  for (const s of wfs["agent-policy.yml"]?.jobs?.policy?.steps ?? []) {
    if (!POLICY_STEPS.slice(2).includes(s?.name)) continue;
    const g = String(s.if ?? "");
    if (!g.includes("pull_request") || !g.includes("!cancelled()")) flag("folded-steps", `step "${s.name}" is not guarded by pull_request && !cancelled()`);
  }
  for (const gone of ["completion-authority.yml", "secret-scan.yml"]) if (wfs[gone]) flag("folded-steps", `${gone} is back: its job was folded into agent-policy.yml`);
  if (jobsOf("adoption-gates.yml").some(([id]) => id === "curdate-gate")) flag("folded-steps", "adoption-gates.yml: the curdate-gate job is back next to its folded copy");

  // required-context
  const rs = existsSync(join(root, RULESET)) ? JSON.parse(readFileSync(join(root, RULESET), "utf8")) : null;
  const real = new Set();
  for (const [f, wf] of Object.entries(wfs)) for (const [id, job] of jobsOf(f)) real.add(`${wf.name} / ${job.name ?? id}`);
  const required = (rs?.rules ?? []).flatMap((r) => r.parameters?.required_status_checks ?? []).map((c) => c.context);
  if (!required.length) flag("required-context", "the staged ruleset names no required checks (or is missing): this rule would be vacuous");
  for (const ctx of required) if (!real.has(ctx)) flag("required-context", `ruleset requires "${ctx}" but no workflow job reports that name`);

  // adoption-paths
  const adoption = wfs["adoption-gates.yml"] ? triggersOf(wfs["adoption-gates.yml"]) : {};
  if ("push" in adoption) flag("adoption-no-main-push", "adoption-gates.yml triggers on push again (PR only: the PR head already ran it; node covers main)");
  for (const ev of ["pull_request"]) {
    const ig = adoption[ev]?.["paths-ignore"] ?? [];
    if (!ig.length) { flag("adoption-paths", `adoption-gates ${ev} has no paths-ignore, so a docs-only diff still bills the gates`); continue; }
    if (adoption[ev]?.paths) flag("adoption-paths", `adoption-gates ${ev} mixes paths and paths-ignore (GitHub rejects it)`);
    if (!["docs/agent-os/x.md", "apps/statenour/docs/x.md"].every((f) => pathMatches(ig, f))) flag("adoption-paths", `adoption-gates ${ev} does not skip a docs-only diff`);
    for (const f of ADOPTION_SCANNED) if (pathMatches(ig, f)) flag("adoption-paths", `adoption-gates ${ev} ignores ${f}, a path its gates scan`);
  }

  // proof-paths
  const proofPaths = triggersOf(wfs["nickstire-proof.yml"] ?? {}).push?.paths ?? [];
  for (const f of ["apps/nickstire/client/src/x.tsx", "apps/nickstire/server/x.ts", "apps/nickstire/tests/episodes/x.json", ".github/workflows/nickstire-proof.yml"]) {
    if (!pathMatches(proofPaths, f)) flag("proof-paths", `the storefront proof would not run for ${f}`);
  }
  if (triggers(proofPaths, ["apps/nickstire/docs/README.md", "apps/nickstire/docs/x.md", "apps/nickstire/docs/operations/y.json"])) flag("proof-paths", "the storefront proof still runs for an apps/nickstire/docs-only diff");
  // approvedReelPackRotation reads apps/nickstire/docs/reel-packs at runtime: that subtree is not documentation.
  for (const f of ["apps/nickstire/docs/reel-packs/some-pack/brief.json", "apps/nickstire/docs/reel-packs/some-pack/variants/arm-1/brief.json"]) {
    if (!pathMatches(proofPaths, f)) flag("proof-paths", `the storefront proof would not run for a reel-pack diff (${f}); the runtime reads that tree`);
  }

  // notify-pr
  const notifyIf = wfs["test.yml"]?.jobs?.notify?.if;
  if (notifyIf === undefined) flag("notify-pr", "test.yml has no notify job `if`, so it runs and bills on every PR");
  else {
    if (evalIf(notifyIf, context("pull_request"))) flag("notify-pr", "test.yml notify still runs on pull_request");
    if (!evalIf(notifyIf, context("push"))) flag("notify-pr", "test.yml notify no longer runs on a push to main");
  }

  // security-in-node: the dependency gate is the tail of `node`, still blocking, still runs when an earlier step is red
  const nodeSteps = wfs["test.yml"]?.jobs?.node?.steps ?? [];
  const adv = nodeSteps.find((s) => s?.name === "Dependency audit (high+ severity · advisory)");
  const crit = nodeSteps.find((s) => s?.name === "Dependency audit (critical severity · blocking)");
  if (!adv || !crit) flag("security-in-node", "test.yml node lost a dependency audit step");
  else {
    if (adv["continue-on-error"] !== true) flag("security-in-node", "the advisory audit is no longer continue-on-error");
    if (crit["continue-on-error"] !== undefined) flag("security-in-node", "the critical audit is continue-on-error: the dependency gate cannot fail");
    for (const s of [adv, crit]) if (!String(s.if ?? "").includes("!cancelled()")) flag("security-in-node", `"${s.name}" lost !cancelled(): an earlier red step would switch the gate off`);
    // Codex review of #3083: at the tail of a 50-minute job a hung validator starves the gate (the 421-425 failure),
    // so both audits run FIRST, right after the install, each with a step timeout of its own.
    const sweepAt = nodeSteps.findIndex((s) => String(s?.name ?? "").startsWith("Verify affected"));
    for (const s of [adv, crit]) {
      if (sweepAt < 0 || nodeSteps.indexOf(s) > sweepAt) flag("security-in-node", `"${s.name}" must run BEFORE the turbo sweep, not behind a step that can hang`);
      if (!(Number(s["timeout-minutes"]) > 0)) flag("security-in-node", `"${s.name}" has no step timeout of its own`);
    }
  }
  if (!text("test.yml").includes("run: node scripts/audit-advisories.mjs --audit-level=critical\n")) flag("security-in-node", "test.yml no longer runs audit-advisories at --audit-level=critical");
  if (wfs["test.yml"]?.jobs?.security) flag("security-in-node", "a standalone security job is back next to its folded copy");

  // needs-resolve: a `needs:` naming a job that is gone invalidates the whole workflow file
  for (const [f, w] of Object.entries(wfs)) {
    for (const [id, job] of Object.entries(w.jobs ?? {})) {
      for (const n of [].concat(job.needs ?? [])) if (!(n in w.jobs)) flag("needs-resolve", `${f}#${id} needs "${n}", which is not a job in that file`);
    }
  }

  // node-filter (Codex review of #3083): the blocking dependency scanner and everything it imports must select `node`.
  // The closure is READ from the real source, so a new import in the scanner cannot drift out of the filter.
  const m = /\n {12}node:\n((?: {14}.*\n)+)/.exec(text("test.yml"));
  const nodeFilter = m ? m[1].split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- ")).map((l) => l.slice(2).replace(/^['"]|['"]$/g, "")) : [];
  if (!nodeFilter.length) flag("node-filter", "could not read the `node` path filter in test.yml");
  const closure = (rel, seen = new Set()) => {
    if (seen.has(rel)) return seen;
    seen.add(rel);
    const src = readFileSync(join(REPO, rel), "utf8");
    for (const [, spec] of src.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) closure(join(dirname(rel), spec).split("\\").join("/"), seen);
    return seen;
  };
  for (const f of closure("scripts/audit-advisories.mjs")) if (!pathMatches(nodeFilter, f)) flag("node-filter", `a diff touching ${f} would skip node, and with it the dependency audit`);
  for (const f of ["apps/statenour/components/x.tsx", "pnpm-lock.yaml", "packages/utils/src/x.ts"]) if (!pathMatches(nodeFilter, f)) flag("node-filter", `node no longer selects ${f}`);
  for (const f of ["README.md", "docs/agent-os/x.md"]) if (pathMatches(nodeFilter, f)) flag("node-filter", `node selects ${f}: a docs-only diff would run the full sweep`);

  // diag-no-pr
  const diag = triggersOf(wfs["admin-completion-diagnostic.yml"] ?? {});
  if ("pull_request" in diag) flag("diag-no-pr", "the always-green admin typecheck diagnostic runs on every PR again");

  return bad;
}

// ── the tests ────────────────────────────────────────────────────────────────────────────────────────────────

function copyTree() {
  const root = mkdtempSync(join(tmpdir(), "wf-cost-"));
  cpSync(join(REPO, ".github", "workflows"), join(root, ".github", "workflows"), { recursive: true });
  mkdirSync(join(root, "config", "agent-os"), { recursive: true });
  cpSync(join(REPO, RULESET), join(root, RULESET));
  return root;
}
const edit = (root, rel, fn) => {
  const p = join(root, rel);
  const before = existsSync(p) ? readFileSync(p, "utf8") : "";
  const after = fn(before);
  assert.notEqual(after, before, `mutant did not change ${rel} - the mutation is vacuous`);
  writeFileSync(p, after);
};
const wf = (n) => join(".github", "workflows", n);

test("the instrument sees its target: parser, evaluator and glob matcher on known inputs", () => {
  const w = parseWorkflow(readFileSync(join(REPO, ".github", "workflows", "agent-policy.yml"), "utf8"));
  assert.equal(w.name, "Agent policy");
  assert.deepEqual(w.on.pull_request.branches, ["main"]);
  assert.ok(Array.isArray(w.jobs.policy.steps) && w.jobs.policy.steps.length >= 2, "the policy job's steps were not parsed");
  assert.ok(w.jobs.policy.steps.some((s) => s.name === "decide live canaries (git diff, no API)"), "a named step was not parsed");
  assert.match(w.jobs.policy.steps[0].uses, /^actions\/checkout@[0-9a-f]{40}$/, "a `- uses:` step item was not parsed");
  assert.equal(w.jobs.policy.steps[0].with["fetch-depth"], "0");
  assert.ok(readdirSync(join(REPO, ".github", "workflows")).length >= 15, "fewer workflows than expected: wrong directory");
  assert.equal(evalTemplate("g-${{ github.event.pull_request.number || github.ref }}", context("pull_request")), "g-7");
  assert.equal(evalTemplate("g-${{ github.event.pull_request.number || github.ref }}", context("push")), "g-refs/heads/main");
  assert.throws(() => evalTemplate("${{ github.nope.deeper }}", context("push")), "an unknown context must throw, not read as empty");
  assert.ok(pathMatches(["a/**", "!a/docs/**"], "a/b/c.ts") && !pathMatches(["a/**", "!a/docs/**"], "a/docs/c.md"));
  assert.ok(pathMatches(["**/*.md"], "docs/x/y.md") && !pathMatches(["**/*.md"], "docs/x/y.ts"));
  assert.ok(pathMatches(["apps/statenour/**"], "apps/statenour/app/(mastery)/missions/page.tsx"), "parenthesised route dir");
});

test("positive control: the live workflows satisfy every cost guard", () => {
  assert.deepEqual(checkWorkflows(REPO), []);
});

const MUTANTS = [
  ["concurrency-pr", "a PR workflow loses its concurrency block", wf("evaluator-separation.yml"), (t) => t.replace(/\nconcurrency:\n(?: {2}.*\n)+/, "\n")],
  ["concurrency-pr", "a PR run no longer cancels the superseded one", wf("docker-context-gate.yml"), (t) => t.replace("cancel-in-progress: true", "cancel-in-progress: false")],
  ["concurrency-pr", "two PRs share one group", wf("container-scan.yml"), (t) => t.replace("container-scan-${{ github.ref }}", "container-scan")],
  ["concurrency-main", "a push to main can cancel a main run (the old agent-policy shape)", wf("agent-policy.yml"),
    (t) => t.replace(/group: .*\n\s*cancel-in-progress: .*/, "group: agent-policy-${{ github.ref }}\n  cancel-in-progress: true")],
  ["concurrency-main", "two main pushes share a group (the old camera-bridge shape)", wf("camera-bridge.yml"),
    (t) => t.replace(/group: .*\n\s*cancel-in-progress: .*/, "group: camera-bridge-${{ github.ref }}\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}")],
  ["e2e-paths", "e2e runs for docs-only diffs again", wf("e2e-statenour.yml"), (t) => t.replace("      - '!apps/statenour/docs/**'\n", "")],
  ["e2e-paths", "a runtime-read doc drops out of the re-include", wf("e2e-statenour.yml"), (t) => t.replace("      - 'apps/statenour/docs/RECONCILIATION.md'\n", "")],
  ["e2e-paths", "e2e stops running for statenour code", wf("e2e-statenour.yml"), (t) => t.replace("  pull_request:\n    paths:\n      - 'apps/statenour/**'\n", "  pull_request:\n    paths:\n")],
  ["e2e-no-main-push", "e2e is back on push to main", wf("e2e-statenour.yml"), (t) => t.replace("  workflow_dispatch:", "  push:\n    branches: [main]\n  workflow_dispatch:")],
  ["folded-steps", "a folded step is renamed away", wf("agent-policy.yml"), (t) => t.replace("name: Install gitleaks", "name: Install g1tleaks")],
  ["folded-steps", "the secret scan keeps its name but can no longer fail", wf("agent-policy.yml"), (t) => t.replace("--exit-code 1 || {", "--exit-code 0 || {")],
  ["folded-steps", "the review gate keeps its name but stops enforcing", wf("agent-policy.yml"), (t) => t.replace("check-review-gate.mjs ${{ github.event.pull_request.number }} --enforce", "check-review-gate.mjs ${{ github.event.pull_request.number }}")],
  ["folded-steps", "a PR-only step loses its guard and would run on main pushes", wf("agent-policy.yml"),
    (t) => t.replace("      - name: check source citation\n        if: ${{ github.event_name == 'pull_request' && !cancelled() }}\n", "      - name: check source citation\n")],
  ["live-pr-body", "the contradiction step goes back to the frozen event body", wf("agent-policy.yml"),
    (t) => t.replace("node scripts/agent-os/read-pr-body.mjs --out /tmp/pr-body.txt\n          node apps/nickstire/scripts/detect-contradictions.mjs", "printf '%s' \"$PR_BODY\" > /tmp/pr-body.txt\n          node apps/nickstire/scripts/detect-contradictions.mjs")],
  ["live-pr-body", "the citation step goes back to the frozen event body", wf("agent-policy.yml"),
    (t) => t.replace("node scripts/agent-os/read-pr-body.mjs --out /tmp/pr-body.txt\n          wc -l", "printf '%s' \"$PR_BODY\" > /tmp/pr-body.txt\n          wc -l")],
  ["live-pr-body", "the citation step loses its token, so the live read cannot authenticate", wf("agent-policy.yml"),
    (t) => t.replace("          GH_TOKEN: ${{ github.token }}\n          PR_REPO: ${{ github.repository }}\n          PR_NUMBER: ${{ github.event.pull_request.number }}\n          PR_BODY: ${{ github.event.pull_request.body }}\n          BASE_REF", "          PR_REPO: ${{ github.repository }}\n          PR_NUMBER: ${{ github.event.pull_request.number }}\n          PR_BODY: ${{ github.event.pull_request.body }}\n          BASE_REF")],
  ["live-pr-body", "the contradiction step loses its fallback body", wf("agent-policy.yml"),
    (t) => t.replace(/(Contradiction detector[^\n]*\n(?: {8}.*\n)*?) {10}PR_BODY: .*\n/, "$1")],
  ["folded-steps", "the folded curdate gate is neutered", wf("adoption-gates.yml"), (t) => t.replace("run: cd apps/nickstire && node scripts/lint-curdate.mjs", "run: cd apps/nickstire && true")],
  ["folded-steps", "the secret-scan workflow comes back beside its folded copy", wf("secret-scan.yml"),
    () => "name: Secret Scanning\non:\n  pull_request:\n    branches: [main]\njobs:\n  gitleaks:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Install gitleaks\n        run: true\n"],
  ["folded-steps", "a knip step in node is renamed away", wf("test.yml"), (t) => t.replace("name: gate - no NEW unconsumed exports, files, or scripts", "name: gate - nothing")],
  ["folded-steps", "the knip census gate stops failing (|| true)", wf("test.yml"), (t) => t.replace("--reporter markdown | tee -a \"$GITHUB_STEP_SUMMARY\"", "--reporter markdown | tee -a \"$GITHUB_STEP_SUMMARY\" || true")],
  ["folded-steps", "the orphan gate loses its guard", wf("test.yml"), (t) => t.replace("      - name: gate - no NEW unconsumed exports, files, or scripts\n        if: ${{ !cancelled() && (needs.changes.outputs.nickstire == 'true' || needs.changes.outputs.workflow == 'true') }}\n", "      - name: gate - no NEW unconsumed exports, files, or scripts\n")],
  ["folded-steps", "the knip-orphan-gate job comes back", wf("adoption-gates.yml"), (t) => t.replace(/\njobs:\n/, "\njobs:\n  knip-orphan-gate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n")],
  ["folded-steps", "the curdate job comes back", wf("adoption-gates.yml"), (t) => t.replace(/\njobs:\n/, "\njobs:\n  curdate-gate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n")],
  ["required-context", "the required job is renamed and the ruleset is not", wf("agent-policy.yml"), (t) => t.replace("name: parity, canaries, authority, secrets, citation", "name: something else")],
  ["required-context", "the ruleset still requires the folded-away check", RULESET,
    (t) => t.replace('"required_status_checks": [', '"required_status_checks": [\n          { "context": "Completion Authority / completion-authority" },')],
  ["adoption-no-main-push", "adoption-gates runs on push to main again", wf("adoption-gates.yml"), (t) => t.replace("  workflow_dispatch:", "  push:\n    branches: [main]\n  workflow_dispatch:")],
  ["adoption-paths", "the adoption gates stop skipping docs", wf("adoption-gates.yml"), (t) => t.replace(/ {4}paths-ignore:\n( {6}- .*\n)+/g, "")],
  ["adoption-paths", "the adoption gates ignore a directory they scan", wf("adoption-gates.yml"), (t) => t.replace(/( {4}paths-ignore:\n)/, "$1      - 'apps/statenour/components/**'\n")],
  ["proof-paths", "the storefront proof runs for docs-only diffs again", wf("nickstire-proof.yml"), (t) => t.replace(/ {6}- "!apps\/nickstire\/docs\/\*\*"\n/, "")],
  ["proof-paths", "the reel-pack re-include is dropped", wf("nickstire-proof.yml"), (t) => t.replace(/ {6}- "apps\/nickstire\/docs\/reel-packs\/\*\*"\n/, "")],
  ["policy-order", "the verifier moves ahead of the PR gates", wf("agent-policy.yml"), (t) => {
    const i = t.indexOf("      - name: agent-os verify\n");
    const block = t.slice(i);
    return t.slice(0, i).replace("      - name: Validate capability ledger (evidence-gated states)\n", block + "\n      - name: Validate capability ledger (evidence-gated states)\n");
  }],
  ["policy-order", "the verify step loses its own timeout", wf("agent-policy.yml"), (t) => t.replace("        timeout-minutes: 8\n", "")],
  ["policy-order", "the job timeout shrinks below the step's", wf("agent-policy.yml"), (t) => t.replace(/timeout-minutes: 15 #.*\n/, "timeout-minutes: 5\n")],
  ["node-filter", "the scanner itself drops out of the node filter", wf("test.yml"), (t) => t.replace("              - 'scripts/audit-advisories.mjs'\n", "")],
  ["node-filter", "the scanner's import drops out of the node filter", wf("test.yml"), (t) => t.replace("              - 'scripts/lib/advisory-fetch.mjs'\n", "")],
  ["notify-pr", "notify bills on every PR again", wf("test.yml"), (t) => t.replace(/(\n {2}notify:\n(?: {4}.*\n)*? {4}if: ).*/, "$1always()")],
  ["needs-resolve", "notify still needs the deleted security job", wf("test.yml"), (t) => t.replace("needs: [changes, node, railway-smoke]", "needs: [changes, node, security, railway-smoke]")],
  ["security-in-node", "the critical audit can no longer fail", wf("test.yml"), (t) => t.replace("      - name: Dependency audit (critical severity · blocking)\n", "      - name: Dependency audit (critical severity · blocking)\n        continue-on-error: true\n")],
  ["security-in-node", "an earlier red step switches the audit off", wf("test.yml"), (t) => t.replace("      - name: Dependency audit (critical severity · blocking)\n        if: ${{ !cancelled() }}\n", "      - name: Dependency audit (critical severity · blocking)\n")],
  ["security-in-node", "the audits move back to the tail of node", wf("test.yml"), (t) => {
    const a = t.indexOf("      - name: Dependency audit (high+ severity");
    const b = t.indexOf("      - name: Ensure base ref");
    const block = t.slice(a, b);
    return (t.slice(0, a) + t.slice(b)).replace("\n  railway-smoke:\n", "\n" + block + "\n  railway-smoke:\n");
  }],
  ["security-in-node", "the critical audit loses its step timeout", wf("test.yml"), (t) => t.replace("      - name: Dependency audit (critical severity · blocking)\n        if: ${{ !cancelled() }}\n        timeout-minutes: 5\n", "      - name: Dependency audit (critical severity · blocking)\n        if: ${{ !cancelled() }}\n")],
  ["security-in-node", "the audit step is renamed away", wf("test.yml"), (t) => t.replace("Dependency audit (high+ severity · advisory)", "Dependency audit (high+)")],
  ["security-in-node", "a standalone security job comes back", wf("test.yml"), (t) => t.replace("\n  railway-smoke:\n", "\n  security:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n\n  railway-smoke:\n")],
  ["diag-no-pr", "the diagnostic is back on every PR", wf("admin-completion-diagnostic.yml"), (t) => t.replace("on:\n", "on:\n  pull_request:\n    branches: [main]\n")],
];

for (const [rule, label, rel, fn] of MUTANTS) {
  test(`canary [${rule}]: ${label}`, () => {
    const root = copyTree();
    try {
      edit(root, rel, fn);
      const found = checkWorkflows(root);
      assert.ok(found.some((b) => b.rule === rule), `rule ${rule} did not fire; got ${JSON.stringify(found)}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
