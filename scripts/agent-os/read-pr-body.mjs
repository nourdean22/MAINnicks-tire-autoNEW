#!/usr/bin/env node
/**
 * Write the CURRENT pull-request body to a file, for the agent-policy gates that read it
 * (contradiction detector, source citation).
 *
 * Why: `${{ github.event.pull_request.body }}` is frozen in the event payload. A re-run of a job reuses
 * that payload, so editing the body to add a citation changed nothing until the PR was closed and
 * reopened (PR 3194, 2026-10-21: a full extra CI run). This asks the API for the live body instead.
 *
 * Source order: live API, then the event payload copy passed in PR_BODY. The fallback is never an empty
 * file unless the payload body itself is empty. The source used is always printed.
 *
 * Usage:  node scripts/agent-os/read-pr-body.mjs --out /tmp/pr-body.txt
 * Env:    GH_TOKEN, PR_REPO (owner/name), PR_NUMBER, PR_BODY (event payload body)
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * @param {{ repo?: string, number?: string, eventBody?: string, runGh?: (args: string[]) => string }} o
 * @returns {{ body: string, source: "live-api" | "event-payload", note: string }}
 */
export function resolvePrBody({ repo, number, eventBody = "", runGh = defaultRunGh }) {
  if (repo && number) {
    try {
      const live = runGh(["api", `repos/${repo}/pulls/${number}`, "--jq", '.body // ""']);
      // --jq prints one trailing newline after the string; the body itself is everything before it.
      return { body: live.replace(/\n$/, ""), source: "live-api", note: `repos/${repo}/pulls/${number}` };
    } catch (e) {
      return { body: eventBody, source: "event-payload", note: `live read failed (${String(e?.message ?? e).split("\n")[0]}); an edited body is NOT seen` };
    }
  }
  return { body: eventBody, source: "event-payload", note: "PR_REPO or PR_NUMBER missing; an edited body is NOT seen" };
}

function defaultRunGh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--out");
  const out = i > 0 ? process.argv[i + 1] : undefined;
  if (!out) {
    console.error("usage: read-pr-body.mjs --out <file>");
    process.exit(2);
  }
  const r = resolvePrBody({ repo: process.env.PR_REPO, number: process.env.PR_NUMBER, eventBody: process.env.PR_BODY ?? "" });
  writeFileSync(out, r.body);
  console.log(`PR body source: ${r.source} (${r.note}); ${r.body.length} chars -> ${out}`);
}
