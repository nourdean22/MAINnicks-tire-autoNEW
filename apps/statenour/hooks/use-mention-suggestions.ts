/**
 * @mention context injection for the chat input.
 *
 * Detects `@foo` while the user types, opens a suggestion dropdown,
 * and exposes an expander that replaces the token with live context
 * from NourState before the message is sent.
 *
 * Tokens:
 *   @mit         — today's locked MIT from localStorage
 *   @revenue     — today + week + pipeline value
 *   @critical    — count + titles of critical-lane tasks
 *   @commits     — active commitment count + keep-rate
 *   @drift       — current drift state + severity
 *   @score       — RETIRED Apr 19 alongside DailyScore model
 *   @missions    — list of active mission titles
 *
 * Tokens can appear anywhere in the input. Expansion happens once,
 * just before send, turning each `@token` into a short bracketed
 * summary line so Nick sees the actual live data instead of the label.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNourState } from "@/lib/state/nour-state";

// hooks-lib REST→tRPC slice (2026-05-22) · the FINAL slice · migrated
// off `authedFetch("/api/chat/resolve-mention")` onto `trpc.chat
// .resolveMention` · the procedure delegates to the SAME `resolve-
// mention.resolveMention` service the legacy REST route also calls ·
// drift impossible. The expander fires it imperatively via
// `utils.chat.resolveMention.fetch()` right before send.
import { trpc } from "@/lib/trpc/client";
// Apr 19 · @score retired alongside DailyScore. @week still resolves
// server-side via /api/chat/resolve-mention to a brain-maturity +
// habit summary, not the old daily-score aggregate.
export type MentionKey =
  | "mit"
  | "revenue"
  | "critical"
  | "commits"
  | "drift"
  | "missions"
  | "yesterday"
  | "week"
  | "cold";

export interface Mention {
  key: MentionKey;
  label: string;
  icon: string;
  description: string;
}

// Mention catalog — the last 3 entries are the #7 "Mentions 2.0"
// additions: @yesterday, @week, @cold all expand server-side via a
// POST to /api/chat/resolve-mention so the data is always fresh.
const MENTIONS: Mention[] = [
  { key: "mit", label: "@mit", icon: "⚔", description: "Today's locked MIT" },
  { key: "revenue", label: "@revenue", icon: "💰", description: "Today · week · pipeline" },
  { key: "critical", label: "@critical", icon: "🔥", description: "Critical lane tasks" },
  { key: "commits", label: "@commits", icon: "🤝", description: "Active commitments + keep rate" },
  { key: "drift", label: "@drift", icon: "⚠", description: "Current drift state" },
  { key: "missions", label: "@missions", icon: "🎯", description: "Active missions" },
  { key: "yesterday", label: "@yesterday", icon: "🕐", description: "Yesterday's daily log summary" },
  { key: "week", label: "@week", icon: "📅", description: "This week's score + habits" },
  { key: "cold", label: "@cold", icon: "🗄", description: "Search cold memory (prompts for query)" },
];

interface MitContract {
  text: string;
  completed: boolean;
  date: string;
}

function readMit(): MitContract | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("nour:mit-contract");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MitContract;
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    if (parsed.date !== today) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function useMentionSuggestions() {
  const s = useNourState();
  const utils = trpc.useUtils();
  const [show, setShow] = useState(false);
  const [filter, setFilter] = useState("");
  const [mit, setMit] = useState<MitContract | null>(null);

  // Watch localStorage for MIT updates from other components.
  useEffect(() => {
    setTimeout(() => setMit(readMit()), 0);
    function refresh() {
      setMit(readMit());
    }
    window.addEventListener("nour:mit-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("nour:mit-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const filtered = useMemo(() => {
    if (!filter) return MENTIONS;
    const q = filter.toLowerCase();
    return MENTIONS.filter((m) => m.key.includes(q) || m.description.toLowerCase().includes(q));
  }, [filter]);

  /**
   * Called on every input change to decide if the dropdown should
   * show and what the current filter token is. Returns the current
   * open state so the parent can mirror it.
   */
  const onInputChange = useCallback((value: string, caret: number) => {
    // Look backwards from the caret for a lone '@' not preceded by a word char.
    const upToCaret = value.slice(0, caret);
    const match = upToCaret.match(/(?:^|[\s.,;!?])(@\w*)$/);
    if (match) {
      setShow(true);
      setFilter(match[1].slice(1)); // strip the '@'
    } else {
      setShow(false);
      setFilter("");
    }
  }, []);

  const close = useCallback(() => {
    setShow(false);
    setFilter("");
  }, []);

  /**
   * Resolve a single token into its current live value. Returns a
   * short bracketed summary suitable for inlining into the message.
   */
  const resolveToken = useCallback(
    (key: MentionKey): string => {
      switch (key) {
        case "mit":
          if (!mit) return "[MIT: not set yet today]";
          return `[MIT: ${mit.text}${mit.completed ? " (done)" : ""}]`;
        case "revenue":
          return `[revenue: today $${s.todayRevenue.toLocaleString()} · week $${s.weekRevenue.toLocaleString()} · pipeline $${Math.round(s.pipelineValue).toLocaleString()}${s.agingCritical > 0 ? ` (${s.agingCritical} aging critical)` : ""}]`;
        case "critical":
          return `[critical: ${s.staleLeads} stale leads · ${s.overdueCommitments} overdue commitments · ${s.urgentItems.length} urgent${s.urgentItems[0] ? ` (top: "${s.urgentItems[0].message}")` : ""}]`;
        case "commits":
          return `[commits: ${s.activeCommitments} active${s.overdueCommitments > 0 ? ` · ${s.overdueCommitments} overdue` : ""}]`;
        case "drift":
          return `[state: ${s.currentState}${s.urgentItems.length > 0 ? ` · ${s.urgentItems.length} urgent items` : ""}]`;
        case "missions": {
          // NourState doesn't carry mission titles directly but the
          // counts hint at load. Apr 18 — openLoops retired; using
          // commitments + habits as proxy for mission breadth.
          return `[missions: ${s.activeCommitments} commitments · ${s.habitsTotal} habits tracked]`;
        }
        case "yesterday": {
          // Server-expanded async — client placeholder gets swapped in
          // expandMentions(). Here we return a short sync placeholder
          // so the message still reads naturally if the async swap fails.
          return `[@yesterday: previous day's log pending server resolution]`;
        }
        case "week": {
          return `[@week: score + habits for current week pending server resolution]`;
        }
        case "cold": {
          return `[@cold: trigger searchColdMemory with the surrounding sentence]`;
        }
        default:
          return "";
      }
    },
    [s, mit]
  );

  /**
   * Server-side async expansion for mentions that need a DB query.
   * Called by expandMentionsAsync when any of @yesterday / @week /
   * @cold are present in the text. Falls through to the sync path
   * for all other tokens.
   */
  const resolveServerToken = useCallback(
    async (
      key: "yesterday" | "week" | "cold",
      surroundingText: string,
    ): Promise<string> => {
      try {
        // `chat.resolveMention`'s input is strict to the 3 async keys —
        // which is exactly the set `resolveServerToken` is ever called
        // with (see `expandMentionsAsync` · `asyncKeys`).
        const data = await utils.chat.resolveMention.fetch({
          key,
          surroundingText,
        });
        return data.value || resolveToken(key);
      } catch {
        return resolveToken(key);
      }
    },
    [resolveToken, utils]
  );

  /**
   * Called right before send() with the raw input text. Replaces every
   * @token in the text with its resolved value. Unknown tokens are left
   * untouched so slash-commands or emails aren't broken.
   */
  const expandMentions = useCallback(
    (text: string): string => {
      return text.replace(/@(\w+)/g, (full, key: string) => {
        const k = key.toLowerCase() as MentionKey;
        if (MENTIONS.some((m) => m.key === k)) {
          return resolveToken(k);
        }
        return full;
      });
    },
    [resolveToken]
  );

  /**
   * Async version of expandMentions — expands server-backed tokens
   * (@yesterday / @week / @cold) via a single API call before falling
   * back to the sync expander for everything else. Called by the chat
   * page's send() path when the text contains any async mention.
   */
  const expandMentionsAsync = useCallback(
    async (text: string): Promise<string> => {
      // Narrowed to the 3 server-resolved keys · this exact tuple is
      // what `chat.resolveMention`'s strict input enum accepts.
      const asyncKeys = ["yesterday", "week", "cold"] as const;
      const hasAsync = asyncKeys.some((k) =>
        new RegExp(`@${k}\\b`, "i").test(text)
      );
      if (!hasAsync) return expandMentions(text);

      // Replace async tokens first, then sync
      let out = text;
      for (const key of asyncKeys) {
        const re = new RegExp(`@${key}\\b`, "gi");
        if (re.test(out)) {
          const resolved = await resolveServerToken(key, text);
          out = out.replace(re, resolved);
        }
      }
      return expandMentions(out);
    },
    [expandMentions, resolveServerToken]
  );

  return {
    show,
    filter,
    filtered,
    onInputChange,
    close,
    expandMentions,
    expandMentionsAsync,
    mentions: MENTIONS,
  };
}
