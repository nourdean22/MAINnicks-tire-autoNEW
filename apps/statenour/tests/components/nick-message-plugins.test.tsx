import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

// 2026-08-08 · the @streamdown/* plugins are WIRED (operator call) — these
// tests pin the mechanism, not the imports: math renders KaTeX spans
// server-side, ordinary fences hand off to Streamdown's plugin-aware
// CodeBlock (data-streamdown="code-block") instead of the old plain <pre>,
// and the chart interception the pre-override exists for still fires.
// Installed-but-unwired was this repo's 5th BUILT-INSTALLED-UNWIRED
// sighting; a wired-but-intercepted plugin would be the 6th.

vi.mock("@/lib/trpc/client", () => {
  const hookLeaf = {
    useMutation: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
    useQuery: () => ({ data: undefined, isLoading: false }),
  };
  const procProxy = new Proxy({}, { get: () => hookLeaf });
  const routerProxy: Record<string | symbol, unknown> = new Proxy(
    {},
    { get: (_target, prop) => (prop === "useUtils" ? () => ({}) : procProxy) },
  );
  return { trpc: routerProxy };
});

vi.mock("@/components/chat/inline-chart", () => ({
  InlineChart: () => <div data-testid="inline-chart-mock" />,
  parseChartSpec: (raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  },
}));
vi.mock("@/components/chat/email-draft-card", () => ({
  EmailDraftCard: () => <div data-testid="email-draft-mock" />,
  parseEmailDraft: () => null,
}));
vi.mock("@/components/chat/image-with-upscale", () => ({
  ImageWithUpscale: () => <div />,
}));
vi.mock("@/components/chat/stitch-prompt-card", () => ({
  StitchPromptCard: () => <div />,
  parseStitchPrompt: () => null,
}));

import { NickMessage } from "@/components/chat/nick-message";

function render(text: string): string {
  return renderToStaticMarkup(
    <NickMessage text={text} streaming={false} messageId="test-message" />,
  );
}

describe("NickMessage · streamdown plugin wiring", () => {
  it("block math renders KaTeX spans server-side (math plugin live)", () => {
    const markup = render("The identity:\n\n$$e^{i\\pi} + 1 = 0$$");
    expect(markup).toContain("katex");
  });

  it("an ordinary fence hands off to Streamdown's plugin-aware CodeBlock", () => {
    const markup = render("```ts\nconst x = 1;\n```");
    expect(markup).toContain('data-streamdown="code-block"');
    // The old override rendered a plain styled <pre> here — that path
    // bypassed every plugin and must stay dead for element fences.
    expect(markup).not.toContain("bg-[var(--bg-void)]");
  });

  it("the chart interception the override exists for still fires first", () => {
    const markup = render('```chart\n{"type":"bar","series":[]}\n```');
    expect(markup).toContain("inline-chart-mock");
    expect(markup).not.toContain('data-streamdown="code-block"');
  });

  it("a mermaid fence routes through the CodeBlock dispatch, not a plain pre", () => {
    const markup = render("```mermaid\ngraph TD; A-->B;\n```");
    // SSR renders the container/skeleton; the diagram itself hydrates
    // client-side via Streamdown's lazy mermaid chunk.
    expect(markup).not.toContain("bg-[var(--bg-void)]");
  });
});
