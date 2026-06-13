/**
 * Slash command menu for chat input.
 *
 * Owns: the SLASH_COMMANDS registry, the menu open/filter state, and
 * the input-parsing logic that decides when to show the menu.
 */

"use client";

import { useCallback, useMemo, useState } from "react";

export interface SlashCommand {
  cmd: string;
  label: string;
  icon: string;
  /** Prompt template. If empty string, this command is a navigation
   *  or action command (see navigate / action fields). */
  prompt: string;
  /** Apr 19 · Optional navigation target — router-pushes this path
   *  instead of filling the input. */
  navigate?: string;
  /** Apr 19 · Optional client-side action key. Chat page maps the
   *  key to a handler (newChat / toggleHistory / pinLast /
   *  clearChat / runDiagnose / etc). */
  action?: "new-chat" | "history" | "pin-last" | "clear-chat" | "diagnose";
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // Prompt templates (fill input or fire immediately)
  { cmd: "/image", label: "Generate Image", icon: "📸", prompt: "Generate an image: " },
  { cmd: "/revenue", label: "Revenue Snapshot", icon: "📊", prompt: "Give me a full revenue snapshot — today, this week, pipeline, aging estimates, and what needs follow-up." },
  { cmd: "/leads", label: "Stale Leads", icon: "🔴", prompt: "Show me all leads that haven't been contacted in 24+ hours. Include urgency, name, service needed." },
  { cmd: "/estimate", label: "Aging Estimates", icon: "💰", prompt: "Show me aging estimates that need follow-up. Sort by value, include age and customer name." },
  { cmd: "/analyze", label: "Situation Analysis", icon: "⚔️", prompt: "Analyze this situation through Greene's lens: " },
  { cmd: "/callback", label: "Pending Callbacks", icon: "📞", prompt: "Show me all pending callbacks. Who needs to be called back and how urgent is each one?" },
  { cmd: "/customer", label: "Customer Lookup", icon: "👤", prompt: "Look up customer: " },
  // /score retired Apr 19 · DailyScore model gone; brain-maturity
  // now carries the self-model reading — use /brain instead.
  { cmd: "/winback", label: "Win-Back Opportunities", icon: "🔄", prompt: "Show me win-back opportunities — customers who haven't been in 90+ days with their last service and estimated value." },
  { cmd: "/weather", label: "Weather Campaign", icon: "🌧️", prompt: "Check the current weather in Cleveland and tell me if any weather-triggered marketing campaigns should fire today." },
  { cmd: "/sms", label: "Draft SMS", icon: "💬", prompt: "Draft a follow-up SMS for customer: " },
  { cmd: "/calc", label: "Estimate Calculator", icon: "🧮", prompt: "Calculate a quick estimate for: " },

  // Apr 19 · Navigation commands (router-push, zero prompt firing)
  { cmd: "/brain", label: "Open Brain Dashboard", icon: "🧠", prompt: "", navigate: "/brain" },
  { cmd: "/tasks", label: "Open Tasks Queue", icon: "📋", prompt: "", navigate: "/missions" },
  { cmd: "/journal", label: "Open Journal", icon: "📓", prompt: "", navigate: "/journal" },
  { cmd: "/skills", label: "Skill Library in Brain", icon: "🎯", prompt: "", navigate: "/brain#skills" },
  { cmd: "/identity", label: "Identity Snapshot", icon: "🧭", prompt: "", navigate: "/brain#identity" },
  { cmd: "/beliefs", label: "Beliefs Library", icon: "📖", prompt: "", navigate: "/brain#beliefs" },
  { cmd: "/contradictions", label: "Open Contradictions", icon: "⚠️", prompt: "", navigate: "/brain#contradictions" },
  { cmd: "/ghost", label: "Ghost Nick Predictions", icon: "👻", prompt: "", navigate: "/brain#ghost" },

  // Apr 19 · Client actions (no navigation, no prompt)
  { cmd: "/new", label: "Start New Chat", icon: "➕", prompt: "", action: "new-chat" },
  { cmd: "/history", label: "Toggle History", icon: "🕘", prompt: "", action: "history" },
  { cmd: "/pin", label: "Pin Last Message", icon: "📌", prompt: "", action: "pin-last" },
  { cmd: "/clear", label: "Clear Conversation", icon: "🧹", prompt: "", action: "clear-chat" },
  { cmd: "/diagnose", label: "Chat Health Diagnostic", icon: "🩺", prompt: "", action: "diagnose" },

