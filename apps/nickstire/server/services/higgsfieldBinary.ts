import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";

/** Pinned to apps/nickstire/package.json's `@higgsfield/cli`. A test enforces it. */
export const HIGGSFIELD_CLI_VERSION = "0.2.3";
import { createRequire } from "module";
import { createLogger } from "../lib/logger";

const log = createLogger("services:higgsfield-binary");

let cachedPath: string | null = null;

/**
 * Ensures the Higgsfield CLI native binary is available, downloading it to the OS temp
 * directory if it is missing from node_modules (which frequently happens in container
 * environments like Railway with scripts-ignored installs).
 *
 * Returns the absolute path to the executable binary.
 */
export async function ensureHiggsfieldBinary(): Promise<string> {
  if (cachedPath && fs.existsSync(cachedPath)) {
    return cachedPath;
  }

  const binName = process.platform === "win32" ? "hf.exe" : "hf";

  // 1. Check if the binary is present in standard node_modules location
  try {
    const require = createRequire(import.meta.url);
    const cliPkgPath = require.resolve("@higgsfield/cli/package.json");
    const vendorDir = path.join(path.dirname(cliPkgPath), "vendor");
    const binPath = path.join(vendorDir, binName);
    if (fs.existsSync(binPath)) {
      log.info(`Found Higgsfield CLI binary in node_modules: ${binPath}`);
      cachedPath = binPath;
      return binPath;
    }
  } catch (e) {
    // Package not resolved or other error
  }

  // 2. Check if the binary is already cached in the temp directory
  const tempDir = os.tmpdir();
  const tempBinPath = path.join(tempDir, binName);
  if (fs.existsSync(tempBinPath)) {
    log.info(`Found Higgsfield CLI binary cached in temp: ${tempBinPath}`);
    cachedPath = tempBinPath;
    return tempBinPath;
  }

  // 3. Download and extract the native binary from GitHub Releases
  // MUST MATCH apps/nickstire/package.json's @higgsfield/cli pin. It said "0.2.2"
  // against a 0.2.3 dependency, so the download URL pointed at a release the repo
  // does not use - silent drift that only surfaces as a 404 on a machine with no
  // cached binary, i.e. exactly the machine that needs `higgsfield auth login`.
  //
  // Kept as a plain constant rather than read from the package at runtime: a JSON
  // import would have to survive the esbuild bundle, and a test asserting this
  // equals the pin catches drift with no runtime risk at all
  // (higgsfieldBinaryVersion.test.ts).
  const version = HIGGSFIELD_CLI_VERSION;
  const PLATFORM_MAP: Record<string, string> = { darwin: "darwin", linux: "linux", win32: "windows" };
  const ARCH_MAP: Record<string, string> = { x64: "amd64", arm64: "arm64" };
  const platform = PLATFORM_MAP[process.platform];
  const arch = ARCH_MAP[process.arch];

  if (!platform || !arch) {
    throw new Error(`Unsupported platform/architecture for Higgsfield CLI: ${process.platform}/${process.arch}`);
  }

  const tarball = `hf_${version}_${platform}_${arch}.tar.gz`;
  const downloadUrl = `https://github.com/higgsfield-ai/cli/releases/download/v${version}/${tarball}`;
  const tarballPath = path.join(tempDir, tarball);

  log.info(`Higgsfield CLI binary is missing. Downloading from ${downloadUrl}...`);

  try {
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(`Failed to download Higgsfield native binary tarball: HTTP ${res.status} ${res.statusText}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tarballPath, buffer);

    log.info(`Extracting Higgsfield native binary to temp folder: ${tempDir}`);
    // RUN FROM tempDir AND PASS ONLY RELATIVE NAMES. Measured 2026-08-18: passing
    // absolute paths failed on Windows with
    //
    //   tar (child): Cannot connect to C: resolve failed
    //
    // because GNU tar reads a leading `C:\...` as a REMOTE `host:path` spec. Git
    // for Windows ships GNU tar on PATH ahead of Windows' own bsdtar, so which tar
    // answers depends on the shell that started node - meaning this worked in
    // production (Linux) and broke only on the operator's machine, which is exactly
    // where `hf auth login` has to be run.
    //
    // `--force-local` would fix GNU tar and BREAK bsdtar, which does not accept the
    // flag. Using cwd removes the drive letter from the argv entirely, so both tars
    // are happy and no platform branch is needed.
    execFileSync("tar", ["-xzf", tarball, binName], { cwd: tempDir });

    if (process.platform !== "win32") {
      fs.chmodSync(tempBinPath, 0o755);
    }
    log.info(`Higgsfield CLI binary successfully prepared at ${tempBinPath}`);
    cachedPath = tempBinPath;
    return tempBinPath;
  } catch (err) {
    log.error("Failed to automatically install/prepare Higgsfield CLI native binary", {
      err: err instanceof Error ? err.message : String(err)
    });
    throw err;
  } finally {
    try {
      if (fs.existsSync(tarballPath)) {
        fs.unlinkSync(tarballPath);
      }
    } catch (_) {}
  }
}
