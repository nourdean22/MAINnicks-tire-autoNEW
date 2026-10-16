/**
 * Admin UI v1 W1: portals (Radix popovers and dialogs, the sonner Toaster) render on document.body,
 * outside .admin-shell. The graphite token block also matches body:has(.admin-shell), so anything
 * appended to body while the admin is mounted inherits graphite, and nothing does once it unmounts.
 * The real rule is lifted from index.css and injected, so the test exercises the shipped selector.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "client/src/index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const tokenRule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => /--owner-priority/.test(m[2]));

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("graphite reaches portals while the admin is mounted", () => {
  it("an element appended to body outside the shell reads the graphite --background", () => {
    expect(tokenRule, "the graphite token rule").toBeTruthy();
    const style = document.createElement("style");
    style.textContent = `${tokenRule![1]} {${tokenRule![2]}}`;
    document.head.appendChild(style);
    const portal = document.createElement("div");
    document.body.appendChild(portal);
    // Control: no shell mounted, so the public site keeps its own tokens.
    expect(getComputedStyle(portal).getPropertyValue("--background").trim()).toBe("");
    const shell = document.createElement("div");
    shell.className = "admin-shell";
    document.body.appendChild(shell);
    expect(getComputedStyle(portal).getPropertyValue("--background").trim().toUpperCase()).toBe("#0B0C0E");
  });
});
