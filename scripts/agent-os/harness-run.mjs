#!/usr/bin/env node
/**
 * harness-run: a Claude session (or Nour) asks one of the PCs to run an allowlisted action, and reads
 * the result back (job 2026-11-06-harness-control-nick-node).
 *
 *   node scripts/agent-os/harness-run.mjs --list
 *   node scripts/agent-os/harness-run.mjs --pc nattynour --action pc-status [--reason "why"] [--wait [seconds]]
 *   node scripts/agent-os/harness-run.mjs --result <id>
 *
 * Exit code: 0 DONE, 3 FINDINGS (ran and reported problems), 1 FAILED / EXPIRED / LOST, 2 not finished yet.
 *
 * Only names in config/agent-os/harness-actions.json exist; there is no way to pass a command. The PC's
 * poller (harness-poll.mjs) runs it on its next check-in, 1-2 minutes, and an action no PC picks up in
 * 10 minutes expires instead of running late. Key: controlKey in %LOCALAPPDATA%/nourcity/harness-snapshot.json
 * (or HARNESS_CONTROL_KEY); bdnick checks it, and every request and result is an audit row there.
 */
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { checkUrl, loadAllowlist, readConfig } from "./harness-poll.mjs";

const TERMINAL = new Set(["DONE", "FINDINGS", "FAILED", "EXPIRED", "LOST"]);
/** Exit code for a caller that gates on $?: 0 DONE, 3 FINDINGS, 1 FAILED/EXPIRED/LOST, 2 not finished yet. */
export const exitFor = (state) => (state === "DONE" ? 0 : state === "FINDINGS" ? 3 : TERMINAL.has(state) ? 1 : 2);

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--list") out.list = true;
    else if (a === "--pc") out.pc = argv[++i];
    else if (a === "--action") out.action = argv[++i];
    else if (a === "--reason") out.reason = argv[++i];
    else if (a === "--result") out.result = argv[++i];
    else if (a === "--wait") out.wait = /^\d+$/.test(argv[i + 1] ?? "") ? Number(argv[++i]) : 180;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

/** The same allowlist the PCs run from: a typo fails here, before anything is sent. */
export function checkLocally(allowlist, pc, action) {
  if (!Object.keys(allowlist.pcs).includes(pc)) return `unknown PC "${pc}": one of ${Object.keys(allowlist.pcs).join(", ")}`;
  if (!Object.prototype.hasOwnProperty.call(allowlist.actions, action)) return `unknown action "${action}": run --list`;
  if (!allowlist.actions[action].pcs.includes(pc)) return `${action} is not allowed on ${pc}`;
  if (allowlist.actions[action].needsGo !== false) return `${action} needs Nour's go`;
  return null;
}

async function api(config, method, path, body, doFetch) {
  const res = await doFetch(`${checkUrl(config.url)}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-harness-control-key": config.key },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`bdnick said HTTP ${res.status}${json?.error ? `: ${String(json.error).slice(0, 160)}` : ""}`);
  return json?.data ?? json;
}

export const describeAction = (a) =>
  [
    `${a.id}  ${a.action} on ${a.pc}: ${a.state}`,
    a.exitCode !== null && a.exitCode !== undefined ? `exit ${a.exitCode}` : null,
    a.finishedAt ? `finished ${a.finishedAt}` : a.claimedAt ? `claimed ${a.claimedAt}` : `expires ${a.expiresAt}`,
    a.error ? `error: ${a.error}` : null,
    a.output ? `--- output ---\n${a.output}` : null,
  ]
    .filter(Boolean)
    .join("\n");

/** Returns { text, code }: code is the exit status a caller can gate on (exitFor). */
export async function run(
  opts,
  { config = readConfig(), allowlist = loadAllowlist(), doFetch = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), note = (t) => console.error(t) } = {},
) {
  if (opts.list) {
    const text = Object.entries(allowlist.actions)
      .map(([name, a]) => `${name}  [${a.pcs.join(", ")}]${a.needsGo !== false ? " needs Nour's go" : ""}\n  ${a.summary}`)
      .join("\n");
    return { text, code: 0 };
  }
  if (!config.key) throw new Error("no control key: set controlKey in nourcity/harness-snapshot.json or HARNESS_CONTROL_KEY");
  if (opts.result) {
    const a = (await api(config, "GET", `/api/devices/harness/actions?id=${encodeURIComponent(opts.result)}`, null, doFetch)).action;
    return { text: describeAction(a), code: exitFor(a.state) };
  }
  if (!opts.pc || !opts.action) throw new Error("need --pc and --action (or --list, or --result <id>)");
  const bad = checkLocally(allowlist, opts.pc, opts.action);
  if (bad) throw new Error(bad);
  const queued = await api(
    config,
    "POST",
    "/api/devices/harness/actions",
    { pc: opts.pc, action: opts.action, requestKey: `rk_${randomUUID().replace(/-/g, "")}`, ...(opts.reason ? { reason: opts.reason.slice(0, 200) } : {}), ...(config.pc ? { from: config.pc } : {}) },
    doFetch,
  );
  let action = queued.action;
  // Printed at once, so a wait that dies on a network error still leaves the id to read later.
  note(`[harness-run] queued ${action.id} (${action.action} on ${action.pc}); read it with --result ${action.id}`);
  const deadline = Date.now() + (opts.wait ?? 0) * 1000;
  while (opts.wait && !TERMINAL.has(action.state) && Date.now() < deadline) {
    await sleep(5_000);
    action = (await api(config, "GET", `/api/devices/harness/actions?id=${encodeURIComponent(action.id)}`, null, doFetch)).action;
  }
  const text = describeAction(action) + (TERMINAL.has(action.state) ? "" : `\nstill ${action.state}: read it later with --result ${action.id}`);
  return { text, code: exitFor(action.state) };
}

if (process.argv[1] && basename(process.argv[1]) === "harness-run.mjs") {
  run(parseArgs(process.argv.slice(2)))
    .then(({ text, code }) => {
      console.log(text);
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`[harness-run] ${err?.message ?? err}`);
      process.exitCode = 1;
    });
}
