/**
 * tests/repo/manifest-single-source.test.ts
 * 2026-09-02 · delete-first pass.
 *
 * The app shipped TWO manifests. `app/manifest.ts` generated one via the
 * Next.js metadata convention; `public/manifest.webmanifest` sat at the same
 * served path, and a static file wins over an App Router route. So the
 * generator's output never reached a browser — and it disagreed on almost
 * everything that matters to an installed PWA: it said name "STATENOUR" with
 * a `#07090e` theme and a single 48x48 favicon, while production serves
 * "NOUR OS" with `#FDB913` and 192/512 maskable icons. It also declared four
 * `shortcuts` that no device has ever seen.
 *
 * Verified against production before deleting: an unauthenticated GET of
 * /manifest.webmanifest on bdnick.info returned the public/ file byte for
 * byte. The generator was deleted rather than fixed, because fixing it would
 * have meant changing what an already-installed PWA is served — icons, name,
 * theme — for no gain the operator asked for.
 *
 * This test exists because the failure was SILENT: both files were valid, the
 * build was clean, and nothing pointed out that one of them was decorative.
 * A second manifest would be just as silent next time.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const at = (rel: string) => resolve(APP_ROOT, rel);

describe("the PWA manifest has exactly one source", () => {
  it("public/manifest.webmanifest is the source, and no generator shadows it", () => {
    expect(existsSync(at("public/manifest.webmanifest")), "the served manifest must exist").toBe(true);

    const generators = ["app/manifest.ts", "app/manifest.tsx", "app/manifest.json"].filter((p) =>
      existsSync(at(p)),
    );
    expect(
      generators,
      "a Next metadata manifest route is shadowed by public/manifest.webmanifest and " +
        "will never be served — delete one of them, do not keep both",
    ).toEqual([]);
  });

  it("the served manifest is valid and carries what an installed PWA needs", () => {
    // Positive control: without this, deleting BOTH files would pass the
    // assertion above while breaking installation entirely.
    const manifest = JSON.parse(readFileSync(at("public/manifest.webmanifest"), "utf8"));
    expect(manifest.name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    expect(Array.isArray(manifest.icons) && manifest.icons.length).toBeTruthy();

    // Every icon must actually exist on disk — a manifest pointing at a
    // missing PNG installs with a blank tile and fails silently.
    for (const icon of manifest.icons as Array<{ src: string }>) {
      expect(existsSync(at(`public${icon.src}`)), `${icon.src} is referenced but missing`).toBe(true);
    }
  });

  it("the document links the manifest it actually serves", () => {
    const layout = readFileSync(at("app/layout.tsx"), "utf8");
    expect(layout).toContain('manifest: "/manifest.webmanifest"');
  });
});
