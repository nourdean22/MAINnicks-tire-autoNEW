#!/usr/bin/env node
/**
 * Night Shift identity preflight — the credential-level boundary (2026-09-15).
 *
 * The PreToolUse rules (night-shift-no-merge etc.) are defence in depth: they
 * run inside ONE agent harness and stop a spelling of "merge", not the ability.
 * The boundary that survives any prompt is an identity that structurally
 * cannot land a change on main. This script decides, before the headless agent
 * starts, whether the identity behind NIGHT_SHIFT_GH_TOKEN is such an identity.
 *
 *   node scripts/night-shift/identity-preflight.mjs            # exit 0 = go, 2 = refuse
 *   node scripts/night-shift/identity-preflight.mjs --json     # the verdict as JSON
 *
 * What is checked, in order, all with the OPERATOR's gh (run.ps1 runs as the
 * operator; only the child claude process receives the Night Shift token):
 *   1. NIGHT_SHIFT_GH_TOKEN is set.
 *   2. `gh api user` under that token resolves to a login that is NOT the
 *      operator's — the same keyring identity would make the boundary a fiction.
 *   3. That login's permission on the repo (collaborators/{login}/permission):
 *        read | triage  → cannot push here at all; the run pushes to the identity's
 *                          FORK and opens a cross-repo PR (mode "fork"). This is the
 *                          only structural boundary available on the GitHub Free
 *                          plan: rulesets and branch protection on a private repo
 *                          need GitHub Pro (the API answers 403 here today).
 *        write          → can push branches AND merge, unless a repository ruleset
 *                          restricts updates to main and does not bypass this actor;
 *                          accepted only when such a ruleset is ACTIVE (mode "branch").
 *        admin | maintain → refused, always.
 *
 * The decision is a pure function (judgeIdentity) so scripts/agent-os canaries
 * can break it; the CLI only gathers inputs.
 */
import { spawnSync } from "node:child_process";

export const REPO = "nourdean22/MAINnicks-tire-autoNEW";

/**
 * @param {object} facts
 * @param {string} facts.operatorLogin   login of the account run.ps1 runs as
 * @param {string|null} facts.nsLogin    login resolved from NIGHT_SHIFT_GH_TOKEN (null = token missing/invalid)
 * @param {string|null} facts.permission read | triage | write | maintain | admin | none | null (unreadable)
 * @param {{status:"active"|"disabled"|"evaluate"|"absent"|"unavailable", restrictsMainUpdates?: boolean, bypassesActor?: boolean}} facts.mainRuleset
 * @returns {{ok: boolean, mode: "fork"|"branch"|null, reasons: string[]}}
 */
export function judgeIdentity(facts) {
  const reasons = [];
  const { operatorLogin, nsLogin, permission, mainRuleset } = facts;
  if (!nsLogin) reasons.push("NIGHT_SHIFT_GH_TOKEN is missing or does not resolve to a GitHub login");
  else if (nsLogin.toLowerCase() === String(operatorLogin).toLowerCase()) {
    reasons.push(`the Night Shift token resolves to the operator's own identity (${nsLogin}); a boundary against yourself is a fiction`);
  }
  let mode = null;
  switch (permission) {
    case "read":
    case "triage":
      mode = "fork";
      break;
    case "write": {
      const r = mainRuleset ?? { status: "unavailable" };
      if (r.status === "active" && r.restrictsMainUpdates && !r.bypassesActor) mode = "branch";
      else if (r.status === "unavailable") reasons.push("write permission with no structural guard: rulesets are unavailable on this plan (private repo needs GitHub Pro) — grant the identity read/triage and use the fork flow instead");
      else reasons.push(`write permission but no ACTIVE ruleset restricting updates to main for this actor (ruleset: ${r.status}${r.bypassesActor ? ", actor bypasses it" : ""})`);
      break;
    }
    case "admin":
    case "maintain":
      reasons.push(`the Night Shift identity has ${permission} on the repo; it could merge anything it proposes`);
      break;
    case "none":
      reasons.push("the Night Shift identity has no access to the repo; it cannot even fork it");
      break;
    default:
      reasons.push("could not read the identity's repository permission");
  }
  return { ok: reasons.length === 0 && mode !== null, mode: reasons.length === 0 ? mode : null, reasons };
}

function gh(args, env = {}) {
  const r = spawnSync("gh", args, { encoding: "utf8", env: { ...process.env, ...env }, shell: process.platform === "win32" });
  return { status: r.status ?? 1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

export function gatherFacts() {
  const token = process.env.NIGHT_SHIFT_GH_TOKEN;
  // The operator's identity: the keyring this process runs under (GH_TOKEN deliberately unset).
  const op = gh(["api", "user", "--jq", ".login"], { GH_TOKEN: "", GITHUB_TOKEN: "" });
  const operatorLogin = op.status === 0 ? op.out : "";
  let nsLogin = null;
  if (token) {
    const me = gh(["api", "user", "--jq", ".login"], { GH_TOKEN: token, GITHUB_TOKEN: "" });
    if (me.status === 0 && me.out) nsLogin = me.out;
  }
  let permission = null;
  if (nsLogin) {
    const p = gh(["api", `repos/${REPO}/collaborators/${nsLogin}/permission`, "--jq", ".permission"], { GH_TOKEN: "", GITHUB_TOKEN: "" });
    permission = p.status === 0 ? p.out : p.err.includes("404") ? "none" : null;
  }
  const rs = gh(["api", `repos/${REPO}/rulesets?includes_parents=false`], { GH_TOKEN: "", GITHUB_TOKEN: "" });
  let mainRuleset = { status: "unavailable" };
  if (rs.status === 0) {
    try {
      const list = JSON.parse(rs.out);
      const named = list.find((x) => x.name === "night-shift-boundary");
      mainRuleset = named ? { status: named.enforcement, restrictsMainUpdates: true, bypassesActor: false } : { status: "absent" };
    } catch {
      mainRuleset = { status: "unavailable" };
    }
  }
  return { operatorLogin, nsLogin, permission, mainRuleset };
}

if (process.argv[1] && /identity-preflight\.mjs$/.test(process.argv[1])) {
  const facts = gatherFacts();
  const verdict = judgeIdentity(facts);
  const report = { ...verdict, operatorLogin: facts.operatorLogin, nsLogin: facts.nsLogin, permission: facts.permission, ruleset: facts.mainRuleset.status };
  if (process.argv.includes("--json")) console.log(JSON.stringify(report));
  else {
    console.log(`night-shift identity: ${verdict.ok ? "GO" : "REFUSED"} (operator=${facts.operatorLogin || "?"} nightShift=${facts.nsLogin ?? "-"} permission=${facts.permission ?? "-"} ruleset=${facts.mainRuleset.status} mode=${verdict.mode ?? "-"})`);
    for (const r of verdict.reasons) console.log("  - " + r);
  }
  process.exit(verdict.ok ? 0 : 2);
}
