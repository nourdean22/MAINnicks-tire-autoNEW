/**
 * UI v3 W2 (2026-10-16): OmniCaptureModal renders NOTHING while closed. Until W2 its closed state was
 * a fixed bottom-left "+" FAB (lg:hidden), which made /missions carry two capture controls on a phone
 * and forced the empty state to clear it with a left offset. The capture row is the one control now;
 * Cmd+K still opens this dialog. Rendered with react-dom/server (the repo's node-environment pattern).
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import { OmniCaptureModal } from "@/components/actions/omni-capture-modal";

describe("OmniCaptureModal closed state", () => {
  it("renders no markup at all, so no floating control exists below the fold", () => {
    const html = renderToString(<OmniCaptureModal onCapture={async () => {}} />);
    expect(html).toBe("");
  });
});
