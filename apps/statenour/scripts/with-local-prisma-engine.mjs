#!/usr/bin/env node
/**
 * Run a long-lived command against a PRIVATE COPY of the Prisma query engine.
 *
 * Why this exists
 * ---------------
 * Windows takes an exclusive lock on a native module for as long as it is
 * loaded. Any long-running process that imports @prisma/client (the Obsidian
 * bridge, `next dev`, a watcher) therefore pins
 *   node_modules/.pnpm/@prisma+client@<ver+hash>/node_modules/.prisma/client/query_engine-windows.dll.node
 *
 * `prisma generate` rewrites exactly that file: it writes `<engine>.tmpNNNNN`
 * and renames it over the original. With the file pinned, the rename fails:
 *   EPERM: operation not permitted, rename '...query_engine-windows.dll.node.tmpNNNNN' -> '...query_engine-windows.dll.node'
 * That kills the pre-push `turbo build --affected` gate, and leaves the 20 MB
 * .tmp file behind — 58 of them (1.14 GB) had accumulated before this fix.
 *
 * Rather than asking the operator to stop the bridge for every push, point the
 * bridge at its own copy. It pins the copy; `prisma generate` is free to
 * rewrite node_modules. Both processes get a valid engine.
 *
 * The copy is refreshed on every start, so a Prisma version bump or schema
 * regeneration is picked up the next time the command runs.
 *
 * No-ops on non-Windows: only Windows holds this kind of lock, and Railway
 * builds must not pay for a pointless 20 MB copy.
 *
 * Usage: node scripts/with-local-prisma-engine.mjs <command> [args...]
 *   e.g. node scripts/with-local-prisma-engine.mjs tsx scripts/foo.ts watch
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_ENGINE_DIR = path.join(APP_ROOT, ".prisma-engine-local");

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error("usage: node scripts/with-local-prisma-engine.mjs <command> [args...]");
  process.exit(2);
}

/** Spawn the wrapped command, forwarding stdio and its exit status. */
function run(env) {
  // Windows needs a shell to resolve .cmd/.ps1 bin shims (tsx, next, ...).
  // Node deprecates the args-array + shell combination (DEP0190), so build a
  // single command string instead. The argv comes from our own package.json
  // scripts, never from user input, so there is no injection surface here —
  // the quoting below is only to survive paths containing spaces.
  const useShell = process.platform === "win32";
  const quote = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  const [cmd, args] = useShell
    ? [argv.map(quote).join(" "), []]
    : [argv[0], argv.slice(1)];

  const child = spawn(cmd, args, {
    stdio: "inherit",
    env,
    shell: useShell,
  });
  child.on("error", (err) => {
    console.error(`[local-engine] failed to start ${argv[0]}: ${err.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => child.kill(sig));
  }
}

/**
 * Remove copies left by processes that are no longer alive.
 *
 * Each run gets its own directory because the copy is itself a loaded native
 * module: a second instance cannot overwrite the first instance's copy (same
 * EPERM, one level down), and the supervising .cmd restarts the bridge, so
 * two instances overlapping is normal rather than exceptional.
 */
function sweepStaleCopies() {
  let entries;
  try {
    entries = fs.readdirSync(LOCAL_ENGINE_DIR, { withFileTypes: true });
  } catch {
    return; // nothing to sweep yet
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    if (pid === process.pid) continue;
    try {
      process.kill(pid, 0); // throws ESRCH when the pid is gone
      continue; // still running - leave its copy alone
    } catch (err) {
      if (err.code === "EPERM") continue; // alive but not ours to signal
    }
    try {
      fs.rmSync(path.join(LOCAL_ENGINE_DIR, entry.name), { recursive: true, force: true });
    } catch {
      // A live process may still hold it despite the pid check; try again next start.
    }
  }
}

/** Locate the generated .prisma/client directory that holds the engine. */
function findGeneratedClientDir() {
  // @prisma/client resolves inside pnpm's virtual store; the generated client
  // lives at <that node_modules>/.prisma/client, a sibling of @prisma.
  const entry = require.resolve("@prisma/client", { paths: [APP_ROOT] });
  let dir = path.dirname(entry);
  while (dir !== path.dirname(dir)) {
    if (path.basename(dir) === "node_modules") {
      const candidate = path.join(dir, ".prisma", "client");
      if (fs.existsSync(candidate)) return candidate;
    }
    dir = path.dirname(dir);
  }
  return null;
}

if (process.platform !== "win32") {
  run(process.env);
} else if (process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  // Already pointed somewhere deliberately — do not second-guess the caller.
  console.log("[local-engine] PRISMA_QUERY_ENGINE_LIBRARY already set, passing through");
  run(process.env);
} else {
  let env = process.env;
  try {
    const clientDir = findGeneratedClientDir();
    if (!clientDir) throw new Error("could not locate .prisma/client");

    // Match the real engine, never the leaked .tmpNNNNN siblings.
    const engineName = fs
      .readdirSync(clientDir)
      .find((f) => /^query_engine-windows\.dll\.node$/.test(f));
    if (!engineName) throw new Error(`no query engine in ${clientDir}`);

    sweepStaleCopies();

    const source = path.join(clientDir, engineName);
    // Per-process directory: the copy is a loaded native module too, so a
    // concurrent or restarting instance must never reuse a live one's path.
    const targetDir = path.join(LOCAL_ENGINE_DIR, String(process.pid));
    const target = path.join(targetDir, engineName);
    fs.mkdirSync(targetDir, { recursive: true });
    // Fresh copy every start, so a regenerated/upgraded engine is picked up.
    fs.copyFileSync(source, target);

    env = { ...process.env, PRISMA_QUERY_ENGINE_LIBRARY: target };
    console.log(`[local-engine] using private engine copy: ${target}`);
  } catch (err) {
    // Degrade to the shared engine rather than refusing to start the bridge.
    // The only cost is that `prisma generate` will EPERM while this runs.
    console.warn(`[local-engine] falling back to the shared engine: ${err.message}`);
  }
  run(env);
}
