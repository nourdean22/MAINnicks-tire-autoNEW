/**
 * NICK VNEXT · Context Manifest — log-only instrumentation (2026-08-12).
 *
 * Makes "why did Nick say that?" mechanically answerable: one structured
 * log line per turn recording WHAT the model actually saw — every
 * prompt section (split on the same `\n## ` boundary the budget trimmer
 * uses, so the manifest sees exactly the units the trimmer keeps or
 * drops), sizes, and a stable hash for correlating turns that shared a
 * prompt. Pure derivation from the FINAL prompt string — zero behavior
 * change, assembly-agnostic (survives refactors of how the prompt is
 * built), and the input the compact-prompt A/B needs before any section
 * gets deleted.
 */
import { createHash } from "node:crypto";

export interface ContextManifestSection {
  title: string;
  chars: number;
}

export interface ContextManifest {
  promptChars: number;
  /** sha256 prefix — correlate turns sharing an identical prompt. */
  promptHash: string;
  sectionCount: number;
  /** Preamble (before the first `## `) reported as section "(preamble)". */
  sections: ContextManifestSection[];
  /** The N largest sections — the attention hogs, biggest first. */
  top: ContextManifestSection[];
}

/**
 * Split on the trimmer's own boundary (`\n## `). `###` sub-blocks fuse
 * into their parent section HERE TOO — deliberately, because that is
 * how `trimPromptToBudget` sees them (the #1450 fusion bug class stays
 * visible in this manifest instead of being smoothed over).
 */
export function buildContextManifest(finalSystemPrompt: string, topN = 5): ContextManifest {
  const raw = finalSystemPrompt ?? "";
  const parts = raw.split("\n## ");
  const sections: ContextManifestSection[] = parts.map((part, i) => {
    if (i === 0) return { title: "(preamble)", chars: part.length };
    const newline = part.indexOf("\n");
    const title = (newline === -1 ? part : part.slice(0, newline)).trim().slice(0, 60);
    return { title: title || "(untitled)", chars: part.length + 4 }; // +4 = the split-consumed "\n## "
  });
  const top = [...sections].sort((a, b) => b.chars - a.chars).slice(0, topN);
  return {
    promptChars: raw.length,
    promptHash: createHash("sha256").update(raw).digest("hex").slice(0, 16),
    sectionCount: sections.length,
    sections,
    top,
  };
}
