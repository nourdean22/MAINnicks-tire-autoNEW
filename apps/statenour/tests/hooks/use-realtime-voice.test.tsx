import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { useRealtimeVoice } from "@/hooks/use-realtime-voice";

function Probe() {
  const { isConnected } = useRealtimeVoice();
  return <div data-connected={String(isConnected)} />;
}

describe("useRealtimeVoice Hook", () => {
  it("defaults to isConnected=false on mount", () => {
    const markup = renderToStaticMarkup(<Probe />);
    expect(markup).toContain('data-connected="false"');
  });
});
