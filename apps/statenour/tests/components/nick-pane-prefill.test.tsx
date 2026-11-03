/**
 * W5 2026-11-02: "Ask Nick about this goal" opens the side pane with the question prefilled. When the pane
 * was closed, its chat was not mounted, so the open-nick event's prompt reached no listener and the pane
 * opened empty. The pane now keeps the prompt and the chat starts from it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MultiTurnChat } from "@/components/mastery/multi-turn-chat";

describe("side pane prefill", () => {
  it("a chat mounted with a pending prompt starts with it in the field (not sent)", () => {
    const html = renderToStaticMarkup(<MultiTurnChat page="goals" initialInput={'About my goal "Run" [id:g1]'} />);
    expect(html).toContain('value="About my goal &quot;Run&quot; [id:g1]"');
  });

  it("the pane keeps the event's prompt for the chat it mounts", () => {
    const src = readFileSync(join(__dirname, "../../components/mastery/nick-side-pane.tsx"), "utf8");
    expect(src).toMatch(/setPendingPrompt\(/);
    expect(src).toMatch(/initialInput=\{pendingPrompt/);
  });
});
