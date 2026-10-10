/**
 * Two links whose words promised a surface they did not open (audit
 * 2026-10-10 · 02-F20, 10-U3).
 *
 *  - The searchColdMemory tool receipt linked "Corpus" to /system/coverage,
 *    which next.config redirects to /system/calibration. Calibration shows
 *    Mood x Suggestion Kind and LLM Judge Calibration; there is no corpus or
 *    cold-memory card, so the link is dropped rather than repointed.
 *  - The Missions triage "Open inbox" link on a capture row opened
 *    /system/inbox, which lists MemoryInboxItem quarantine rows. Triage
 *    captures are CaptureInboxItem rows, and no page lists those, so the label
 *    now names what the link opens.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TOOL_CONFIG } from "@/components/chat/tool-result-registry";
import { DeckTriage } from "@/components/missions/deck-triage";
import type { MissionsDeck } from "@/lib/missions/deck";

describe("tool receipt links", () => {
  it("POSITIVE CONTROL: the registry is the real one", () => {
    expect(TOOL_CONFIG.searchColdMemory?.label).toBe("Reaching back into cold memory");
  });

  it("cold-memory search no longer links a Corpus page that does not exist", () => {
    expect(TOOL_CONFIG.searchColdMemory.link).toBeUndefined();
  });
});

describe("Missions triage capture row", () => {
  const triage = {
    rows: [{ kind: "capture", id: "cap1", taskId: null, title: "Call the tire supplier", detail: null }],
    totalCount: 1,
  } as unknown as MissionsDeck["triage"];
  const html = renderToStaticMarkup(
    <DeckTriage triage={triage} tasks={[]} onEditTask={() => {}} onSnoozeTask={() => {}} onDeleteTask={() => {}} />,
  );

  it("POSITIVE CONTROL: the capture row renders", () => {
    expect(html).toContain("Call the tire supplier");
  });

  it("the link says it opens the memory inbox, not 'inbox' for this capture", () => {
    expect(html).toContain('href="/system/inbox"');
    expect(html).toContain("Memory inbox");
    expect(html).not.toContain("Open inbox");
  });
});
