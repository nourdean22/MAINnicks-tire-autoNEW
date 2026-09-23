#!/usr/bin/env node
/**
 * cloud-doctor — is THIS environment able to do the work this repo expects?
 *
 * WHY IT EXISTS. A Claude Code cloud session starts from a clean container: no
 * `.env` files (the local worktrees get theirs copied by scripts/worktree-setup.ps1),
 * no Railway login (the local CLI is authenticated by BROWSER OAuth, which a
 * headless container cannot perform), and no hook-free push clone. Every one of
 * those is invisible until a command fails halfway through a task, and the failure
 * reads like a bug in the work rather than a missing capability in the environment.
 *
 * So: run this FIRST in any new environment. Every check reports one of three
 * states, never two — the same empty-vs-error discipline the app's own reads use:
 *
 *   OK       — present and verified by actually invoking it
 *   MISSING  — verified absent, with the exact fix on the next line
 *   UNKNOWN  — could not be determined (the probe itself failed); NOT the same
 *              as missing, and never reported as one
 *
 *   node scripts/cloud-doctor.mjs           # report, always exit 0
 *   node scripts/cloud-doctor.mjs --strict  # exit 1 if anything required is MISSING
 *   node scripts/cloud-doctor.mjs --deep    # also ask Railway to inject each DATABASE_URL
 *
 * --deep is off by default because it spends a Railway API call per service, and a
 * burst of those rate-limits the CLI account-wide for ~20 minutes (2026-09-22).
 *
 * Nothing here writes, installs, sends or touches production. It only looks.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STRICT = process.argv.includes("--strict");
const DEEP = process.argv.includes("--deep");
const ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();

const results = [];
/** @param {"required"|"optional"} tier */
const add = (tier, name, state, detail, fix) => results.push({ tier, name, state, detail, fix });

/** Run a command purely to observe it. Returns null when the command is absent or fails. */
function probe(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 }).trim();
  } catch {
    return null;
  }
}

// ── toolchain ────────────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const wantNode = (pkg.engines?.node ?? ">=24").replace(/[^\d.]/g, "");
const nodeV = process.versions.node;
add(
  "required",
  "node",
  Number(nodeV.split(".")[0]) >= Number(wantNode.split(".")[0] || 24) ? "OK" : "MISSING",
  `${nodeV} (package.json engines wants >=${wantNode})`,
  `install Node ${wantNode}+`,
);

const wantPnpm = (pkg.packageManager ?? "").split("@")[1]?.split("+")[0] ?? "10";
const pnpmV = probe("pnpm --version");
add(
  "required",
  "pnpm",
  pnpmV ? "OK" : "MISSING",
  pnpmV ? `${pnpmV} (packageManager pins ${wantPnpm})` : "not on PATH",
  `corepack enable && corepack prepare pnpm@${wantPnpm} --activate`,
);

// ── workspace install ────────────────────────────────────────────────────
const hasRootModules = existsSync(join(ROOT, "node_modules"));
const hasNickModules = existsSync(join(ROOT, "apps/nickstire/node_modules"));
add(
  "required",
  "workspace install",
  hasRootModules && hasNickModules ? "OK" : "MISSING",
  `root node_modules ${hasRootModules ? "present" : "absent"}, apps/nickstire ${hasNickModules ? "present" : "absent"}`,
  "pnpm install --frozen-lockfile  (NEVER inside a junctioned worktree — it offers to wipe the shared node_modules)",
);

// ── github ───────────────────────────────────────────────────────────────
const ghV = probe("gh --version");
const ghAuth = ghV ? probe("gh auth status") : null;
add(
  "required",
  "gh CLI + auth",
  !ghV ? "MISSING" : ghAuth ? "OK" : "MISSING",
  !ghV ? "gh not on PATH" : ghAuth ? ghAuth.split("\n").find((l) => l.includes("account")) ?? "authenticated" : "installed but not logged in",
  !ghV ? "install the GitHub CLI" : "gh auth login  (or set GH_TOKEN)",
);

