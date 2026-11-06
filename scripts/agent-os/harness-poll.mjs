#!/usr/bin/env node
/**
 * harness-poll: this PC runs the allowlisted actions bdnick queued for it (job 2026-11-06-harness-control-nick-node).
 *
 *   node scripts/agent-os/harness-poll.mjs              claim one action, run it, post the result (the scheduled task)
 *   node scripts/agent-os/harness-poll.mjs --pc-status  the pc-status action itself: RAM, uptime, heavy slot, snapshot failure
 *   node scripts/agent-os/harness-poll.mjs --allowed    print what this PC would run; contacts nothing
 *
 * What it can do is exactly config/agent-os/harness-actions.json in THIS checkout: a claimed action is a
 * NAME, and the argv comes from that file, never from bdnick. A name the file does not list for this PC,
 * or one that needs Nour's go, is refused here and the refusal is posted as the result. No shell is used.
 *
 * Machine-local config, outside the repo: %LOCALAPPDATA%/nourcity/harness-snapshot.json, the snapshot's
 * file plus one field: { "pc": ..., "url": ..., "controlKey": "<HARNESS_CONTROL_KEY>" }. HARNESS_PC,
 * HARNESS_CONTROL_KEY and HARNESS_URL override it. Schedule: scripts/register-harness-poll-task.ps1.
 * Canary: harnessPoll.test.mjs (a child-process stub of the door, not in-process).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, uptime } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFreeMb, readLock, staleReason } from "./heavy.mjs";
import { scrub } from "./harness-snapshot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const ALLOWLIST = join(REPO, "config", "agent-os", "harness-actions.json");
const DEFAULT_URL = "https://bdnick.info";
const SERVER_OUTPUT_MAX = 16_384;
// Token shapes that must never leave the PC in an output, whatever printed them. The last arm needs an
// upper-case letter and a digit, so a lower-case git SHA (which these outputs are full of) survives.
const SECRETISH =
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\b(?=[A-Za-z0-9+/_-]*[A-Z])(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{40,}={0,2}/g;

export const loadAllowlist = (file = ALLOWLIST) => JSON.parse(readFileSync(file, "utf8"));

/** The local decision. bdnick already checked; this check is the one that cannot be bypassed from bdnick. */
export function localDecision(allowlist, pc, name) {
  const actions = allowlist?.actions ?? {};
  if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(actions, name)) {
    return { ok: false, reason: `refused here: "${String(name).slice(0, 40)}" is not in this PC's allowlist` };
  }
  const a = actions[name];
  if (!Array.isArray(a.pcs) || !a.pcs.includes(pc)) return { ok: false, reason: `refused here: ${name} is not allowed on ${pc}` };
  if (a.needsGo !== false) return { ok: false, reason: `refused here: ${name} needs Nour's go` };
  if (!Array.isArray(a.argv) || a.argv.length === 0 || !a.argv.every((p) => typeof p === "string")) {
    return { ok: false, reason: `refused here: ${name} has no usable argv` };
  }
  const cap = Math.min(Number(allowlist.pcs?.[pc]?.maxOutputBytes) || 8192, SERVER_OUTPUT_MAX);
  return { ok: true, argv: a.argv, timeoutSec: Number(a.timeoutSec) || 60, maxOutputBytes: cap };
}

/** Paths, addresses, token shapes and the control key itself come out; then the byte cap, keeping the tail. */
export function trimOutput(text, maxBytes, secrets = []) {
  let out = String(text ?? "");
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("[key]");
  out = out.replace(SECRETISH, "[redacted]");
  out = scrub(out, Number.MAX_SAFE_INTEGER);
  const buf = Buffer.from(out, "utf8");
  if (buf.length <= maxBytes) return out;
  // The end of a run (the summary line, the error) matters more than its start.
  const marker = "[...cut to fit...]\n";
  let tail = buf.subarray(buf.length - (maxBytes - marker.length)).toString("utf8");
  // A cut inside a multi-byte character decodes to U+FFFD (3 bytes): drop leading characters until it fits.
  while (Buffer.byteLength(marker + tail, "utf8") > maxBytes) tail = tail.slice(1);
  return marker + tail;
}

