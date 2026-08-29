/**
 * run-brain-archive.ps1 — the nightly archive wrapper's LOUD-FAILURE gate.
 *
 * The 2026-08-29 defect this pins: `$ErrorActionPreference = "Stop"` plus a
 * `2>&1` redirect turns the first stderr line of the native pnpm/tsx call
 * into a terminating NativeCommandError in Windows PowerShell 5.1, so the
 * wrapper died between the export finishing and its output being logged.
 * LastTaskResult=1, log stops mid-run, no FATAL line — three failed nights
 * were indistinguishable from silence. The wrapper now has an explicit
 * catch and scopes EAP=Continue around the native call.
 *
 * BEHAVIOUR, not presence: this test invokes the actual .ps1 with
 * OBSIDIAN_VAULT_PATH pointed at a temp vault (so nothing real is touched)
 * and a fixture repo dir whose exporter script is missing. Expected: the
 * run exits nonzero AND the log carries the FATAL line. Under the old
 * swallowed-error shape this test fails — that is the canary.
 *
 * Windows-only (powershell.exe + the .ps1 is a Windows Task Scheduler
 * artifact); skipped elsewhere with a named skip so the skip is visible.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const isWindows = process.platform === "win32";
const scriptPath = path.join(__dirname, "..", "..", "scripts", "run-brain-archive.ps1");

describe.skipIf(!isWindows)("run-brain-archive.ps1 loud failure", () => {
  it("exits 0 and logs run ok when the native export completes successfully", () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "brain-archive-test-vault-ok-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "brain-archive-test-repo-ok-"));
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "brain-archive-test-bin-"));
    try {
      fs.writeFileSync(path.join(repo, "package.json"), '{"name":"fixture"}');
      fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
      fs.writeFileSync(path.join(repo, "scripts", "export-brain-archive.ts"), "// healthy fixture\n");

      // Keep this canary independent of the machine's installed pnpm/tsx
      // versions. The shim is still a native command from the wrapper's point
      // of view and records that the export invocation completed successfully.
      fs.writeFileSync(
        path.join(bin, "pnpm.cmd"),
        '@echo off\r\nnode "%~dp0fixture-export.cjs" %*\r\nexit /b %ERRORLEVEL%\r\n',
      );
      fs.writeFileSync(
        path.join(bin, "fixture-export.cjs"),
        'require("node:fs").writeFileSync(require("node:path").join(process.cwd(), "fixture-export-ran.txt"), process.argv.slice(2).join(" "));\n',
      );

      const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
      const stdout = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          scriptPath,
          "-RepoDir",
          repo,
          "-EnvFile",
          path.join(repo, "nonexistent.env"),
        ],
        {
          env: {
            ...process.env,
            [pathKey]: `${bin}${path.delimiter}${process.env[pathKey] ?? ""}`,
            OBSIDIAN_VAULT_PATH: vault,
          },
          timeout: 60_000,
          encoding: "utf8",
        },
      );

      expect(fs.readFileSync(path.join(repo, "fixture-export-ran.txt"), "utf8")).toContain(
        "scripts/export-brain-archive.ts",
      );
      const logPath = path.join(vault, "Statenour", "_archive", "archive-run.log");
      const log = fs.readFileSync(logPath, "utf8");
      expect(stdout).toMatch(/=== run ok ===/);
      expect(log).toContain("=== run ok ===");
      expect(log).not.toMatch(/FATAL:/);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(bin, { recursive: true, force: true });
    }
  });

  it("exits nonzero and logs FATAL when the export itself fails — the 08-29 swallowed-error shape", () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "brain-archive-test-vault-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "brain-archive-test-repo-"));
    try {
      // package.json passes the first guard; a fixture exporter script passes
      // the not-found guard — so the ONLY failure left is the native
      // `pnpm exec tsx` call inside the export try block. The fixture script
      // exits 1 if tsx resolves (it has no node_modules, but resolution
      // depends on the ambient pnpm environment — witnessed flaking between
      // standalone and full-suite runs), and pnpm itself fails nonzero if it
      // doesn't. Either way the wrapper must report it loudly — that is
      // exactly the call whose stderr silently killed the wrapper on 08-29:
      // under the old try/finally-with-no-catch + EAP=Stop shape, the first
      // stderr line terminated the wrapper before any FATAL line ran.
      fs.writeFileSync(path.join(repo, "package.json"), '{"name":"fixture"}');
      fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
      fs.writeFileSync(
        path.join(repo, "scripts", "export-brain-archive.ts"),
        "// fixture: fails deterministically whether or not tsx resolves\nprocess.exit(1);\n",
      );

      let exitCode = 0;
      let stdout = "";
      try {
        stdout = execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            scriptPath,
            "-RepoDir",
            repo,
            "-EnvFile",
            path.join(repo, "nonexistent.env"),
          ],
          {
            env: { ...process.env, OBSIDIAN_VAULT_PATH: vault },
            timeout: 60_000,
            encoding: "utf8",
          },
        );
      } catch (e) {
        // execFileSync throws on nonzero exit — that IS the loud signal
        // under test. Capture the status and any stdout emitted before exit.
        const err = e as { status?: number; stdout?: string };
        exitCode = err.status ?? -1;
        stdout = err.stdout ?? "";
      }

      // The wrapper MUST fail loudly: nonzero exit is the Task Scheduler
      // signal, the FATAL log line is the human one.
      expect(exitCode).not.toBe(0);
      const logPath = path.join(vault, "Statenour", "_archive", "archive-run.log");
      expect(fs.existsSync(logPath)).toBe(true);
      const log = fs.readFileSync(logPath, "utf8");
      expect(log).toContain("=== run start ===");
      // The export-invocation FATAL specifically — not the not-found branch.
      expect(log).toMatch(/FATAL: export (exited|threw)/);
      // The stdout the task captures also carries the FATAL line.
      expect(stdout).toMatch(/FATAL:/);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("backs up the existing orphan file to a dated auto-snapshot before any export", () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "brain-archive-test-vault2-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "brain-archive-test-repo2-"));
    try {
      fs.writeFileSync(path.join(repo, "package.json"), '{"name":"fixture"}');
      const archiveDir = path.join(vault, "Statenour", "_archive");
      fs.mkdirSync(archiveDir, { recursive: true });
      fs.writeFileSync(path.join(archiveDir, "brain-orphans.ndjson"), "LAST-COPY-SENTINEL");

      let stdout = "";
      let exitCode = 0;
      try {
        stdout = execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            scriptPath,
            "-RepoDir",
            repo,
            "-EnvFile",
            path.join(repo, "nonexistent.env"),
          ],
          {
            env: { ...process.env, OBSIDIAN_VAULT_PATH: vault },
            timeout: 60_000,
            encoding: "utf8",
          },
        );
      } catch (e) {
        const err = e as { status?: number; stdout?: string };
        exitCode = err.status ?? -1;
        stdout = err.stdout ?? "";
      }

      // The run fails (no exporter script) — but the pre-run orphan backup
      // must have happened FIRST. That ordering is the whole point: the
      // irreplaceable file survives even a stale/broken exporter.
      expect(exitCode).not.toBe(0);
      const localNow = new Date();
      const today = [
        localNow.getFullYear(),
        String(localNow.getMonth() + 1).padStart(2, "0"),
        String(localNow.getDate()).padStart(2, "0"),
      ].join("-");
      const backup = path.join(
        archiveDir,
        "snapshots",
        `auto-${today}`,
        "brain-orphans.ndjson",
      );
      expect(fs.existsSync(backup)).toBe(true);
      expect(fs.readFileSync(backup, "utf8")).toBe("LAST-COPY-SENTINEL");
      expect(stdout).toMatch(/pre-run orphan snapshot/);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
