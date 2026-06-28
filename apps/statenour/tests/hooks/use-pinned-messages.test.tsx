import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { usePinnedMessages } from "@/hooks/use-pinned-messages";

function Probe() {
  const { pinned } = usePinnedMessages();
  return <div data-pinned={JSON.stringify(pinned)} />;
}

describe("usePinnedMessages Hook", () => {
  it("defaults to empty pinned list", () => {
    const markup = renderToStaticMarkup(<Probe />);
    expect(markup).toContain('data-pinned="[]"');
  });
});
