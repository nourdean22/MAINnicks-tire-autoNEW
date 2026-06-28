import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { useStallDetection } from "@/hooks/use-stall-detection";

function Probe({ messages, isStreaming }: { messages: any[]; isStreaming: boolean }) {
  const status = useStallDetection({ messages, isStreaming });
  return <div data-status={status} />;
}

describe("useStallDetection Hook", () => {
  it("returns status=idle when isStreaming is false", () => {
    const markup = renderToStaticMarkup(<Probe messages={[]} isStreaming={false} />);
    expect(markup).toContain('data-status="idle"');
  });

  it("returns status=healthy when isStreaming transitions to true", () => {
    const markup = renderToStaticMarkup(<Probe messages={[]} isStreaming={true} />);
    expect(markup).toContain('data-status="healthy"');
  });
});
