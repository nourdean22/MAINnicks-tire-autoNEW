"use client";

/**
 * Wisdom on the Brain Memory tab (wave 2V folded the Wisdom tab in). WisdomTab fetches the whole corpus
 * (up to 1,500 rows) the moment it mounts, and Memory is the default Brain tab, so it mounts only when asked:
 * one tap, or a deep link (?focus=<key> or ?evolution=1, which WisdomTab itself reads). Codex review on #3184.
 */
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { WisdomTab } from "@/components/brain/wisdom-tab";

export function WisdomSection() {
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const deepLinked = params.get("focus") !== null || params.get("evolution") === "1";
  if (open || deepLinked) return <WisdomTab />;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex min-h-[44px] w-full items-center justify-between gap-3 border-y border-edge text-left text-sm text-fg-secondary hover:text-fg"
    >
      <span>Wisdom library</span>
      <span className="shrink-0 font-mono text-[11px] text-fg-tertiary">Open</span>
    </button>
  );
}
