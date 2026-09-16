"use client";

/**
 * WorksetShelf · what the operator is carrying right now · 2026-09-15.
 *
 * Mounted once in the (mastery) layout. Renders NOTHING until something is
 * pinned (the mount is inert on a fresh device). Chips open the object in the
 * inspector on whatever page you are on — continuity of thought across
 * pages. Hidden while a selection bar is up, which occupies the same slot.
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorksetStore } from "@/lib/state/workset-store";
import { useInspectorStore } from "@/lib/state/inspector-store";
import { ENTITY_KIND_LABEL } from "@/lib/ui/entity-ref";
import { describeExpiry } from "@/lib/ui/workset";
import { useInspector } from "@/hooks/use-inspector";

export function WorksetShelf() {
  const entries = useWorksetStore((s) => s.entries);
  const hydrate = useWorksetStore((s) => s.hydrate);
  const remove = useWorksetStore((s) => s.remove);
  const hasSelection = useInspectorStore((s) => s.selected.length > 0);
  const { openInspector } = useInspector();
  // Render-time captured once (react-hooks/purity): the expiry tooltips may
  // drift by minutes within a mount, which is fine for a shelf that prunes on
  // the next hydrate anyway — the continuity-view precedent.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (entries.length === 0 || hasSelection) return null;

  return (
    <div
      role="region"
      aria-label="Workset"
      data-workset={entries.length}
      className={cn(
        "fixed bottom-[calc(var(--bottom-chrome-h,6rem)+0.5rem)] left-3 z-[53] flex max-w-[calc(100vw-1.5rem)] items-center gap-1.5 overflow-x-auto rounded-xl border border-edge bg-elevated/95 px-2 py-1.5 no-scrollbar",
        "md:max-w-[min(60vw,40rem)] md:right-auto",
        // 2026-09-16 · Visible Transformation · on desktop the workset is a
        // persistent strip at the top of <main>, in flow, not a floating pill.
        "xl:static xl:z-auto xl:w-full xl:max-w-none xl:rounded-none xl:border-0 xl:border-b xl:border-edge xl:bg-transparent xl:px-8 xl:py-2.5",
      )}
    >
      <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-gold">
        workset · {entries.length}
      </span>
      {entries.map((entry) => (
        <span
          key={`${entry.ref.kind}:${entry.ref.id}`}
          className="inline-flex shrink-0 items-center overflow-hidden rounded-lg border border-edge bg-raised"
        >
          <button
            type="button"
            onClick={() => openInspector(entry.ref)}
            title={`${ENTITY_KIND_LABEL[entry.ref.kind]} · ${describeExpiry(entry, now)}`}
            className="inline-flex min-h-[44px] max-w-[11rem] items-center gap-1.5 px-2 text-[12px] text-fg-secondary hover:text-gold md:min-h-[36px]"
          >
            <span className="font-mono text-[11px] uppercase tracking-wide text-fg-tertiary">{entry.ref.kind}</span>
            <span className="truncate">{entry.label}</span>
          </button>
          <button
            type="button"
            onClick={() => remove(entry.ref)}
            aria-label={`Remove ${entry.label} from workset`}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center border-l border-edge text-fg-tertiary hover:text-fg md:min-h-[36px] md:min-w-[32px]"
          >
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}
