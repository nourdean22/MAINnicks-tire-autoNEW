// @vitest-environment jsdom
/**
 * UI v3 W5a: the hub's fixture galleries fold into ONE closed "Lab" disclosure at the end of the
 * grid. Chat States and UI Lab render real components against fixtures (each page's own header
 * says so: "the REAL components rendered against fixtures", "primitives against fixtures"), so they
 * are tools for checking the UI, not readings of the system. Before W5a they sat in "Data & Logs"
 * beside live surfaces, two of the twenty tiles. The bdnick prune (wave 1, 2026-10-18) deleted the
 * Chat States page and its tile; UI Lab stays, its page being the e2e fixture host, so the Lab holds one.
 *
 * Rendered with react-dom/client in jsdom (the bottom-tab-bar-pinned pattern) so the click wiring
 * is asserted, not only the markup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/trpc/client", () => ({
  trpc: { system: { hub: { useQuery: () => ({ data: undefined, isError: false }) } } },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { CARDS, SystemHubGrid } from "@/components/system/hub-grid";

const LAB_HREFS = ["/system/ui-lab"];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<SystemHubGrid />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const labButton = () =>
  [...container.querySelectorAll("button")].find((b) => /^Lab, /.test(b.textContent ?? "")) ?? null;
const link = (href: string) => container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);

describe("hub grid · the Lab disclosure", () => {
  it("the subject is real: every hub card renders exactly one link", () => {
    for (const c of CARDS) {
      expect(container.querySelectorAll(`a[href="${c.href}"]`).length, c.href).toBe(1);
    }
  });

  it("one Lab button, closed by default, says its count and its state in words", () => {
    const btn = labButton();
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("type")).toBe("button");
    expect(btn!.getAttribute("aria-expanded")).toBe("false");
    expect(btn!.textContent).toContain("Lab, 1 tool");
    expect(btn!.textContent).toContain("closed");
  });

  it("the fixture tiles live inside the closed Lab, still links with their hrefs", () => {
    const panel = document.getElementById(labButton()!.getAttribute("aria-controls")!);
    expect(panel).not.toBeNull();
    expect(panel!.hidden).toBe(true);
    for (const href of LAB_HREFS) {
      const a = link(href);
      expect(a, href).not.toBeNull();
      expect(panel!.contains(a)).toBe(true);
    }
  });

  it("POSITIVE CONTROL: a live tile stays outside the Lab", () => {
    const panel = document.getElementById(labButton()!.getAttribute("aria-controls")!);
    for (const href of ["/system/health", "/system/calibration", "/system/crons", "/system/logs"]) {
      expect(panel!.contains(link(href)), href).toBe(false);
    }
  });

  it("a tap opens it, and a second tap closes it", () => {
    const btn = labButton()!;
    act(() => btn.click());
    const panel = document.getElementById(btn.getAttribute("aria-controls")!)!;
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.textContent).toContain("open");
    expect(panel.hidden).toBe(false);
    act(() => btn.click());
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
  });

  it("the Lab is the last section of the grid", () => {
    const sections = [...container.querySelectorAll("section")];
    expect(sections.at(-1)!.contains(labButton())).toBe(true);
  });
});
