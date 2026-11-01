/**
 * Slash command menu for chat input.
 *
 * Owns the command registry plus the open/filter state. Every visible action
 * below has a real consumer in chat-v2; destructive local-only clear was
 * removed because it looked like durable conversation deletion while only
 * wiping the browser message array.
 */

"use client";

import { useCallback, useMemo, useState } from "react";

export interface SlashCommand {
  cmd: string;
  label: string;
  prompt: string;
  navigate?: string;
  action?: "new-chat" | "history" | "pin-last" | "diagnose";
}

// Exported so the drift-guard test (tests/ai/command-drift.test.ts) can assert
// every backend F5 command surfaces here. truth-substrate audit P1 (#18).
export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/drq", label: "Deep research prompt writer", prompt: "DRQ: " },
  { cmd: "/nickdrq", label: "Nick's deep research writer", prompt: "NICKDRQ: " },
  { cmd: "/image", label: "Generate image", prompt: "Generate an image: " },
  { cmd: "/revenue", label: "Revenue snapshot", prompt: "Give me a full revenue snapshot — today, this week, pipeline, aging estimates, and what needs follow-up." },
  { cmd: "/leads", label: "Stale leads", prompt: "Show me all leads that haven't been contacted in 24+ hours. Include urgency, name, service needed." },
  { cmd: "/estimate", label: "Aging estimates", prompt: "Show me aging estimates that need follow-up. Sort by value, include age and customer name." },
  { cmd: "/analyze", label: "Situation analysis", prompt: "Analyze this situation through Greene's lens: " },
  { cmd: "/callback", label: "Pending callbacks", prompt: "Show me all pending callbacks. Who needs to be called back and how urgent is each one?" },
  { cmd: "/customer", label: "Customer lookup", prompt: "Look up customer: " },
  { cmd: "/winback", label: "Win-back opportunities", prompt: "Show me win-back opportunities — customers who haven't been in 90+ days with their last service and estimated value." },
  { cmd: "/weather", label: "Weather campaign", prompt: "Check the current weather in Cleveland and tell me if any weather-triggered marketing campaigns should fire today." },
  { cmd: "/sms", label: "Draft SMS", prompt: "Draft a follow-up SMS for customer: " },
  { cmd: "/calc", label: "Estimate calculator", prompt: "Calculate a quick estimate for: " },

  { cmd: "/brain", label: "Open brain dashboard", prompt: "", navigate: "/brain" },
  { cmd: "/tasks", label: "Open tasks queue", prompt: "", navigate: "/missions" },
  { cmd: "/journal", label: "Open journal", prompt: "", navigate: "/journal" },
  { cmd: "/skills", label: "Skill library in Brain", prompt: "", navigate: "/brain#skills" },
  { cmd: "/identity", label: "Identity snapshot", prompt: "", navigate: "/settings#identity" },
  { cmd: "/beliefs", label: "Beliefs library", prompt: "", navigate: "/brain#beliefs" },
  { cmd: "/contradictions", label: "Open contradictions", prompt: "", navigate: "/brain#contradictions" },
  { cmd: "/ghost", label: "Ghost Nick predictions", prompt: "", navigate: "/stats?tab=goals#forecast-duel" }, // wave E2: moved to Stats Goals

  { cmd: "/new", label: "Start new chat", prompt: "", action: "new-chat" },
  { cmd: "/history", label: "Open conversation history", prompt: "", action: "history" },
  { cmd: "/pin", label: "Pin last reply", prompt: "", action: "pin-last" },
  { cmd: "/diagnose", label: "Run chat health diagnostic", prompt: "", action: "diagnose" },

  { cmd: "/all", label: "Multi-output (post + reel + story)", prompt: "Generate Instagram post, reel caption, and story copy for: " },
  { cmd: "/ab", label: "A/B variations (gen 2)", prompt: "Give me 2 different versions, A and B with different angles, of: " },
  { cmd: "/reformat", label: "Cross-platform reformat", prompt: "Reformat this for [Facebook | Twitter | TikTok | GBP] — pick the platform and rewrite: " },
  { cmd: "/carousel", label: "Carousel scenes (4-8 images)", prompt: "Generate a 5-scene image carousel about: " },
  { cmd: "/turbo", label: "Fast image (z-image-turbo)", prompt: "Generate a fast turbo draft image: " },
  { cmd: "/quality", label: "Premium image (seedream)", prompt: "Generate a billboard-quality, premium image: " },
  { cmd: "/twopass", label: "Two-pass content (gen + critique)", prompt: "Two-pass content with self-critique for: " },
  { cmd: "/promptview", label: "View live system prompt", prompt: "", navigate: "/system/prompt" },
  { cmd: "/plan", label: "Plan my day (today/Saturday/week)", prompt: "", navigate: "/plan" },
  { cmd: "/pinned", label: "Pinned memory (Brain)", prompt: "", navigate: "/brain?tab=memory#pinned-context" },
  { cmd: "/pins", label: "Pinned memory (Brain)", prompt: "", navigate: "/brain?tab=memory#pinned-context" }, // retired-route-allow: 2026-10-19 muscle-memory alias for /pinned, a chat verb and not a link
  { cmd: "/saturday", label: "Plan my Saturday (with full context)", prompt: "Plan my Saturday based on my open tasks, calendar, and recent commitments. Cluster work, build in rest, intertwine with the actions/HQ/tasks pages." },
  { cmd: "/improve", label: "Photo Improver (analyze + rebrand)", prompt: "", navigate: "/photo-improver" },

  { cmd: "/today", label: "Today: done/open + top stat + one warning", prompt: "/today" },
  { cmd: "/rescue", label: "Task rescue (misfiled/stale/low-confidence)", prompt: "/rescue" },
  { cmd: "/what-changed", label: "What changed since last reconciliation", prompt: "/what-changed" },
  { cmd: "/receipts", label: "Recent actions (what Nick/system did)", prompt: "/receipts" },
  { cmd: "/stale", label: "Stale docs + stale tasks summary", prompt: "/stale" },
  { cmd: "/import-session", label: "Import a pasted Claude session log", prompt: "/import-session " },
  { cmd: "/convert", label: "Convert a thought into a suggested next move", prompt: "/convert " },
  { cmd: "/triage-prune", label: "Triage Prune (untouched >14d)", prompt: "/triage-prune" },
  { cmd: "/db-vacuum", label: "Database vacuum (reclaim space)", prompt: "/db-vacuum" },
  { cmd: "/run-cron", label: "Run cron job (manually)", prompt: "/run-cron " },
  // truth-substrate audit P1 (#18): preview-pushes is an implemented + unit-tested
  // backend command that was invisible in the slash menu (drift). Dry-run, safe.
  { cmd: "/preview-pushes", label: "Preview proactive pushes (dry-run)", prompt: "/preview-pushes " },
];

export function useSlashCommands() {
  const [show, setShow] = useState(false);
  const [filter, setFilter] = useState("");

  const onInputChange = useCallback((value: string) => {
    if (value === "/") {
      setShow(true);
      setFilter("");
    } else if (value.startsWith("/") && !value.includes(" ")) {
      setShow(true);
      setFilter(value.toLowerCase());
    } else {
      setShow(false);
      setFilter("");
    }
  }, []);

  const close = useCallback(() => {
    setShow(false);
    setFilter("");
  }, []);

  const filtered = useMemo(() => {
    if (!filter) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (c) => c.cmd.includes(filter) || c.label.toLowerCase().includes(filter),
    );
  }, [filter]);

  return { show, filter, filtered, onInputChange, close, commands: SLASH_COMMANDS };
}
