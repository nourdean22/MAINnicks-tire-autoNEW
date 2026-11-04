/**
 * W8b (audit nice-to-have, item 6) · a weekly-review entry has its own type pill; before, the feed fell back to
 * TYPE_META.raw and showed the raw icon for every review row.
 */
import { describe, expect, it } from "vitest";

import { TYPE_META } from "@/components/journal/types";
import { REVIEW_ENTRY_TYPE } from "@/lib/brain/journal-review-marker";

describe("TYPE_META", () => {
  it("has an entry for the weekly review marker, labelled for the feed", () => {
    const meta = TYPE_META[REVIEW_ENTRY_TYPE as keyof typeof TYPE_META];
    expect(meta).toBeDefined();
    expect(meta.label).toBe("Weekly review");
    expect(meta.icon).not.toBe(TYPE_META.raw.icon);
  });
});
