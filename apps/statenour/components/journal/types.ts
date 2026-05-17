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
  AlertTriangle,
  Circle,
  Eye,
  Flame,
  Lightbulb,
  NotebookPen,
  Sparkles,
  Swords,
  Target,
} from "lucide-react";

export type SourceKey = "all" | "dump" | "reflection" | "situation" | "decision";
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
  source: "dump" | "reflection" | "situation" | "decision";
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
}

type IconComponent = ComponentType<{ size?: number; className?: string }>;

export const TYPE_META: Record<
  Exclude<TypeKey, "all">,
  { label: string; icon: IconComponent; color: string; bg: string; border: string }
> = {
  raw: { label: "Raw", icon: Circle, color: "text-zinc-400", bg: "bg-zinc-500/10", border: "border-zinc-500/30" },
  thinking: { label: "Thinking", icon: Sparkles, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" },
  // v10.0.227 · purple → violet · the design system uses violet as
  // the "identity / cognition" accent across 10+ components (nudge
  // panel, memory graph, brain-maturity, active alerts). Reasoning
  // semantically fits there. Stays distinct from `thinking` (blue)
  // and `planning` (cyan) so the row of pills is readable at a glance.
  reasoning: { label: "Reasoning", icon: Target, color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/30" },
  insight: { label: "Insight", icon: Lightbulb, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  decision: { label: "Decision", icon: Flame, color: "text-[var(--gold)]", bg: "bg-[var(--gold)]/10", border: "border-[var(--gold)]/30" },
  reflection: { label: "Reflection", icon: Eye, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  planning: { label: "Planning", icon: NotebookPen, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/30" },
  venting: { label: "Venting", icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" },
};

export const SOURCE_ICON: Record<string, IconComponent> = {
  dump: NotebookPen,
  reflection: Eye,
  situation: Swords,
  decision: Target,
};