  // v6 · BATCH 3 · Apr 28 — content-engine power-ups
  // These prompt templates flip the chat into multi-output mode by
  // including marker keywords the route + interceptor recognize.
  { cmd: "/all", label: "Multi-output (post + reel + story)", icon: "🎯", prompt: "Generate Instagram post, reel caption, and story copy for: " },
  { cmd: "/ab", label: "A/B Variations (gen 2)", icon: "🅰️🅱️", prompt: "Give me 2 different versions, A and B with different angles, of: " },
  { cmd: "/reformat", label: "Cross-platform Reformat", icon: "🔄", prompt: "Reformat this for [Facebook | Twitter | TikTok | GBP] — pick the platform and rewrite: " },
  { cmd: "/carousel", label: "Carousel Scenes (4-8 images)", icon: "🎠", prompt: "Generate a 5-scene image carousel about: " },
  { cmd: "/turbo", label: "Fast Image (z-image-turbo)", icon: "⚡", prompt: "Generate a fast turbo draft image: " },
  { cmd: "/quality", label: "Premium Image (seedream)", icon: "🏆", prompt: "Generate a billboard-quality, premium image: " },
  { cmd: "/twopass", label: "Two-Pass Content (gen + critique)", icon: "🔬", prompt: "Two-pass content with self-critique for: " },
  { cmd: "/costs", label: "AI Cost & Health Dashboard", icon: "💸", prompt: "", navigate: "/system/costs" },
  { cmd: "/promptview", label: "View Live System Prompt", icon: "🔬", prompt: "", navigate: "/system/prompt" },
  { cmd: "/content", label: "Content History Search", icon: "📜", prompt: "", navigate: "/content/history" },
  { cmd: "/social", label: "Publish & Schedule (IG/FB/Buffer)", icon: "📤", prompt: "", navigate: "/social" },
  // v10.0.302 · /intel slash-command removed · page deleted (low-signal
  // automotive-RSS surface that no longer earned its space).
  { cmd: "/plan", label: "Plan My Day (Today/Saturday/Week)", icon: "📅", prompt: "", navigate: "/plan" },
  { cmd: "/pins", label: "Pinned Memory Manager", icon: "📌", prompt: "", navigate: "/pins" },
  { cmd: "/saturday", label: "Plan my Saturday (with full context)", icon: "🛠️", prompt: "Plan my Saturday based on my open tasks, calendar, and recent commitments. Cluster work, build in rest, intertwine with the actions/HQ/tasks pages." },
  { cmd: "/improve", label: "Photo Improver (analyze + rebrand)", icon: "🖼️", prompt: "", navigate: "/photo-improver" },

  // 2026-06-09 · F5 operator command shortcuts. The chat interceptor runs the
  // F5 command registry server-side; selecting fills the input, send to run.
  { cmd: "/today", label: "Today: done/open + top stat + one warning", icon: "📅", prompt: "/today" },
  { cmd: "/rescue", label: "Task Rescue (misfiled/stale/low-confidence)", icon: "🛟", prompt: "/rescue" },
  { cmd: "/what-changed", label: "What Changed since last reconciliation", icon: "🔭", prompt: "/what-changed" },
  { cmd: "/receipts", label: "Recent Actions (what Nick/system did)", icon: "🧾", prompt: "/receipts" },
  { cmd: "/stale", label: "Stale docs + stale tasks summary", icon: "⏳", prompt: "/stale" },
  { cmd: "/import-session", label: "Import a pasted Claude session log", icon: "📥", prompt: "/import-session " },
  { cmd: "/convert", label: "Convert a thought into a suggested next move", icon: "💡", prompt: "/convert " },
  { cmd: "/triage-prune", label: "Triage Prune (untouched >14d)", icon: "🧹", prompt: "/triage-prune" },
  { cmd: "/db-vacuum", label: "Database Vacuum (reclaim space)", icon: "🗄️", prompt: "/db-vacuum" },
  { cmd: "/run-cron", label: "Run Cron Job (manually)", icon: "⚙️", prompt: "/run-cron " },
];

export function useSlashCommands() {
  const [show, setShow] = useState(false);
  const [filter, setFilter] = useState("");

  /** Call on every input change — decides if the menu should open/close */
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
      (c) => c.cmd.includes(filter) || c.label.toLowerCase().includes(filter)
    );
  }, [filter]);

  return {
    show,
    filter,
    filtered,
    onInputChange,
    close,
    commands: SLASH_COMMANDS,
  };
}
