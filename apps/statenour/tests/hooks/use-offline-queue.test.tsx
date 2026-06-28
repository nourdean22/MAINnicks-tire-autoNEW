import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { useOfflineQueue } from "@/hooks/use-offline-queue";

function Probe() {
  const { isOnline, status } = useOfflineQueue({
    sendMessage: async () => {},
  });
  return (
    <div
      data-online={String(isOnline)}
      data-status={status}
    />
  );
}

describe("useOfflineQueue Hook", () => {
  it("defaults to online on mount", () => {
    const markup = renderToStaticMarkup(<Probe />);
    expect(markup).toContain('data-online="true"');
    expect(markup).toContain('data-status="online"');
  });
});
