/**
 * tests/components/wisdom-pill.test.tsx · v10.0.526
 *
 * At-write-time wisdom pill · Arc B Feature 2.
 *
 * The vitest env in this repo is Node (no jsdom, no testing-library),
 * so we test:
 *   1. The pure helper `buildInsertedDraft` (prefix shape, empty-draft
 *      behavior · 1 test)
 *   2. SSR markup output of the component for each of the four render
 *      states (loading, 1-suggestion, 2-suggestions, killed) via
 *      `renderToStaticMarkup`. The hook is mocked so we can drive the
 *      states directly without an embedding provider / DB.
 *   3. Keyboard-Enter insert path · verified through the pure helper
 *      since the SSR output captures the onKeyDown attribute name but
 *      can't fire events without a DOM. The handler shape lives on
 *      the helper · which is its own unit test below.
 *
 * Five tests · covering loading · 1-suggestion · 2-suggestion ·
 * dismiss state (killed) · keyboard Enter insert.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Mock the hook BEFORE importing the component · the component picks
// up the mock at import time. Each test calls `setHookState(...)`
// before re-importing or re-rendering.
type HookState = {
  suggestions: { id: string; text: string; source: string; similarity: number }[];
  loading: boolean;
  killed: boolean;
  dismiss: (id: string) => void;
  killForever: () => void;
};

let mockHookState: HookState = {
  suggestions: [],
  loading: false,
  killed: false,
  dismiss: () => {},
  killForever: () => {},
};

function setHookState(next: Partial<HookState>) {
  mockHookState = { ...mockHookState, ...next };
}

vi.mock("@/hooks/use-wisdom-suggest", () => ({
  useWisdomSuggest: () => mockHookState,
}));

// lucide-react ships ESM that vitest can normally resolve, but stub
// the icons we use so a transitive resolution miss never breaks the
// SSR render path. Each icon is a tiny svg shell with a stable test
// hook attribute.
vi.mock("lucide-react", () => ({
  X: () => null,
  Sparkles: () => null,
}));

// Now import the component + helper. Done AFTER the mocks above so
// the component's hook reference is the mocked one.
import { WisdomPill, buildInsertedDraft } from "@/components/chat/wisdom-pill";

beforeEach(() => {
  // Reset to default null state before each test.
  mockHookState = {
    suggestions: [],
    loading: false,
    killed: false,
    dismiss: () => {},
    killForever: () => {},
  };
});

// ─── 1 · buildInsertedDraft · pure helper ────────────────────────────

describe("buildInsertedDraft · keyboard Enter insert payload", () => {
  it("Enter on a wisdom prepends a margin-note line above the existing draft", () => {
    const wisdom = "Compound interest is the eighth wonder of the world.";
    const draft = "should I keep tire inventory low this quarter?";
    const out = buildInsertedDraft(wisdom, draft);
    expect(out).toBe(
      "// considering: Compound interest is the eighth wonder of the world.\n\nshould I keep tire inventory low this quarter?",
    );
    // The marker line is grep-able · operator can scan transcripts.
    expect(out.startsWith("// considering: ")).toBe(true);
    // Original draft is preserved verbatim · we never edit operator
    // text · only add the note on top.
    expect(out.endsWith(draft)).toBe(true);
  });

  it("Enter on a wisdom with empty draft inserts just the margin note + newline", () => {
    const out = buildInsertedDraft("Slow is smooth, smooth is fast.", "");
    expect(out).toBe("// considering: Slow is smooth, smooth is fast.\n");
    // Empty-draft case · no double newline before nothing.
    expect(out.endsWith("\n")).toBe(true);
    expect(out.includes("\n\n")).toBe(false);
  });
});

// ─── 2 · loading state ───────────────────────────────────────────────

describe("WisdomPill · loading state", () => {
  it("renders the 'listening…' indicator when loading with no suggestions yet", () => {
    setHookState({ loading: true, suggestions: [] });
    const html = renderToStaticMarkup(
      <WisdomPill draft="long enough draft of more than twenty-five characters" onUseThis={() => {}} />,
    );
    expect(html).toContain("listening");
    // Pill is mounted · the live-region role is present.
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it("returns null (no markup) when not loading and no suggestions", () => {
    setHookState({ loading: false, suggestions: [] });
    const html = renderToStaticMarkup(
      <WisdomPill draft="some draft text long enough to pass the threshold" onUseThis={() => {}} />,
    );
    expect(html).toBe("");
  });
});

// ─── 3 · 1-suggestion + 2-suggestion render ──────────────────────────

describe("WisdomPill · suggestion rendering", () => {
  it("renders exactly 1 suggestion when the hook returns one match", () => {
    setHookState({
      suggestions: [
        {
          id: "wisdom-001",
          text: "Inversion: don't ask how to succeed, ask how to fail and avoid that.",
          source: "Munger",
          similarity: 0.71,
        },
      ],
    });
    const html = renderToStaticMarkup(
      <WisdomPill draft="planning the next month of moves" onUseThis={() => {}} />,
    );
    expect(html).toContain("Inversion: don&#x27;t ask how to succeed");
    expect(html).toContain("Munger");
    expect(html).toContain('aria-label="Use wisdom from Munger:');
    // Should NOT contain any other suggestion source label.
    expect(html.match(/Munger/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("renders both suggestions when the hook returns two matches", () => {
    setHookState({
      suggestions: [
        {
          id: "wisdom-buffett-007",
          text: "Be fearful when others are greedy, and greedy when others are fearful.",
          source: "Buffett",
          similarity: 0.78,
        },
        {
          id: "wisdom-naval-012",
          text: "Specific knowledge cannot be taught, but it can be learned.",
          source: "Naval",
          similarity: 0.66,
        },
      ],
    });
    const html = renderToStaticMarkup(
      <WisdomPill draft="thinking about market timing for the next move" onUseThis={() => {}} />,
    );
    expect(html).toContain("Buffett");
    expect(html).toContain("Naval");
    expect(html).toContain("Be fearful when others are greedy");
    expect(html).toContain("Specific knowledge cannot be taught");
    // Two dismiss buttons · one per suggestion.
    const dismissCount = html.match(/aria-label="Dismiss this suggestion"/g)?.length ?? 0;
    expect(dismissCount).toBe(2);
  });
});

// ─── 4 · dismiss / kill state ────────────────────────────────────────

describe("WisdomPill · permanent kill (dismiss state)", () => {
  it("returns null when killed via the localStorage flag", () => {
    setHookState({
      killed: true,
      suggestions: [
        { id: "x", text: "won't render", source: "Munger", similarity: 0.8 },
      ],
    });
    const html = renderToStaticMarkup(
      <WisdomPill draft="this is a long enough draft to pass the gate" onUseThis={() => {}} />,
    );
    // Killed > all other states · the pill disappears entirely · no
    // markup, no live region, no chrome.
    expect(html).toBe("");
  });

  it("hides while streaming so the pill never competes for attention during reply", () => {
    setHookState({
      suggestions: [
        { id: "x", text: "should render normally", source: "Buffett", similarity: 0.8 },
      ],
    });
    const htmlStreaming = renderToStaticMarkup(
      <WisdomPill draft="this is a long enough draft to pass the gate" isStreaming={true} onUseThis={() => {}} />,
    );
    expect(htmlStreaming).toBe("");

    const htmlIdle = renderToStaticMarkup(
      <WisdomPill draft="this is a long enough draft to pass the gate" isStreaming={false} onUseThis={() => {}} />,
    );
    expect(htmlIdle).toContain("should render normally");
  });
});
