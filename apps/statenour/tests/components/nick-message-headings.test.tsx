/**
 * Reply headings are headings (audit 09-F19).
 *
 * NickMessage mapped markdown h1-h4 to <p>, so a screen reader's heading list skipped every section of
 * a long reply. Each level now renders one step down (h1 -> h2 .. h4 -> h5): the page owns h1, a reply
 * section is never above the thread's own heading. Classes are kept; h4/h5 gain leading-snug.
 * Harness copied from nick-message-plugins.test.tsx.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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
vi.mock("@/components/chat/inline-chart", () => ({ InlineChart: () => <div />, parseChartSpec: () => null }));
vi.mock("@/components/chat/email-draft-card", () => ({ EmailDraftCard: () => <div />, parseEmailDraft: () => null }));
vi.mock("@/components/chat/image-with-upscale", () => ({ ImageWithUpscale: () => <div /> }));
vi.mock("@/components/chat/stitch-prompt-card", () => ({ StitchPromptCard: () => <div />, parseStitchPrompt: () => null }));

import { NickMessage } from "@/components/chat/nick-message";

const render = (text: string) =>
  renderToStaticMarkup(<NickMessage text={text} streaming={false} messageId="test-message" />);

describe("NickMessage headings (09-F19)", () => {
  it("'## Plan' renders a real h3", () => {
    expect(render("## Plan\n\nShip it.")).toMatch(/<h3[^>]*>Plan<\/h3>/);
  });

  it.each([
    ["# Top", "h2", "Top"],
    ["### Steps", "h4", "Steps"],
    ["#### Notes", "h5", "Notes"],
  ])("'%s' renders a <%s>", (md, tag, label) => {
    expect(render(`${md}\n\nbody`)).toMatch(new RegExp(`<${tag}[^>]*>${label}</${tag}>`));
  });

  it("no heading level renders as a paragraph", () => {
    const html = render("# A\n\n## B\n\n### C\n\n#### D\n\nbody");
    for (const label of ["A", "B", "C", "D"]) expect(html).not.toMatch(new RegExp(`<p[^>]*>${label}</p>`));
  });

  it("h4 and h5 carry leading-snug (no inherited 1.6 body leading on a heading)", () => {
    const html = render("### C\n\n#### D\n\nbody");
    expect(html.match(/<h4[^>]*>/)?.[0]).toMatch(/\bleading-snug\b/);
    expect(html.match(/<h5[^>]*>/)?.[0]).toMatch(/\bleading-snug\b/);
  });

  it("CONTROL: a paragraph is still a paragraph", () => {
    expect(render("just text")).toMatch(/<p[^>]*>just text<\/p>/);
  });
});
