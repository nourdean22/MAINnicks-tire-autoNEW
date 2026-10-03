/**
 * Canonical shot spec → provider-specific prompt, WITHOUT mutating the brief.
 *
 * reelVideoPrompt.ts builds a labelled block spec (SUBJECT / SCENE / ... /
 * STYLE). That is the canonical content truth and it is what the ledger, QA and
 * Pattern Lab attribute against. Different generators want different syntax:
 * LTX-2.x is documented to respond best to one chronological paragraph of
 * cinematography prose; Wan accepts labelled text but has no audio track, so an
 * AUDIO block is noise to it.
 *
 * So the adapter COMPILES — it never edits `promptPack`, `storyboardBeats`, or
 * anything persisted. An authored (unlabelled) pack prompt is a human's wording
 * and passes through untouched, the same rule reelPipeline applies.
 */
import { PROMPT_BLOCKS } from "./reelVideoPrompt";

export type PromptDialect = "ltx_prose" | "wan_labelled" | "passthrough";

export function dialectForFamily(family: string): PromptDialect {
  const f = family.toLowerCase();
  if (f.startsWith("ltx")) return "ltx_prose";
  if (f.startsWith("wan")) return "wan_labelled";
  return "passthrough";
}

/** Parse "NAME: body" lines into blocks. Returns null for unlabelled prose. */
function parseShotSpec(prompt: string): Map<string, string> | null {
  const blocks = new Map<string, string>();
  const names = PROMPT_BLOCKS as readonly string[];
  let current: string | null = null;
  for (const raw of String(prompt ?? "").split(/\r?\n/)) {
    const m = /^([A-Z][A-Z ]+):\s*(.*)$/.exec(raw);
    if (m && names.includes(m[1])) {
      current = m[1];
      blocks.set(current, m[2].trim());
    } else if (current && raw.trim()) {
      blocks.set(current, `${blocks.get(current)} ${raw.trim()}`.trim());
    }
  }
  if (!blocks.has("SUBJECT") && !blocks.has("SCENE")) return null;
  return blocks;
}

const sentence = (s: string | undefined): string => {
  const t = String(s ?? "").trim();
  if (!t) return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

export function compileForgePrompt(prompt: string, dialect: PromptDialect, opts: { nativeAudio?: boolean } = {}): string {
  const spec = dialect === "passthrough" ? null : parseShotSpec(prompt);
  if (!spec) return prompt; // authored prose or unknown dialect: untouched
  if (dialect === "wan_labelled") {
    return [...spec.entries()]
      .filter(([name, body]) => body && name !== "AUDIO")
      .map(([name, body]) => `${name}: ${body}`)
      .join("\n");
  }
  // ltx_prose: one chronological paragraph — subject, where, what moves, how it is shot, look.
  const subject = spec.get("SUBJECT");
  const scene = spec.get("SCENE");
  const parts = [
    sentence(subject),
    scene && scene !== subject ? sentence(scene) : "",
    sentence(spec.get("VISUAL DETAILS")),
    sentence(spec.get("ACTION AND CAMERA MOTION")),
    sentence(spec.get("CINEMATOGRAPHY")),
    sentence(spec.get("STYLE")),
    opts.nativeAudio && spec.get("AUDIO") ? `Sound: ${sentence(spec.get("AUDIO"))}` : "",
  ];
  return parts.filter(Boolean).join(" ");
}
