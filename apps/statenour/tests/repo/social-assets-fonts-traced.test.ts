/**
 * Q-35 · Sentry JAVASCRIPT-REACT-11: "Fonts missing from bundle directory:
 * /app/packages/social-assets/dist/fonts" on GET /api/content/render-asset.
 *
 * @nour/social-assets reads Inter-Regular.ttf + Outfit-Bold.ttf with fs at
 * module load, from `fonts/` beside its compiled render.js (`dist/`). Next's
 * standalone tracer cannot follow a path built from import.meta.url, and the
 * Dockerfile runtime stage copies ONLY .next/standalone, so an untraced font
 * does not exist in production. Every route that imports the package must name
 * the fonts in outputFileTracingIncludes, with a glob that resolves (from the
 * project root, per node_modules/next/dist/docs/.../output.md) to the exact
 * directory render.ts reads.
 */
// next.config wraps itself in withSentryConfig; same import shape as
// retired-routes-gate.test.ts and private-discovery.test.ts.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

const PROJECT_ROOT = process.cwd();
const PKG_ROOT = path.resolve(PROJECT_ROOT, "../../packages/social-assets");
// render.ts: path.join(__dirname, "fonts", ...) where __dirname is dist/ once built.
const FONTS_DIR_AT_RUNTIME = path.join(PKG_ROOT, "dist", "fonts");
const REQUIRED_FONTS = ["Inter-Regular.ttf", "Outfit-Bold.ttf"];

/** App Router route files whose source imports @nour/social-assets, as route paths. */
function routesImportingSocialAssets(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^route\.tsx?$/.test(entry.name) && /["']@nour\/social-assets["']/.test(fs.readFileSync(full, "utf-8"))) {
        out.push("/" + path.relative(path.join(PROJECT_ROOT, "app"), path.dirname(full)).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(PROJECT_ROOT, "app"));
  return out.sort();
}

/** Strip a trailing wildcard segment and resolve the directory a glob targets. */
function globDir(glob: string): string {
  return path.resolve(PROJECT_ROOT, glob.replace(/\/\*\*?(\/\*)?$/, "").replace(/\/\*[^/]*$/, ""));
}

describe("social-assets fonts ship in the standalone image", () => {
  const includes = (nextConfig.outputFileTracingIncludes ?? {}) as Record<string, string[]>;

  it("finds the importing route (a zero here would be a silent green)", () => {
    expect(routesImportingSocialAssets()).toContain("/api/content/render-asset");
  });

  it("every importing route traces the directory render.ts reads", () => {
    for (const route of routesImportingSocialAssets()) {
      const dirs = (includes[route] ?? []).map(globDir);
      expect(dirs, `outputFileTracingIncludes["${route}"]`).toContain(FONTS_DIR_AT_RUNTIME);
    }
  });

  it("the package build puts both fonts in that directory", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf-8"));
    expect(pkg.scripts.build).toContain("copy-fonts");
    for (const font of REQUIRED_FONTS) {
      expect(fs.existsSync(path.join(PKG_ROOT, "src", "fonts", font)), font).toBe(true);
    }
  });

  it("globDir resolves the shapes the config uses (positive control)", () => {
    expect(globDir("../../packages/social-assets/dist/fonts/*")).toBe(FONTS_DIR_AT_RUNTIME);
    expect(globDir("../../packages/social-assets/dist/fonts/**/*")).toBe(FONTS_DIR_AT_RUNTIME);
    expect(globDir("../../packages/social-assets/dist/*")).not.toBe(FONTS_DIR_AT_RUNTIME);
  });
});
