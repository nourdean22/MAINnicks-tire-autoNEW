import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";

function Probe() {
  const [val] = useLocalStorageState("test-key", "default-val");
  return <div data-val={val} />;
}

describe("useLocalStorageState Hook", () => {
  it("defaults to initial value on mount", () => {
    const markup = renderToStaticMarkup(<Probe />);
    expect(markup).toContain('data-val="default-val"');
  });
});
