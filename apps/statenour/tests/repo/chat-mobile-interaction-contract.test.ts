/**
 * Chat phone interaction contract · 2026-10-01.
 *
 * Chat is one of two deliberate StandardPage exceptions, so the shared page
 * shell cannot enforce its modal or touch ergonomics. Keep the high-frequency
 * phone controls reachable here and prevent invalid nested interactive UI.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("chat phone interaction contract", () => {
  it("uses the shared Dialog runtime for long-press message actions", () => {
    const source = read("components/chat/message-action-sheet.tsx");
    expect(source).toContain('from "@/components/ui/dialog"');
    expect(source).toContain("<Dialog");
    expect(source).toContain("<DialogContent");
    expect(source).toContain("<DialogTitle");
    expect(source).not.toContain('role="dialog"');
    expect(source).not.toContain('aria-modal="true"');
  });

  it("keeps QualityBar expansion and regeneration as sibling buttons", () => {
    const source = read("components/chat/quality-bar.tsx");
    expect(source).toContain('aria-expanded={expanded}');
    expect(source).toContain('onClick={onRegen}');
    expect(source).not.toContain('role="button"');
    expect(source).not.toContain('tabIndex={0}');
    expect(source.match(/<button/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps core chat actions at a 44px phone floor", () => {
    const suggestions = read("components/chat/nick-suggestions.tsx");
    expect(suggestions.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(3);

    const list = read("features/chat-v2/components/chat-message-list.tsx");
    expect(list).toContain("min-h-11");
    expect(list).toContain("Show {hiddenCount} older messages");

    const mention = read("components/chat/mention-dropdown.tsx");
    const slash = read("components/chat/slash-command-dropdown.tsx");
    const moments = read("features/chat-v2/components/media-saved-moments.tsx");
    expect(mention).toContain("min-h-11");
    expect(slash).toContain("min-h-11");
    expect(moments).toContain("min-h-12");
  });

  it("keeps inline assistant controls phone-safe without inflating desktop", () => {
    const nick = read("components/chat/nick-message.tsx");
    const quality = read("components/chat/quality-bar.tsx");
    expect(nick).toContain("min-h-11");
    expect(nick).toContain("sm:min-h-8");
    expect(quality).toContain("min-h-11");
    expect(quality).toContain("sm:min-h-8");
  });
});
