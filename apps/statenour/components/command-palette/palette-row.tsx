"use client";

/**
 * Resolver row grammar · UI v2 (docs/design/ui-v2/SYSTEM.md).
 *
 * The ⌘K palette is control chrome, so its panel may be `.ui-material`; its
 * rows are plain graphite. Gold appears exactly once per row — the signal
 * notch on the cmdk-selected row (keyboard focus / highlight) — never as a
 * glow, a border or a hover.
 *
 * Why this builds on `CommandPrimitive.Item` instead of the shadcn
 * `CommandItem`: tailwind-merge (v3, no theme config) does not recognise the
 * v2 radius/shadow utilities, so `rounded-control` / `shadow-l2` passed as a
 * className would COEXIST with the wrapper's `rounded-sm` and its gold
 * selected-row glow instead of replacing them, and stylesheet
 * order would decide which wins. Owning the class list end-to-end is the only
 * deterministic option without editing components/ui/command.tsx. (The
 * wrapper's bare `data-selected:` variants also match every row, because cmdk
 * renders data-selected="false" on unselected items.)
 */

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { cn } from "@/lib/utils";

/** One palette row: 44px on touch, 36px from `sm`, `rounded-control`, selected = graphite fill + notch. */
export const PALETTE_ROW =
  "group/command-item relative flex min-h-11 cursor-default select-none items-center gap-2 rounded-control px-3 py-1.5 text-[14px] text-fg outline-hidden transition-colors duration-[var(--motion-state)] sm:min-h-9 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-surface-interactive data-[selected=true]:text-fg [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

/** Trailing mono hint on a row (group name, source kind, match score). */
export const PALETTE_HINT = "ml-auto shrink-0 font-mono text-[12px] text-fg-tertiary";

/** Keyboard-shortcut chip on a row (a plain <kbd>, not CommandShortcut — see note above). */
export const PALETTE_KBD =
  "ml-auto shrink-0 rounded-micro border border-edge-default px-1.5 font-mono text-[11px] text-fg-tertiary group-data-[selected=true]/command-item:text-fg";

export function PaletteRow({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(PALETTE_ROW, className)}
      {...props}
    >
      {/* `.notch` is unlayered CSS (display:inline-block), so `hidden` cannot
          suppress it — opacity is the switch. cmdk writes data-selected="false"
          on every OTHER row, so the variant must test the VALUE: a bare
          `data-selected:` compiles to `[data-selected]` and matches all rows. */}
      <span
        className="notch absolute left-0 top-1/2 -translate-y-1/2 opacity-0 group-data-[selected=true]/command-item:opacity-100"
        aria-hidden
      />
      {children}
    </CommandPrimitive.Item>
  );
}
