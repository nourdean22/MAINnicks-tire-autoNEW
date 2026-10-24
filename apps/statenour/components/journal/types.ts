/**
 * components/journal/types.ts · v10.0.284 · shared types + styling
 * maps for the /journal feed surface.
 *
 * Extracted from app/(mastery)/journal/page.tsx in the same kaizen
 * pattern as ProjectCard (v10.0.273) · entry-row component lives in
 * its own file, the constants it needs to look up (TYPE_META,
 * SOURCE_ICON) live here so both the row and the page filter UI can
 * import them without circular reference.
 */
import type { ComponentType } from "react";
import {
  Circle,
  Eye,
  Flame,
  Lightbulb,
  Milestone,
  NotebookPen,
  Sparkles,
  Swords,
  Target,
} from "lucide-react";

export type SourceKey = "all" | "dump" | "reflection" | "situation" | "decision" | "retro";
export type TypeKey =
  | "all"
  | "raw"
  | "thinking"
  | "reasoning"
  | "insight"
  | "decision"
  | "reflection"
  | "planning"
  | "venting";

export interface FeedEntry {
  id: string;
  source: "dump" | "reflection" | "situation" | "decision" | "retro";
  createdAt: string;
  date: string;
  entryType?: TypeKey | string;
  title: string;
  body: string;
  summary: string | null;
  mood: string | null;
  domains: string[];
  linkedTopics: string[];
  tasksCreated: number;
  acknowledged?: boolean;
  actionable?: boolean;
  confidence?: number;
  // Journal Brain (Phase 1) · grounding columns surfaced for the inline
  // link chip. Pre-resolved title means no per-row goal lookup. The full
  // XP receipt is fetched on-expand via trpc.journal.receipt.
  goalId?: string | null;
  missionId?: string | null;
  linkStatus?: string | null;
  linkConfidence?: number | null;
  linkedGoalTitle?: string | null;
}

type IconComponent = ComponentType<{ size?: number; className?: string }>;

export const TYPE_META: Record<
  Exclude<TypeKey, "all">,
  { label: string; icon: IconComponent; color: string; bg: string; border: string }
> = {
  raw: { label: "Raw", icon: Circle, color: "text-fg-tertiary", bg: "bg-surface-interactive", border: "border-edge-default" },
  // Wave E1 (2026-10-24): the type pills stay inside the status grammar (sky, amber, emerald) or the
  // neutral tokens. The label and the icon tell the types apart; hue never carries the meaning alone.
  thinking: { label: "Thinking", icon: Sparkles, color: "text-sky-300", bg: "bg-sky-500/10", border: "border-sky-500/30" },
  reasoning: { label: "Reasoning", icon: Target, color: "text-fg-secondary", bg: "bg-surface-interactive", border: "border-edge-strong" },
  insight: { label: "Insight", icon: Lightbulb, color: "text-amber-300", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  decision: { label: "Decision", icon: Flame, color: "text-fg", bg: "bg-surface-interactive", border: "border-edge-strong" },
  reflection: { label: "Reflection", icon: Eye, color: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  planning: { label: "Planning", icon: NotebookPen, color: "text-sky-300", bg: "bg-sky-500/10", border: "border-sky-500/30" },
  // 2026-09-01: venting is normal journaling, not an alarm, so it gets the neutral tone and the same
  // Circle mark as raw capture.
  venting: { label: "Venting", icon: Circle, color: "text-fg-tertiary", bg: "bg-surface-interactive", border: "border-edge-default" },
};

export const SOURCE_ICON: Record<string, IconComponent> = {
  dump: NotebookPen,
  reflection: Eye,
  situation: Swords,
  decision: Target,
  retro: Milestone,
};