// Keys a child never inherits: the control key, and the snapshot keys that sit in the same config file.
const KEY_ENV = ["HARNESS_CONTROL_KEY", "HARNESS_KEY", "DEVICE_AGENT_KEY", "STATENOUR_SYNC_KEY"];

/** A Windows crash exits with an NTSTATUS code above int32 (0xC0000005 = 3221225477); fold it so it fits. */
export const toInt32 = (status) => (typeof status === "number" ? (status > 0x7fffffff ? status - 2 ** 32 : status) : null);

/** Runs argv with no shell, from this checkout, without any harness key in its environment. */
export function runAction(decision, { secrets = [], cwd = REPO } = {}) {
  const [cmd, ...args] = decision.argv;
  const env = { ...process.env };
  for (const k of KEY_ENV) delete env[k];
  const startedAt = new Date().toISOString();
  const r = spawnSync(cmd === "node" ? process.execPath : cmd, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: decision.timeoutSec * 1000,
    windowsHide: true,
    shell: false,
    maxBuffer: 4 * 1024 * 1024,
  });
  const finishedAt = new Date().toISOString();
  const timedOut = r.error?.code === "ETIMEDOUT" || r.signal === "SIGTERM";
  const error = r.error ? (timedOut ? `timed out after ${decision.timeoutSec} s` : scrub(r.error.message, 400)) : null;
  return {
    exitCode: toInt32(r.status),
    output: trimOutput(`${r.stdout ?? ""}${r.stderr ? `\n[stderr]\n${r.stderr}` : ""}`, decision.maxOutputBytes, secrets),
    error,
    startedAt,
    finishedAt,
  };
}

/** The key only travels over https (or to this machine), and never follows a redirect to another host. */
export function checkUrl(url) {
  const u = new URL(url);
  const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  if (u.protocol !== "https:" && !local) throw new Error(`refusing to send the control key to a non-https URL (${u.protocol}//${u.hostname})`);
  return url;
}

async function call(config, path, body, doFetch) {
  const res = await doFetch(`${checkUrl(config.url)}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-harness-control-key": config.key },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`bdnick said HTTP ${res.status} on ${path}${json?.error ? `: ${String(json.error).slice(0, 120)}` : ""}`);
  return json?.data ?? json;
}

const stateDir = () => join(process.env.LOCALAPPDATA || join(homedir(), ".local", "state"), "nourcity");
const spoolFile = (dir) => join(dir, "harness-poll-unsent-result.json");

/** The last failed tick, kept on the PC (the task window is hidden). Null clears it. pc-status shows it. */
export function recordPollFailure(dir, err, now = new Date()) {
  const file = join(dir, "harness-poll-last-failure.txt");
  if (!err) return rmSync(file, { force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${now.toISOString()} ${scrub(err?.message ?? err)}\n`);
}

/** One tick: resend a result a past tick could not post, then claim at most one action, run or refuse it, post. */
export async function pollOnce(config, { allowlist = loadAllowlist(), doFetch = fetch, run = runAction, dir = stateDir() } = {}) {
  // An action that ran but whose result post failed: send that first, so the row reads its real answer, not LOST.
  const spooled = spoolFile(dir);
  if (existsSync(spooled)) {
    const body = JSON.parse(readFileSync(spooled, "utf8"));
    try {
      await call(config, "/api/devices/harness/actions/result", body, doFetch);
    } catch (err) {
      // 409 = bdnick already has a result for it (or it was never ours): nothing left to deliver.
      if (!/HTTP 409/.test(String(err?.message))) throw err;
    }
    rmSync(spooled, { force: true });
  }
  const claimed = (await call(config, "/api/devices/harness/actions/claim", { pc: config.pc }, doFetch))?.action;
  if (!claimed) return { ran: null };
  // Only the name and id are read from the reply: anything else bdnick sent is ignored.
  const name = claimed.action;
  const decision = localDecision(allowlist, config.pc, name);
  const now = new Date().toISOString();
  const outcome = decision.ok
    ? run(decision, { secrets: [config.key, ...(config.otherSecrets ?? [])] })
    : { exitCode: null, output: "", error: decision.reason, startedAt: now, finishedAt: now };
  const result = { id: String(claimed.id), pc: config.pc, ...outcome };
  try {
    await call(config, "/api/devices/harness/actions/result", result, doFetch);
  } catch (err) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(spooled, JSON.stringify(result));
    throw new Error(`ran ${name} but could not post the result (kept, resent next tick): ${err?.message ?? err}`);
  }
  return { ran: decision.ok ? name : null, refused: decision.ok ? null : decision.reason, id: claimed.id, exitCode: outcome.exitCode };
}

