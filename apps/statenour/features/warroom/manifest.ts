import { Target, Activity, Radio, type LucideIcon } from "lucide-react";

/**
 * War-Room · Slice 2 · widget manifest registry.
 *
 * The self-describing catalog of surfaces the canvas can host — modeled
 * on `lib/ai/tools/catalog.ts` (`ToolMeta`): flat metadata, one array,
 * append to add. The canvas renders a `WidgetWindow` per manifest; the
 * layout store (positions/z-order) is keyed by `id` and persisted to
 * localStorage. Real data wraps each window in Slice 3+.
 */

export interface WidgetSize {
  w: number;
  h: number;
}

export interface WidgetManifest {
  id: string;
  title: string;
  /** lucide-react icon component, rendered in the window title bar. */
  icon: LucideIcon;
  /** Provenance / status line shown in the title bar until real data lands. */
  note: string;
  defaultPos: { x: number; y: number };
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  /** Subscribes to a live channel (reasoning stream / approvals) — Slice 5. */
  live?: boolean;
}

export const WIDGET_REGISTRY: WidgetManifest[] = [
  {
    id: "missions",
    title: "Missions",
    icon: Target,
    note: "slice 3 · real data + gesture",
    defaultPos: { x: 1120, y: 300 },
    defaultSize: { w: 320, h: 260 },
    minSize: { w: 240, h: 180 },
  },
  {
    id: "pulse",
    title: "System Pulse",
    icon: Activity,
    note: "slice 3 · system.pulse",
    defaultPos: { x: 1520, y: 360 },
    defaultSize: { w: 260, h: 200 },
    minSize: { w: 200, h: 160 },
  },
  {
    id: "livepulse",
    title: "Live-Pulse",
    icon: Radio,
    note: "slice 5 · ambient life",
    defaultPos: { x: 1180, y: 640 },
    defaultSize: { w: 300, h: 220 },
    minSize: { w: 220, h: 160 },
    live: true,
  },
];

export const WIDGET_BY_ID: Record<string, WidgetManifest> = Object.fromEntries(
  WIDGET_REGISTRY.map((w) => [w.id, w]),
);
