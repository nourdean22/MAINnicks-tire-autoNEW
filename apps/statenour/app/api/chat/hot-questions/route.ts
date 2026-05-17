/**
 * GET /api/chat/hot-questions
 *
 * Returns the N most common user message patterns from the last 30
 * days. Used by the Hot Questions bar on the chat header for one-tap
 * access to Nour's recurring queries.
 *
 * Grouping strategy: lowercase normalize → strip punctuation →
 * token-based similarity bucket. Not perfect but good enough for the
 * top 5 — the idea is "I ask this shape of thing every day, give me
 * a button for it."
 */

import { prisma } from "@/lib/prisma";
import { recordError } from "@/lib/errors/record-error";
import { requireSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

const PATTERNS: Array<{ label: string; keywords: string[]; suggestion: string }> = [
  {
    label: "Daily pulse",
    keywords: ["pulse", "what's going on", "whats going on", "today", "status"],
    suggestion: "Give me today's pulse — revenue, MIT, habits, drift.",
  },
  {
    label: "Stale leads",
    keywords: ["stale", "leads", "follow up", "followup", "cold lead"],
    suggestion: "Show me stale leads — anything not contacted in 24h.",
  },
  {
    label: "Revenue pace",
    keywords: ["revenue", "money", "pace", "target", "pipeline"],
    suggestion: "Revenue pace — today vs target, week vs last week, pipeline value.",
  },
  {
    label: "What am I missing?",
    keywords: ["missing", "blind spot", "blindspot", "what am i not", "what should"],
    suggestion: "What am I missing that I should know about right now?",
  },
  {
    label: "Rate my day",
    keywords: ["rate", "score", "how am i doing", "grade", "discipline"],
    suggestion: "Rate my day. Be brutal. Back it with data.",
  },
  {
    label: "Next action",
    keywords: ["next", "what should i do", "do next", "now", "mit"],
    suggestion: "What's the single most important thing I should do in the next 30 minutes?",
  },
  {
    label: "Brain dump",
    keywords: ["brain dump", "dump", "thoughts", "head"],
    suggestion: "I want to brain dump — help me sort my head out.",
  },
  {
    label: "Energy check",
    keywords: ["energy", "tired", "focused", "workout", "sleep"],
    suggestion: "Energy + focus check — am I in a state to make decisions right now?",
  },
];

export async function GET(req: Request) {
  // v10.0.44 — auth gate. Pre-fix the recent 500 user chat messages
  // were content-scanned without auth, leaking topic patterns.
  await requireSession(req);
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const userMessages = await prisma.chatMessage.findMany({
      where: {
        role: "user",
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { content: true },
      take: 500,
    });

    // Count how many past messages each pattern matches
    const counts = new Map<string, number>();
    for (const p of PATTERNS) counts.set(p.label, 0);

    for (const msg of userMessages) {
      const lc = msg.content.toLowerCase();
      for (const p of PATTERNS) {
        if (p.keywords.some((k) => lc.includes(k))) {
          counts.set(p.label, (counts.get(p.label) || 0) + 1);
          break; // Only bucket into one pattern per message
        }
      }
    }

    const ranked = PATTERNS.map((p) => ({
      label: p.label,
      count: counts.get(p.label) || 0,
      suggestion: p.suggestion,
    }))
      .sort((a, b) => b.count - a.count)
      .filter((p) => p.count > 0)
      .slice(0, 6);

    // Fill with defaults if the history is sparse
    if (ranked.length < 4) {
      const filled = [...ranked];
      for (const p of PATTERNS) {
        if (filled.length >= 4) break;
        if (!filled.find((r) => r.label === p.label)) {
          filled.push({ label: p.label, count: 0, suggestion: p.suggestion });
        }
      }
      return Response.json({ hotQuestions: filled, totalMessages: userMessages.length });
    }

    return Response.json({ hotQuestions: ranked, totalMessages: userMessages.length });
  } catch (err) {
    recordError("api:unknown", err, { route: "chat/hot-questions" });
    return Response.json({ hotQuestions: [], totalMessages: 0 });
  }
}
