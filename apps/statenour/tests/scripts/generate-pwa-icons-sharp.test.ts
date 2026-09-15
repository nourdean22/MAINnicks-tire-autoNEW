/**
 * generate-pwa-icons · `sharp` runtime resolution — 2026-09-15.
 *
 * `sharp` is not a dependency of this app; the generator resolves it from
 * `next`'s directory, where it lives as next's optional dependency (Codex
 * review of #2339: a const-specifier import only made check:scripts green,
 * and the documented `pnpm dlx` recovery could never resolve it). These
 * tests prove the resolution WORKS at runtime — the real symbol, the real
 * package, the generator's exact call chain — and that the anchor is
 * load-bearing: the bare specifier still does not resolve from this app.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSharp, sharpPath } from "@/scripts/generate-pwa-icons";

const TINY_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#000"/></svg>');

describe("generate-pwa-icons · sharp resolution", () => {
  it("POSITIVE CONTROL: resolves sharp through next's optional dependency to a real file", () => {
    const path = sharpPath();
    expect(path).toMatch(/[\\/]node_modules[\\/]sharp[\\/]/);
  });

  it("the generator's exact call chain renders a PNG (the package loads, native binary included)", async () => {
    const sharp = loadSharp();
    expect(typeof sharp).toBe("function");
    const png = await sharp(TINY_SVG, { density: 72 })
      .resize(4, 4, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic
  });

  it("the anchor is load-bearing IN THE GENERATOR'S REAL RUNTIME: a plain node process (no vitest NODE_PATH) cannot resolve the bare specifier, and resolves it through next", () => {
    // Inside a vitest worker NODE_PATH points at pnpm's hoisted store, so a bare
    // `sharp` resolves here and proves nothing. The generator runs under tsx with
    // no such path — probe that environment, from the script's own location.
    // The probe imports the REAL sharpPath() from the script (not a re-implementation),
    // under tsx — the same runtime `pnpm tsx scripts/generate-pwa-icons.ts` uses.
    const scriptPath = resolve(process.cwd(), "scripts/generate-pwa-icons.ts");
    const tsxCli = resolve(dirname(createRequire(import.meta.url).resolve("tsx/package.json")), "dist/cli.mjs");
    const probe = [
      'const { createRequire } = require("node:module");',
      'const { pathToFileURL } = require("node:url");',
      `const script = ${JSON.stringify(scriptPath)};`,
      'let bare; try { createRequire(script).resolve("sharp"); bare = "resolved"; } catch (e) { bare = e.code; }',
      "import(pathToFileURL(script).href).then((m) => console.log(JSON.stringify({ bare, viaNext: m.sharpPath() })));",
    ].join("\n");
    const env = { ...process.env };
    delete env.NODE_PATH;
    const out = spawnSync(process.execPath, [tsxCli, "-e", probe], { env, encoding: "utf8", cwd: process.cwd() });
    expect(out.status, out.stderr).toBe(0);
    const { bare, viaNext } = JSON.parse(out.stdout.trim()) as { bare: string; viaNext: string };
    expect(bare).toBe("MODULE_NOT_FOUND"); // if this ever resolves, sharp became a real dependency: drop the anchor
    expect(viaNext).toMatch(/[\\/]node_modules[\\/]sharp[\\/]/);
    expect(existsSync(viaNext)).toBe(true);
  });
});
