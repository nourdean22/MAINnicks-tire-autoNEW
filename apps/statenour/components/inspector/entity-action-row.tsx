"use client";

/**
 * EntityActionRow · renders lib/ui/entity-actions.ts descriptors · 2026-09-15.
 *
 * The same row appears in the inspector footer (one object) and the selection
 * bar (many). It is the ONLY place that knows how to run an action kind:
 *   navigate / chat → router.push(href)
 *   workset         → the workset store (toggle: present → remove)
 *   copy-link       → clipboard, the `?inspect=` href of the first object
 * Pages with real mutations pass them as `extra` (buttons they own).
 */

import type { ReactNode } from "react";
import { useCallback, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bookmark, BookmarkCheck, Brain, ExternalLink, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorksetStore } from "@/lib/state/workset-store";
import { ENTITY_KIND_LABEL, type EntityRef } from "@/lib/ui/entity-ref";
import { actionsFor, homeRouteFor, type EntityAction } from "@/lib/ui/entity-actions";
import { HORIZON_LABEL } from "@/lib/ui/workset";

export interface EntityActionRowProps {
  entities: readonly EntityRef[];
  /** Operator-facing label for a ref; falls back to `<kind> <id>`. */
  labelOf?: (ref: EntityRef) => string | undefined;
  /** Page-owned actions (mutations) rendered after the shared ones. */
  extra?: ReactNode;
  compact?: boolean;
  className?: string;
}

const ICON: Record<EntityAction["id"], typeof Brain> = {
  open: ExternalLink,
  "ask-nick": Brain,
  workset: Bookmark,
  "copy-link": Link2,
};

export function EntityActionRow({ entities, labelOf, extra, compact, className }: EntityActionRowProps) {
  const router = useRouter();
  const pathname = usePathname();
  const worksetAdd = useWorksetStore((s) => s.add);
  const worksetRemove = useWorksetStore((s) => s.remove);
  const worksetEntries = useWorksetStore((s) => s.entries);

  const actions = useMemo(() => actionsFor(entities), [entities]);
  const allInWorkset =
    entities.length > 0 &&
    entities.every((ref) => worksetEntries.some((e) => e.ref.kind === ref.kind && e.ref.id === ref.id));

  const run = useCallback(
    (action: EntityAction) => {
      const ctx = { labelOf };
      switch (action.kind) {
        case "navigate":
        case "chat": {
          const href = action.href?.(entities, ctx);
          if (href) router.push(href);
          return;
        }
        case "workset": {
          if (allInWorkset) {
            entities.forEach((ref) => worksetRemove(ref));
            toast.success("Removed from workset");
            return;
          }
          entities.forEach((ref) => {
            const label = labelOf?.(ref) ?? `${ENTITY_KIND_LABEL[ref.kind]} ${ref.id}`;
            worksetAdd(ref, label, "today");
          });
          toast.success(`Added to workset · ${HORIZON_LABEL.today}`);
          return;
        }
        case "copy-link": {
          const first = entities[0];
          if (!first || typeof window === "undefined") return;
          // The object's canonical route, not the page it happened to be
          // inspected from — a link copied on /missions to a memory must
          // open /brain.
          const href = `${window.location.origin}${homeRouteFor(first)}`;
          const write = navigator.clipboard?.writeText?.(href);
          if (write) {
            write.then(() => toast.success("Link copied")).catch(() => toast.error("Could not copy the link"));
          } else {
            toast.error("Clipboard unavailable");
          }
          return;
        }
        default:
          return;
      }
    },
    [entities, labelOf, router, pathname, worksetAdd, worksetRemove, allInWorkset],
  );

  if (entities.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} data-entity-actions={entities.length}>
      {actions.map((action) => {
        const Icon = action.id === "workset" && allInWorkset ? BookmarkCheck : ICON[action.id] ?? ExternalLink;
        const label = action.id === "workset" && allInWorkset ? "In workset" : action.label;
        return (
          <button
            key={action.id}
            type="button"
            onClick={() => run(action)}
            className={cn(
              // 44px on phones (the house target floor, tests/e2e/target-size.spec.ts);
              // `compact` only tightens the desktop height.
              "inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-edge px-2.5 text-[12px] text-fg-secondary transition-colors hover:border-[var(--gold)]/40 hover:text-gold",
              compact ? "md:min-h-[32px]" : "md:min-h-[36px]",
              action.id === "workset" && allInWorkset && "border-[var(--gold)]/40 text-gold",
            )}
          >
            <Icon size={13} aria-hidden />
            <span>{label}</span>
          </button>
        );
      })}
      {extra}
    </div>
  );
}