// ── railway: the one that silently blocks every production read ──────────
const railwayV = probe("railway --version");
const tokenEnv = process.env.RAILWAY_TOKEN ? "RAILWAY_TOKEN" : process.env.RAILWAY_API_TOKEN ? "RAILWAY_API_TOKEN" : null;
let railwayState = "MISSING";
let railwayDetail;
if (!railwayV) {
  railwayDetail = "railway not on PATH";
} else {
  const who = probe("railway whoami");
  if (who) {
    railwayState = "OK";
    railwayDetail = `${railwayV} · ${who.replace(/\s+/g, " ")}${tokenEnv ? ` · via ${tokenEnv}` : " · via browser OAuth (local only)"}`;
  } else if (tokenEnv) {
    // A token is set but whoami did not answer — that is a broken token or a
    // network problem, NOT an absent one. Saying "missing" here would send the
    // reader to create a second token that also would not work.
    railwayState = "UNKNOWN";
    railwayDetail = `${railwayV} · ${tokenEnv} is set but \`railway whoami\` did not answer`;
  } else {
    railwayDetail = `${railwayV} installed, not authenticated`;
  }
}
add(
  "optional",
  "railway CLI + auth",
  railwayState,
  railwayDetail,
  "npm i -g @railway/cli, then set RAILWAY_TOKEN (project-scoped) in the environment. Browser OAuth cannot be used headlessly — see docs/CLOUD-ENVIRONMENT.md",
);

// ── env files: absent by design in the cloud, and that is the point ──────
const envPaths = ["apps/nickstire/.env", "apps/statenour/.env"];
const presentEnv = envPaths.filter((p) => existsSync(join(ROOT, p)));
add(
  "optional",
  "app .env files",
  presentEnv.length === envPaths.length ? "OK" : "MISSING",
  presentEnv.length ? `present: ${presentEnv.join(", ")}` : "none present — DB-touching scripts cannot run directly",
  "do NOT copy production secrets into a cloud container. Use `railway run -s <service> -- <cmd>`, which injects them per-process and leaves nothing on disk.",
);

// ── the two databases, both reached the same way ─────────────────────────
// Neither app keeps a .env in a cloud container. Both go through
// `railway run -s <service>`, which injects that service's variables into one
// subprocess: nickstire -> TiDB (mysql2), statenour-web -> Neon (Prisma/pg).
// So ONE project-scoped Railway token unlocks both, and no token unlocks neither.
const DB_SERVICES = [
  { service: "MAINnicks-tire-auto", app: "nickstire", engine: "TiDB / MySQL" },
  { service: "statenour-web", app: "statenour", engine: "Neon / Postgres" },
];
for (const { service, app, engine } of DB_SERVICES) {
  if (railwayState !== "OK") {
    add(
      "optional",
      `db · ${app}`,
      "UNKNOWN",
      `${engine} — not probed: the Railway CLI is not authenticated, so the question cannot be asked`,
      "authenticate Railway first; this check answers itself once that is OK",
    );
    continue;
  }
  if (!DEEP) {
    add(
      "optional",
      `db · ${app}`,
      "UNKNOWN",
      `${engine} — reachable via \`railway run -s ${service}\`, not probed (pass --deep)`,
      `node scripts/cloud-doctor.mjs --deep`,
    );
    continue;
  }
  // Ask Railway to inject the service env and report ONLY whether DATABASE_URL
  // arrived and what host it names. The value itself is never printed.
  const out = probe(
    `railway run -s ${service} -- node -e "const u=process.env.DATABASE_URL;if(!u){console.log('ABSENT');process.exit(0)}try{const h=new URL(u.replace(/^mysql:/,'http:').replace(/^postgres(ql)?:/,'http:'));console.log('PRESENT '+h.hostname)}catch{console.log('PRESENT (unparsed)')}"`,
  );
  const line = (out ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("PRESENT") || l === "ABSENT").pop();
  add(
    "optional",
    `db · ${app}`,
    line?.startsWith("PRESENT") ? "OK" : line === "ABSENT" ? "MISSING" : "UNKNOWN",
    line?.startsWith("PRESENT")
      ? `${engine} — DATABASE_URL injected, host ${line.slice(8)}`
      : line === "ABSENT"
        ? `${engine} — railway run succeeded but the service has no DATABASE_URL`
        : `${engine} — the probe itself failed (rate limit, wrong service name, or no network)`,
    `railway run -s ${service} -- <cmd>  · read docs/CLOUD-ENVIRONMENT.md and the prod-db-guard skill BEFORE any write`,
  );
}

