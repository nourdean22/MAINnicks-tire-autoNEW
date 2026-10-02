/**
 * The Resolver (⌘K palette) must mount a cmdk root.
 *
 * Found 2026-10-02 during the UI v2 surface wave: `CommandDialog` in
 * components/ui/command.tsx renders Dialog + DialogContent only — no
 * `<Command>` root — and components/command-palette.tsx rendered
 * `<CommandInput>` straight inside it. cmdk's Input reads the root store from
 * context, so opening the palette threw
 * "Cannot read properties of undefined (reading 'subscribe')".
 *
 * Positive control first (the library fact the contract rests on), then the
 * contract on the palette's own source.
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command as CommandPrimitive } from "cmdk";

describe("command palette · cmdk root", () => {
  it("positive control: cmdk Input throws without a root and renders inside one", () => {
    expect(() => renderToString(<CommandPrimitive.Input />)).toThrow(/subscribe/);
    expect(() =>
      renderToString(
        <CommandPrimitive>
          <CommandPrimitive.Input />
        </CommandPrimitive>,
      ),
    ).not.toThrow();
  });

  it("the palette mounts its own CommandPrimitive root above CommandInput", () => {
    const src = readFileSync(join(process.cwd(), "components/command-palette.tsx"), "utf8");
    const root = src.indexOf("<CommandPrimitive\n");
    const input = src.indexOf("<CommandInput");
    expect(root).toBeGreaterThan(-1);
    expect(input).toBeGreaterThan(root);
    // `CommandDialog` provides no root — the palette must not lean on it.
    expect(src).not.toMatch(/<CommandDialog[\s>]/);
  });
});
