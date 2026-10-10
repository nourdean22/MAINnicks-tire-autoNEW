/**
 * 09-F28 (2026-10-10): useConfirmDialog put initial focus on the confirm button even for
 * tone "danger", so an Enter or Space press on open ran the destructive action. The dialog
 * renders through a Base UI portal (nothing to SSR here), so the decision is a pure function the
 * component reads for both buttons' autoFocus.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { confirmInitialFocus } from "@/components/ui/confirm-dialog";

describe("confirmInitialFocus", () => {
  it("a destructive confirm opens on Cancel", () => {
    expect(confirmInitialFocus("danger")).toBe("cancel");
  });

  it("a default confirm opens on the confirm button (unchanged)", () => {
    expect(confirmInitialFocus("default")).toBe("confirm");
    expect(confirmInitialFocus(undefined)).toBe("confirm");
  });

  it("both buttons read the decision (the helper is wired, not just exported)", () => {
    const src = readFileSync(join(__dirname, "..", "..", "components/ui/confirm-dialog.tsx"), "utf8");
    expect(src).toContain('autoFocus={confirmInitialFocus(state.tone) === "cancel"}');
    expect(src).toContain('autoFocus={confirmInitialFocus(state.tone) === "confirm"}');
    expect(src).not.toMatch(/^\s*autoFocus\s*$/m);
  });
});
