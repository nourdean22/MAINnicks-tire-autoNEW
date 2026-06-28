import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { useChatTransport } from "@/hooks/chat/use-chat-transport";

function Probe() {
  const bodyRef = React.useRef({});
  const liveBlocksRef = React.useRef(null);
  const personaRef = React.useRef<any>(null);
  const traceRef = React.useRef<any>(null);

  const transport = useChatTransport({
    apiPath: "/api/chat",
    transportBodyRef: bodyRef,
    liveContextBlocksRef: liveBlocksRef,
    lastPersonaHeaderRef: personaRef,
    lastTraceIdRef: traceRef,
    setDeeperContext: () => {},
  });

  return <div data-api={transport.api} />;
}

describe("useChatTransport Hook", () => {
  it("initializes transport with the correct API path", () => {
    const markup = renderToStaticMarkup(<Probe />);
    expect(markup).toContain('data-api="/api/chat"');
  });
});
