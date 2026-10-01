import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UI_VERSION_COOKIE, resolveUiVersion } from "@/lib/ui-version";

describe("ui-version · the comparison lane resolves from the cookie, then the env", () => {
  it("cookie names the generation", () => {
    expect(resolveUiVersion("v1", undefined)).toBe("v1");
    expect(resolveUiVersion("v2", "v1")).toBe("v2");
  });
  it("env flips the default only when the cookie is silent or junk", () => {
    expect(resolveUiVersion(undefined, "v1")).toBe("v1");
    expect(resolveUiVersion("", "v1")).toBe("v1");
    expect(resolveUiVersion("nope", undefined)).toBe("v2");
    expect(resolveUiVersion(undefined, undefined)).toBe("v2");
  });
  it("the constant is a string on the server import path (not a client reference)", () => {
    // The 2026-10-01 defect: the layout imported the constant from a "use client" file.
    expect(typeof UI_VERSION_COOKIE).toBe("string");
    const lib = readFileSync(join(__dirname, "..", "..", "lib", "ui-version.ts"), "utf8");
    expect(lib).not.toMatch(/^"use client"/m);
    const layout = readFileSync(join(__dirname, "..", "..", "app", "layout.tsx"), "utf8");
    expect(layout).toContain('from "@/lib/ui-version"');
    expect(layout).not.toMatch(/import \{[^}]*UI_VERSION_COOKIE[^}]*\} from "@\/components\/ui\/ui-version-switch"/);
  });
});
