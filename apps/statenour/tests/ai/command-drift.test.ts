import { describe, it, expect } from "vitest";
import { COMMANDS } from "@/lib/ai/chat/command-registry";
import { SLASH_COMMANDS } from "@/hooks/use-slash-commands";

/**
 * truth-substrate audit P1 (#18) · command-drift guard.
 *
 * The backend F5 command registry (COMMANDS) and the client slash menu
 * (SLASH_COMMANDS) are two hand-authored lists. A backend command only reaches
 * its handler when a menu entry's prompt is literally "/name" (interceptors.ts
 * resolveCommand). `preview-pushes` was implemented + tested but had no menu
 * entry → invisible. This test fails if any backend command (minus an explicit,
 * documented allowlist) is not surfaced in the slash menu.
 */

// Backend commands intentionally NOT in the slash menu — must be justified here.
const INTENTIONALLY_UNLISTED: string[] = [];

function menuRoutingSlugs(): Set<string> {
  const slugs = new Set<string>();
  for (const s of SLASH_COMMANDS) {
    // ONLY the prompt routes: on click, chat-composer sends command.prompt, which
    // hits resolveCommand -> parseCommand (matches the first "/token"). The `cmd`
    // field is display-only (React key + label + filter substring) and is
    // deliberately NOT counted here — crediting it would let a menu entry whose
    // prompt drifted off "/name" (or became a navigate/action) still pass this
    // guard while being unroutable. (P1 review finding.)
    const firstTok = s.prompt?.trim().split(/\s+/)[0];
    if (firstTok?.startsWith("/")) slugs.add(firstTok);
  }
  return slugs;
}

describe("command drift guard (audit #18)", () => {
  it("every backend F5 command is surfaced in the slash menu", () => {
    const menu = menuRoutingSlugs();
    const missing = COMMANDS.map((c) => c.name)
      .filter((name) => !INTENTIONALLY_UNLISTED.includes(name))
      .filter((name) => !menu.has(`/${name}`));
    expect(
      missing,
      `backend commands with no slash-menu entry (add one to hooks/use-slash-commands.ts, ` +
        `or allowlist in this test with a reason): ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("preview-pushes specifically is now surfaced (regression pin)", () => {
    expect(menuRoutingSlugs().has("/preview-pushes")).toBe(true);
  });
});
