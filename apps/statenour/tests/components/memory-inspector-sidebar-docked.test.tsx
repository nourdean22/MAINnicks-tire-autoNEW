/**
 * UI v3 W3b round 3 (B1, desktop): the Context and Evidence sidebar renders as a docked column on its
 * own raised surface when the island docks it at xl, and stays the fixed overlay otherwise. Its close
 * control clears 44 px and is named (it was a bare 16 px icon).
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

import { MemoryInspectorSidebar } from "@/components/chat/memory-inspector-sidebar";

const props = { open: true, onClose: () => {}, hits: [], contradictions: [] };
const rootClass = (markup: string) => /^<div class="([^"]*)"/.exec(markup)![1];

describe("MemoryInspectorSidebar docked", () => {
  it("renders as a column on its own raised surface, not a fixed overlay", () => {
    const cls = rootClass(renderToStaticMarkup(<MemoryInspectorSidebar {...props} docked />));
    expect(cls.split(/\s+/)).not.toContain("fixed");
    expect(cls.split(/\s+/)).toContain("bg-surface-raised");
    expect(cls.split(/\s+/)).toContain("w-96");
  });

  it("CONTROL: undocked it is still the fixed overlay", () => {
    expect(rootClass(renderToStaticMarkup(<MemoryInspectorSidebar {...props} />)).split(/\s+/)).toContain("fixed");
  });

  it("its close control clears 44px and is named", () => {
    const markup = renderToStaticMarkup(<MemoryInspectorSidebar {...props} docked />);
    expect(markup).toMatch(/<button[^>]*aria-label="Close context and memory"[^>]*class="[^"]*\bh-11 w-11\b/);
  });
});
