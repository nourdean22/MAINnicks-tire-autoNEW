"use client";

/**
 * CitationPills — Apr 19. Renders [brain:X] citation tags from the
 * assistant reply as clickable pills. Each pill deep-links to the
 * relevant /brain section so Nour can see the source.
 *
 * The chat route parses citations in onFinish and persists them on
 * ChatMessage.tokenUsage.citations. This component reads that array
 * and renders a strip under the message body. Zero work when
 * citations is empty — no visual footprint.
 */

import { cn } from "@/lib/utils";
import {
  Brain,
  MessagesSquare,
  Target,
  Compass,
  Ghost,
  Eye,
  BookOpen,
  AlertTriangle,
  ListTodo,
  Scale,
  Sparkles,
} from "lucide-react";

interface Citation {
  raw: string;
  category: string;
  detail?: string;
  start?: number;
  end?: number;
}

const CATEGORY_META: Record<
  string,
  { icon: typeof Brain; label: string; color: string; href: string }
> = {
  recall: { icon: MessagesSquare, label: "past chat", color: "text-blue-400", href: "/brain#recall" },
  skills: { icon: Target, label: "skill", color: "text-[var(--gold)]", href: "/brain#skills" },
  skill: { icon: Target, label: "skill", color: "text-[var(--gold)]", href: "/brain#skills" },
  identity: { icon: Compass, label: "identity", color: "text-emerald-400", href: "/brain#identity" },
  ghost: { icon: Ghost, label: "ghost Nick", color: "text-violet-400", href: "/brain#ghost" },
  qualitative: { icon: Eye, label: "qualitative", color: "text-amber-400", href: "/brain#qualitative" },
  beliefs: { icon: BookOpen, label: "belief", color: "text-blue-300", href: "/brain#beliefs" },
  belief: { icon: BookOpen, label: "belief", color: "text-blue-300", href: "/brain#beliefs" },
  nudges: { icon: Brain, label: "nudge", color: "text-[var(--text-primary)]", href: "/brain#nudges" },
  nudge: { icon: Brain, label: "nudge", color: "text-[var(--text-primary)]", href: "/brain#nudges" },
  contradictions: { icon: AlertTriangle, label: "contradiction", color: "text-red-400", href: "/brain#contradictions" },
  contradiction: { icon: AlertTriangle, label: "contradiction", color: "text-red-400", href: "/brain#contradictions" },
  tasks: { icon: ListTodo, label: "task", color: "text-teal-400", href: "/tasks" },
  task: { icon: ListTodo, label: "task", color: "text-teal-400", href: "/tasks" },
  law: { icon: Scale, label: "Greene law", color: "text-indigo-400", href: "/brain#laws" },
  decision: { icon: Sparkles, label: "decision", color: "text-violet-400", href: "/journal" },
  promise: { icon: AlertTriangle, label: "promise", color: "text-rose-400", href: "/brain#promises" },
  unknown: { icon: Brain, label: "citation", color: "text-[var(--text-tertiary)]", href: "/brain" },
};

export function CitationPills({ citations }: { citations: Citation[] | undefined }) {
  if (!citations || citations.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {citations.map((c, i) => {
        const meta = CATEGORY_META[c.category] ?? CATEGORY_META.unknown;
        const Icon = meta.icon;
        const label = c.detail ? `${meta.label}: ${c.detail}` : meta.label;
        return (
          <a
            key={`${c.raw}-${i}`}
            href={meta.href}
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider",
              "border-[var(--border-default)] bg-[var(--bg-raised)]",
              "hover:border-current transition-colors",
              meta.color,
            )}
            title={c.raw}
          >
            <Icon size={9} />
            {label}
          </a>
        );
      })}
    </div>
  );
}
