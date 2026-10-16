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
  { cmd: "/drq", label: "Deep Research Prompt Writer", prompt: "DRQ: " },
  { cmd: "/nickdrq", label: "Nick's Deep Research Writer", prompt: "NICKDRQ: " },
  { cmd: "/image", label: "Generate Image", prompt: "Generate an image: " },
  { cmd: "/revenue", label: "Revenue Snapshot", prompt: "Give me a full revenue snapshot — today, this week, pipeline, aging estimates, and what needs follow-up." },
  { cmd: "/leads", label: "Stale Leads", prompt: "Show me all leads that haven't been contacted in 24+ hours. Include urgency, name, service needed." },
  { cmd: "/estimate", label: "Aging Estimates", prompt: "Show me aging estimates that need follow-up. Sort by value, include age and customer name." },
  { cmd: "/analyze", label: "Situation Analysis", prompt: "Analyze this situation through Greene's lens: " },
  { cmd: "/callback", label: "Pending Callbacks", prompt: "Show me all pending callbacks. Who needs to be called back and how urgent is each one?" },
  { cmd: "/customer", label: "Customer Lookup", prompt: "Look up customer: " },
  { cmd: "/winback", label: "Win-Back Opportunities", prompt: "Show me win-back opportunities — customers who haven't been in 90+ days with their last service and estimated value." },
  { cmd: "/weather", label: "Weather Campaign", prompt: "Check the current weather in Cleveland and tell me if any weather-triggered marketing campaigns should fire today." },
  { cmd: "/sms", label: "Draft SMS", prompt: "Draft a follow-up SMS for customer: " },
  { cmd: "/calc", label: "Estimate Calculator", prompt: "Calculate a quick estimate for: " },

  { cmd: "/brain", label: "Open Brain Dashboard", prompt: "", navigate: "/brain" },
  { cmd: "/tasks", label: "Open Tasks Queue", prompt: "", navigate: "/missions" },
  { cmd: "/journal", label: "Open Journal", prompt: "", navigate: "/journal" },
  { cmd: "/skills", label: "Skill Library in Brain", prompt: "", navigate: "/brain#skills" },
  { cmd: "/identity", label: "Identity Snapshot", prompt: "", navigate: "/brain#identity" },
  { cmd: "/beliefs", label: "Beliefs Library", prompt: "", navigate: "/brain#beliefs" },
  { cmd: "/contradictions", label: "Open Contradictions", prompt: "", navigate: "/brain#contradictions" },
  { cmd: "/ghost", label: "Ghost Nick Predictions", prompt: "", navigate: "/brain#ghost" },

  { cmd: "/new", label: "Start New Chat", prompt: "", action: "new-chat" },
  { cmd: "/history", label: "Open Conversation History", prompt: "", action: "history" },
  { cmd: "/pin", label: "Pin Last Reply", prompt: "", action: "pin-last" },
  { cmd: "/diagnose", label: "Run Chat Health Diagnostic", prompt: "", action: "diagnose" },

  { cmd: "/all", label: "Multi-output (post + reel + story)", prompt: "Generate Instagram post, reel caption, and story copy for: " },
  { cmd: "/ab", label: "A/B Variations (gen 2)", prompt: "Give me 2 different versions, A and B with different angles, of: " },
  { cmd: "/reformat", label: "Cross-platform Reformat", prompt: "Reformat this for [Facebook | Twitter | TikTok | GBP] — pick the platform and rewrite: " },
  { cmd: "/carousel", label: "Carousel Scenes (4-8 images)", prompt: "Generate a 5-scene image carousel about: " },
  { cmd: "/turbo", label: "Fast Image (z-image-turbo)", prompt: "Generate a fast turbo draft image: " },
  { cmd: "/quality", label: "Premium Image (seedream)", prompt: "Generate a billboard-quality, premium image: " },
  { cmd: "/twopass", label: "Two-Pass Content (gen + critique)", prompt: "Two-pass content with self-critique for: " },
  { cmd: "/costs", label: "AI Cost & Health Dashboard", prompt: "", navigate: "/system/costs" },
  { cmd: "/promptview", label: "View Live System Prompt", prompt: "", navigate: "/system/prompt" },
  { cmd: "/content", label: "Content History Search", prompt: "", navigate: "/content/history" },
  { cmd: "/social", label: "Publish & Schedule (IG/FB/Buffer)", prompt: "", navigate: "/social" },
  { cmd: "/plan", label: "Plan My Day (Today/Saturday/Week)", prompt: "", navigate: "/plan" },
  { cmd: "/pins", label: "Pinned Memory Manager", prompt: "", navigate: "/pins" },
  { cmd: "/saturday", label: "Plan my Saturday (with full context)", prompt: "Plan my Saturday based on my open tasks, calendar, and recent commitments. Cluster work, build in rest, intertwine with the actions/HQ/tasks pages." },
  { cmd: "/improve", label: "Photo Improver (analyze + rebrand)", prompt: "", navigate: "/photo-improver" },

  { cmd: "/today", label: "Today: done/open + top stat + one warning", prompt: "/today" },
  { cmd: "/rescue", label: "Task Rescue (misfiled/stale/low-confidence)", prompt: "/rescue" },
  { cmd: "/what-changed", label: "What Changed since last reconciliation", prompt: "/what-changed" },
  { cmd: "/receipts", label: "Recent Actions (what Nick/system did)", prompt: "/receipts" },
  { cmd: "/stale", label: "Stale docs + stale tasks summary", prompt: "/stale" },
  { cmd: "/import-session", label: "Import a pasted Claude session log", prompt: "/import-session " },
  { cmd: "/convert", label: "Convert a thought into a suggested next move", prompt: "/convert " },
  { cmd: "/triage-prune", label: "Triage Prune (untouched >14d)", prompt: "/triage-prune" },
  { cmd: "/db-vacuum", label: "Database Vacuum (reclaim space)", prompt: "/db-vacuum" },
  { cmd: "/run-cron", label: "Run Cron Job (manually)", prompt: "/run-cron " },
  // truth-substrate audit P1 (#18): preview-pushes is an implemented + unit-tested
  // backend command that was invisible in the slash menu (drift). Dry-run, safe.
  { cmd: "/preview-pushes", label: "Preview Proactive Pushes (dry-run)", prompt: "/preview-pushes " },
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
