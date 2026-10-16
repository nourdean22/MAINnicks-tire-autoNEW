/**
 * AmbientAura: the frame around every mastery page.
 *
 * Since UI v3 W1a it paints no aura. It used to put `state-aura state-aura-<state>` on the inner div, a
 * state-colored glow that nobody could read; the state is now a one-word label (components/hud/state-word.tsx).
 * The name stays so the layout, the docs and the e2e spec keep resolving; it is the frame, not the glow.
 *
 * What it keeps is the containing-block fix. `overflow-x-clip` does not create a containing block, so
 * /chat's `fixed inset-0` shell and the bottom tab bar still resolve against the viewport, and
 * `min-h-screen` is the page's floor height. Nothing here may add a position, transform, filter,
 * backdrop-filter, perspective, contain or will-change (pinned by tests/repo/ui-v3-aura.test.ts and
 * __tests__/state-aura-containing-block.test.ts).
 */
export function AmbientAura({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-clip">
      <div className="min-h-screen">{children}</div>
    </div>
  );
}
