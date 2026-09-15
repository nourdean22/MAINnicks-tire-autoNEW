"use client";

/**
 * Inspector registry · which kinds have a renderer · 2026-09-15.
 *
 * Static and typed on purpose: a kind gets a renderer by adding a line here,
 * not by a runtime `register()` that an import-order accident can skip. A
 * kind in ENTITY_KINDS without an entry renders the honest "no inspector for
 * this kind yet" notice — never a blank panel.
 */

import type { ComponentType } from "react";
import type { EntityKind } from "@/lib/ui/entity-ref";
import { MemoryInspector, type InspectorPanelProps } from "@/components/inspector/panels/memory-inspector";
import { TaskInspector } from "@/components/inspector/panels/task-inspector";
import { PersonInspector } from "@/components/inspector/panels/person-inspector";
import { AlertInspector } from "@/components/inspector/panels/alert-inspector";
import { CronInspector } from "@/components/inspector/panels/cron-inspector";
import { ToolInspector } from "@/components/inspector/panels/tool-inspector";

export interface InspectorRenderer {
  kind: EntityKind;
  Panel: ComponentType<InspectorPanelProps>;
}

export const INSPECTORS: Partial<Record<EntityKind, InspectorRenderer>> = {
  memory: { kind: "memory", Panel: MemoryInspector },
  task: { kind: "task", Panel: TaskInspector },
  person: { kind: "person", Panel: PersonInspector },
  alert: { kind: "alert", Panel: AlertInspector },
  cron: { kind: "cron", Panel: CronInspector },
  tool: { kind: "tool", Panel: ToolInspector },
};

export function inspectorFor(kind: EntityKind): InspectorRenderer | null {
  return INSPECTORS[kind] ?? null;
}

export const INSPECTABLE_KINDS: readonly EntityKind[] = Object.keys(INSPECTORS) as EntityKind[];
