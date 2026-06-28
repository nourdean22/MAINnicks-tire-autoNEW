import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { useWisdomSuggest } from "@/hooks/use-wisdom-suggest";

const queryMock = vi.fn();
vi.mock("@/lib/trpc/vanilla-client", () => ({
  trpcVanilla: {
    chat: {
      wisdomSuggest: {
        query: (...args: unknown[]) => queryMock(...args),
      },
    },
  },
}));

function Probe({ draft, disabled = false }: { draft: string; disabled?: boolean }) {
  const { suggestions, loading, killed } = useWisdomSuggest({ draft, disabled });
  return (
    <div
      data-suggestions={JSON.stringify(suggestions)}
      data-loading={String(loading)}
      data-killed={String(killed)}
    />
  );
}

beforeEach(() => {
  queryMock.mockReset();
});

describe("useWisdomSuggest Hook", () => {
  it("returns loading=false and empty suggestions for short drafts (< 25 chars)", () => {
    const markup = renderToStaticMarkup(<Probe draft="short draft" />);
    expect(markup).toContain('data-suggestions="[]"');
    expect(markup).toContain('data-loading="false"');
  });

  it("returns loading=false and empty suggestions for drafts starting with slash (/) command", () => {
    const markup = renderToStaticMarkup(<Probe draft="/command draft that is long enough to pass 25 chars" />);
    expect(markup).toContain('data-suggestions="[]"');
    expect(markup).toContain('data-loading="false"');
  });

  it("returns loading=false when hook is disabled", () => {
    const markup = renderToStaticMarkup(<Probe draft="this draft is definitely long enough to pass the eligibility gate" disabled={true} />);
    expect(markup).toContain('data-loading="false"');
  });
});
