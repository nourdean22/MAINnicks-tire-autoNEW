// @vitest-environment jsdom
/**
 * antislop audit 002 (anti-slop/audit-002-2026-10-31.md), all five findings, Nour 2026-10-31 "Fix all five".
 *
 * 1. R-02: no em dash in a string the chat shows (six voice/stream toasts had one).
 * 2. R-27: the Archived tab told loading and a failed read apart nowhere, and had no Retry.
 * 3. R-04: the Context & Evidence panel led with the generic Sparkles and Brain glyphs.
 * 4. R-04: decision citations used Sparkles.
 * 5. R-06: the 11px mono label voice now carries its written reason in app/styles/tokens.css.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/chat",
}));

import { MemoryInspectorSidebar } from "@/components/chat/memory-inspector-sidebar";
import { CitationPills } from "@/components/chat/citation-pills";
import { OperatorConversationDrawer } from "@/features/chat-v2/components/operator-conversation-drawer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement;
function mount(el: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

const app = join(__dirname, "..", "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    // Shipped sources only: test fixtures (the speech sanitizer feeds dashes on purpose) are not UI.
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
/** String literals holding an em dash, comments dropped. */
const dashedStrings = (src: string): string[] =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\{\/\*)/.test(line))
    .flatMap((line) => line.match(/"[^"\n]*—[^"\n]*"|'[^'\n]*—[^'\n]*'|`[^`\n]*—[^`\n]*`/g) ?? []);

describe("1 · R-02: no em dash in a string the chat shows", () => {
  const files = [
    ...walk(join(app, "features", "chat-v2")),
    ...walk(join(app, "hooks", "chat")),
    join(app, "hooks", "use-voice-input.ts"),
    join(app, "hooks", "use-image-attachment.ts"),
  ];

  it("CONTROL: the scanner finds a planted dashed string and skips a comment", () => {
    expect(dashedStrings('toast.error("Failed — try again");')).toHaveLength(1);
    expect(dashedStrings("// a comment — not shown")).toHaveLength(0);
    expect(files.length).toBeGreaterThan(30);
  });

  it("no chat source holds an em dash inside a string", () => {
    const hits = files.flatMap((p) => dashedStrings(readFileSync(p, "utf8")).map((s) => `${p.slice(app.length)}: ${s}`));
    expect(hits).toEqual([]);
  });
});

describe("2 · R-27: the Archived tab has loading, error with Retry, and empty", () => {
  const row = (id: string) => ({ id, title: `T ${id}`, createdAt: "2026-10-30T00:00:00.000Z", _count: { messages: 1 } });
  function drawer(props: Partial<React.ComponentProps<typeof OperatorConversationDrawer>>) {
    const all: React.ComponentProps<typeof OperatorConversationDrawer> = {
      convos: [row("live")], activeId: null, pinnedIds: new Set(), hasMore: false, loadingMore: false, listState: "ok",
      onRetryList: vi.fn(), onLoadMore: vi.fn(), onSelect: vi.fn(), onDelete: vi.fn(), onRename: vi.fn(), onTogglePin: vi.fn(),
      onArchive: vi.fn(), archivedConvos: null, onLoadArchived: vi.fn(), onUnarchive: vi.fn(), onNew: vi.fn(), onShowActions: vi.fn(), onClose: vi.fn(),
      ...props,
    };
    mount(<OperatorConversationDrawer {...all} />);
    act(() => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim().toLowerCase() === "archived")!.click());
    return all;
  }

  it("while the read is in flight it says so", () => {
    drawer({ archivedState: "loading" });
    expect(host.textContent).toContain("Loading archived conversations…");
    expect(host.textContent).not.toContain("could not be read");
  });

  it("a failed read says so and Retry reads again", () => {
    const p = drawer({ archivedState: "error" });
    expect(host.textContent).toContain("Archived list could not be read.");
    const retry = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Retry")!;
    expect(retry).toBeTruthy();
    (p.onLoadArchived as ReturnType<typeof vi.fn>).mockClear();
    act(() => retry.click());
    expect(p.onLoadArchived).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: a read that came back empty is a real empty, not an error", () => {
    drawer({ archivedState: "ok", archivedConvos: [] });
    expect(host.textContent).toContain("Nothing archived.");
    expect(host.textContent).not.toContain("could not be read");
  });
});

describe("3 · R-04: the Context & Evidence panel has no generic AI glyphs", () => {
  it("no Sparkles and no Brain; the close control keeps its icon", () => {
    mount(<MemoryInspectorSidebar open onClose={() => {}} hits={[{ id: "cm1", content: "x", category: "preference", similarity: 0.6 }]} recallProvenance="OK" recallSource="turn" />);
    expect(host.querySelector("svg.lucide-x")).not.toBeNull();
    expect(host.querySelector("svg.lucide-sparkles")).toBeNull();
    expect(host.querySelector("svg.lucide-brain")).toBeNull();
    expect(host.textContent).toContain("Context & Evidence");
  });
});

describe("4 · R-04: a decision citation reads as a decision", () => {
  it("decision uses GitBranch (a fork in the road), not Sparkles", () => {
    mount(<CitationPills citations={[{ raw: "[decision]", category: "decision" }, { raw: "[law]", category: "law" }]} />);
    expect(host.querySelector("svg.lucide-scale")).not.toBeNull();
    expect(host.querySelector("svg.lucide-git-branch")).not.toBeNull();
    expect(host.querySelector("svg.lucide-sparkles")).toBeNull();
  });
});

describe("5 · R-06: the mono label voice has its reason written down", () => {
  it("tokens.css names why small labels are mono", () => {
    const css = readFileSync(join(app, "app", "styles", "tokens.css"), "utf8");
    expect(css).toMatch(/LABEL VOICE[^\n]*mono/i);
  });
});