export function readConfig() {
  const file = join(stateDir(), "harness-snapshot.json");
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  return {
    pc: process.env.HARNESS_PC || saved.pc,
    key: process.env.HARNESS_CONTROL_KEY || saved.controlKey,
    url: (process.env.HARNESS_URL || saved.url || DEFAULT_URL).replace(/\/+$/, ""),
    // The snapshot key shares the file: it is redacted from outputs like the control key.
    otherSecrets: [saved.key, process.env.HARNESS_KEY, process.env.DEVICE_AGENT_KEY].filter(Boolean),
  };
}

/** The pc-status action. Read-only, a few lines, no paths. */
export function pcStatus() {
  const lines = [];
  const free = (() => {
    try {
      return `${readFreeMb()} MB`;
    } catch (e) {
      return `unread (${scrub(e?.message ?? e, 80)})`;
    }
  })();
  lines.push(`free RAM: ${free}`);
  lines.push(`uptime: ${(uptime() / 3600).toFixed(1)} h`);
  const rec = readLock("heavy");
  lines.push(`heavy slot: ${rec && !staleReason(rec, "heavy") ? "busy" : "free"}`);
  const fail = join(stateDir(), "harness-snapshot-last-failure.txt");
  lines.push(`last snapshot failure: ${existsSync(fail) ? scrub(readFileSync(fail, "utf8").trim(), 200) : "none recorded"}`);
  const pollFail = join(stateDir(), "harness-poll-last-failure.txt");
  lines.push(`last poll failure: ${existsSync(pollFail) ? scrub(readFileSync(pollFail, "utf8").trim(), 200) : "none recorded"}`);
  lines.push(`node: ${process.version}`);
  return lines.join("\n");
}

async function main(args) {
  if (args.includes("--pc-status")) return console.log(pcStatus());
  const config = readConfig();
  if (!config.pc) throw new Error("no PC role: set pc in nourcity/harness-snapshot.json or HARNESS_PC");
  if (args.includes("--allowed")) {
    const allowlist = loadAllowlist();
    for (const name of Object.keys(allowlist.actions)) {
      const d = localDecision(allowlist, config.pc, name);
      console.log(`${d.ok ? "runs   " : "refuses"} ${name}${d.ok ? `: ${d.argv.join(" ")}` : ` (${d.reason})`}`);
    }
    return;
  }
  if (!config.key) throw new Error("no control key: set controlKey in nourcity/harness-snapshot.json or HARNESS_CONTROL_KEY");
  const r = await pollOnce(config);
  recordPollFailure(stateDir(), null);
  if (r.ran || r.refused) console.log(`[harness-poll] ${config.pc} ${r.id}: ${r.ran ? `ran ${r.ran}, exit ${r.exitCode}` : r.refused}`);
}

if (process.argv[1] && basename(process.argv[1]) === "harness-poll.mjs") {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[harness-poll] ${scrub(err?.message ?? err)}`);
    process.exitCode = 1;
    if (!process.argv.includes("--pc-status") && !process.argv.includes("--allowed")) recordPollFailure(stateDir(), err);
  });
}
