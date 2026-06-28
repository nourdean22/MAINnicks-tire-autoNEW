import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { useIdleDetector } from "@/hooks/use-idle-detector";

function Probe() {
  const { isIdle, msSinceActivity } = useIdleDetector();
  return (
    <div
      data-idle={String(isIdle)}
      data-ms={String(msSinceActivity)}
    />
  );
}

describe("useIdleDetector Hook", () => {
  it("defaults to non-idle and 0 ms activity on mount", () => {
    const markup = renderToStaticMarkup(<Probe />);
    expect(markup).toContain('data-idle="false"');
    expect(markup).toContain('data-ms="0"');
  });
});