// prisma, statenour's data layer — the CLI is a workspace dep, not global
const prismaV = probe("pnpm --filter @statenour/web exec prisma --version");
add(
  "optional",
  "prisma CLI",
  prismaV ? "OK" : "UNKNOWN",
  prismaV ? (prismaV.split("\n").find((l) => /prisma/i.test(l)) ?? "present").trim() : "not resolvable — usually just means the workspace is not installed yet",
  "pnpm install --frozen-lockfile, then use pnpm --filter @statenour/web exec prisma …",
);

// ── the policy hook actually FIRES here ──────────────────────────────────
// Run the PreToolUse command string from .claude/settings.json verbatim, the
// way the harness does, on a payload the policy must deny. Until 2026-09-23 it
// named its script with Windows backslashes: on Linux that is MODULE_NOT_FOUND,
// a hook error fails open, and all 13 rules were off in every cloud session.
// Evaluating a payload runs nothing; it only asks the policy for a verdict.
{
  let state = "UNKNOWN";
  let detail = "no PreToolUse command hook in .claude/settings.json";
  try {
    const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
    const cmd = (settings.hooks?.PreToolUse ?? []).flatMap((g) => g.hooks ?? []).find((h) => /pretool\.mjs/.test(h.command ?? ""))?.command;
    if (cmd) {
      const r = spawnSync(process.platform === "win32" ? cmd.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : cmd, {
        shell: process.platform === "win32" ? true : "/bin/sh",
        input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git stash pop" } }),
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
        timeout: 20000,
      });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      if (r.status === 2 && /stash-pop/.test(out)) {
        state = "OK";
        detail = "PreToolUse hook denied a known-bad payload (stash-pop), exit 2";
      } else {
        state = "MISSING";
        detail = `PreToolUse hook did not deny a known-bad payload (exit ${r.status})${/Cannot find module/.test(out) ? " — MODULE_NOT_FOUND: the configured path does not resolve here" : ""}`;
      }
    }
  } catch (e) {
    detail = `could not run the check: ${String(e?.message ?? e).slice(0, 120)}`;
  }
  add("required", "policy hook fires", state, detail, "fix the PreToolUse command in .claude/settings.json (use / separators); scripts/agent-os/hookCommand.test.mjs runs it verbatim");
}

// ── the push path ────────────────────────────────────────────────────────
const lefthook = existsSync(join(ROOT, "lefthook.yml"));
add(
  "optional",
  "push path",
  lefthook ? "OK" : "UNKNOWN",
  lefthook
    ? "lefthook.yml present — pre-push runs build:affected, which is slow and can fail on the OTHER app"
    : "lefthook.yml not found",
  "if pre-push blocks on an unrelated app, push from a hook-free clone rather than --no-verify (root AGENTS.md)",
);

// ── report ───────────────────────────────────────────────────────────────
const mark = { OK: "OK      ", MISSING: "MISSING ", UNKNOWN: "UNKNOWN " };
console.log(`cloud-doctor · ${ROOT}\n`);
for (const tier of ["required", "optional"]) {
  console.log(`${tier.toUpperCase()}`);
  for (const r of results.filter((x) => x.tier === tier)) {
    console.log(`  ${mark[r.state]} ${r.name.padEnd(20)} ${r.detail}`);
    if (r.state !== "OK") console.log(`${" ".repeat(31)}fix: ${r.fix}`);
  }
  console.log("");
}
const missingRequired = results.filter((r) => r.tier === "required" && r.state === "MISSING");
const unknown = results.filter((r) => r.state === "UNKNOWN");
console.log(
  `${results.filter((r) => r.state === "OK").length} ok · ${results.filter((r) => r.state === "MISSING").length} missing · ${unknown.length} unknown` +
    (missingRequired.length ? ` · ${missingRequired.length} REQUIRED missing` : ""),
);
if (unknown.length) console.log("UNKNOWN is not MISSING — the probe failed, so the state is undetermined; do not act as if it were absent.");
process.exit(STRICT && missingRequired.length ? 1 : 0);
