"use client";

/**
 * SelectionActionBar · "selection creates actions" · 2026-09-15.
 *
 * Appears only while rows are selected (x / Shift+arrows / Cmd-click in any
 * `[data-selection-scope]`). Sits just above the fixed bottom chrome, clear
 * of the Nick FAB lane on md+. Labels come from the rows' own DOM
 * (`data-entity-label`, else their text), so a page adds selection with two
 * attributes and no props.
 */

import { useMemo } from "react";
import { X } from "lucide-react";
import { useInspectorStore } from "@/lib/state/inspector-store";
import { parseEntityRef, type EntityRef } from "@/lib/ui/entity-ref";
import { EntityActionRow } from "@/components/inspector/entity-action-row";
import { SELECTION_CLEAR_EVENT, entityLabelFromDom } from "@/hooks/use-selection-keyboard";

export function SelectionActionBar() {
  const selected = useInspectorStore((s) => s.selected);
  const refs = useMemo(
    () => selected.map(parseEntityRef).filter((r): r is EntityRef => r !== null),
    [selected],
  );
  if (refs.length === 0) return null;

  const labelOf = (ref: EntityRef) => entityLabelFromDom(`${ref.kind}:${ref.id}`);
  const clear = () => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(SELECTION_CLEAR_EVENT));
  };

  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      data-selection-bar={refs.length}
      className="fixed bottom-[calc(var(--bottom-chrome-h,6rem)+0.5rem)] left-3 right-3 z-[54] flex flex-wrap items-center gap-2 rounded-xl border border-[var(--gold)]/30 bg-elevated px-3 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.5)] md:left-auto md:right-[calc(var(--nick-fab-lane,0px)+0.75rem)] md:max-w-xl"
    >
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-gold">
        {refs.length} selected
      </span>
      <EntityActionRow entities={refs} labelOf={labelOf} compact />
      <button
        type="button"
        onClick={clear}
        aria-label="Clear selection"
        className="ml-auto inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-fg-tertiary hover:text-fg md:min-h-[32px] md:min-w-[32px]"
      >
        <X size={14} />
      </button>
    </div>
  );
}
