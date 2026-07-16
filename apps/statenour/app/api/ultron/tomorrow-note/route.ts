// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { daysAgo, toDateString } from "@/lib/utils/datetime";

import { requireSession } from "@/lib/auth-guard";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
/**
 * GET  /api/ultron/tomorrow-note — latest draft for tomorrow (if cached in BrainMemory)
 * POST /api/ultron/tomorrow-note — generate a fresh draft from today's state
 *
 * Draft structure:
 *   focus:   ONE thing to anchor to tomorrow
 *   avoid:   ONE thing Nour should NOT do
 *   anchor:  short sentence to read mid-drift
 *   reason:  why this draft (one-liner citing today's pattern)
 *
 * Storage: BrainMemory with category="tomorrow_note" and key="note:<YYYY-MM-DD>"
 * where the date is tomorrow's YYYY-MM-DD. One note per day. Regenerating
 * upserts.
 */

interface TomorrowNote {
  date: string;          // YYYY-MM-DD for the day the note applies to
  focus: string;
  avoid: string;
  anchor: string;
  reason: string;
  generatedAt: string;
  approved?: boolean;
}

function tomorrowDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toDateString(d);
}

// Apr 19 · Any cached note that references the retired DailyScore
// concept ("log score", "daily score", "self-tracking") is stale.
// The GET handler self-heals by dropping those rows on read instead
// of serving decommissioned copy.
const STALE_NOTE_RE =
  /\b(log\s+(today'?s\s+)?score|daily\s+score|self.?tracking|log\s+score)\b/i;

function isStaleNote(note: TomorrowNote | null): boolean {
  if (!note) return false;
  const blob = `${note.focus ?? ""} ${note.avoid ?? ""} ${note.anchor ?? ""} ${note.reason ?? ""}`;
  return STALE_NOTE_RE.test(blob);
}

// ─── GET ──────────────────────────────────────────────────────
export async function GET(req: Request) {
  // v10.0.529.105 · Wave 49 · was UNAUTHENTICATED · returned full
  // TomorrowNote (focus · avoid · anchor · reason) derived from
  // operator's personal task state + identity axes. POST was auth-gated.
  await requireSession(req);
  try {
    const key = `note:${tomorrowDateString()}`;
    const row = await prisma.brainMemory
      .findFirst({
        where: { category: BRAIN_CATEGORIES.TOMORROW_NOTE, key },
        orderBy: { createdAt: "desc" },
      })
      .catch(() => null);

    if (!row) return NextResponse.json({ data: null });

    // Memory content is the JSON-encoded note payload
    let parsed: TomorrowNote | null = null;
    try {
      parsed = JSON.parse(row.content) as TomorrowNote;
    } catch {
      parsed = null;
    }

    // Apr 19 · Self-heal: if the cached note references retired
    // DailyScore concepts, drop it so the next POST regenerates
    // from clean context. Returns null so the UI shows the "draft"
    // state until the next tomorrow-note cron or manual regen.
    if (isStaleNote(parsed)) {
      await prisma.brainMemory
        .delete({ where: { id: row.id } })
        .catch(() => null);
      return NextResponse.json({ data: null, invalidated: "stale-score-ref" });
    }

    return NextResponse.json({ data: parsed });
  } catch (err) {
    return NextResponse.json({ data: null, error: String(err) });
  }
}

// ─── POST — generate fresh draft ──────────────────────────────
export async function POST(req: Request) {
  await requireSession(req);
  try {
    const body = (await req.json().catch(() => ({}))) as {
      approve?: boolean;
      note?: Partial<TomorrowNote>;
    };

    const tomorrow = tomorrowDateString();
    const memKey = `note:${tomorrow}`;

    // If caller is approving an existing draft (with optional edits),
    // persist and return early.
    if (body.approve && body.note) {
      const note: TomorrowNote = {
        date: tomorrow,
        focus: (body.note.focus ?? "").trim() || "decide tomorrow's MIT on arrival",
        avoid: (body.note.avoid ?? "").trim() || "",
        anchor: (body.note.anchor ?? "").trim() || "one small thing — then the next",
        reason: (body.note.reason ?? "user-edited").trim(),
        generatedAt: new Date().toISOString(),
        approved: true,
      };
      await prisma.brainMemory.upsert({
        where: { category_key: { category: BRAIN_CATEGORIES.TOMORROW_NOTE, key: memKey } },
        create: {
          category: BRAIN_CATEGORIES.TOMORROW_NOTE,
          key: memKey,
          content: JSON.stringify(note),
          confidence: 0.9,
          source: "ultron-ui",
        },
        update: {
          content: JSON.stringify(note),
          confidence: 0.9,
        },
      });
      return NextResponse.json({ data: note });
    }

    // ── Otherwise: compose a fresh draft ──────────────────────
    // Apr 19 · DailyScore + MasteryHabit retired. Pull CURRENT live
    // signals instead: open commitments, today's DONE count, identity
    // snapshot weaknesses, open contradictions, overdue tasks.
    const todayLocal = toDateString(new Date());
    const [
      doneToday,
      openTasks,
      overdueCommitments,
      openContradictions,
      identitySnap,
      activeSkills,
      attentionTopics,
    ] = await Promise.all([
      prisma.task
        .count({ where: { status: "DONE", deletedAt: null, updatedAt: { gte: daysAgo(1) } } })
        .catch(() => 0),
      prisma.task
        .count({ where: { status: { notIn: ["DONE", "ARCHIVED"] }, deletedAt: null } })
        .catch(() => 0),
      prisma.commitment
        .count({ where: { status: "active", deadline: { lt: todayLocal }, deletedAt: null } })
        .catch(() => 0),
      prisma.brainMemory
        .count({
          where: {
            category: BRAIN_CATEGORIES.CONTRADICTION,
            deletedAt: null,
            createdAt: { gte: daysAgo(14) },
          },
        })
        .catch(() => 0),
      prisma.brainMemory
        .findUnique({
          where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
          select: { content: true },
        })
        .catch(() => null),
      prisma.brainMemory
        .count({ where: { category: BRAIN_CATEGORIES.SKILL, deletedAt: null } })
        .catch(() => 0),
      // Lightweight attention proxy from recent chat messages
      prisma.chatMessage
        .findMany({
          where: { role: "user", createdAt: { gte: daysAgo(2) } },
          select: { content: true },
          take: 30,
        })
        .catch((): Array<{ content: string }> => []),
    ]);

    // Quick topic extraction: top 3 word clusters in recent messages
    const freq = new Map<string, number>();
    for (const m of attentionTopics) {
      const words = m.content
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 4);
      for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
    }
    const topTopics = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([w]) => w);

    // Derive the weakest identity axis (if any) to surface as a tomorrow-anchor
    let weakestAxis: { name: string; value: number } | null = null;
    if (identitySnap?.content) {
      try {
        const snap = JSON.parse(identitySnap.content) as {
          axes: Record<string, { value: number; manual: number | null }>;
        };
        for (const [name, axis] of Object.entries(snap.axes)) {
          const v = axis.manual ?? axis.value;
          if (!weakestAxis || v < weakestAxis.value) {
            weakestAxis = { name, value: v };
          }
        }
      } catch {
        // skip
      }
    }

    // Build the context for the AI
    const contextLines = [
      `Date: ${todayLocal}`,
      `Tomorrow: ${tomorrow}`,
      `Tasks done today: ${doneToday}`,
      `Open tasks: ${openTasks}`,
      overdueCommitments > 0
        ? `Overdue commitments: ${overdueCommitments} (past their deadline)`
        : `Overdue commitments: 0`,
      openContradictions > 0
        ? `Open contradictions (last 14d): ${openContradictions} — positions that conflict with prior stated positions`
        : `Open contradictions: 0`,
      weakestAxis
        ? `Weakest identity axis: ${weakestAxis.name} at ${weakestAxis.value}/100`
        : `Identity snapshot: not yet computed`,
      `Active skills tracked: ${activeSkills}`,
      topTopics.length ? `Recent chat focus: ${topTopics.join(", ")}` : `Recent chat focus: (none)`,
    ].join("\n");

    const system = `You are Nick drafting a one-screen note for Nour to read FIRST THING tomorrow morning.
Rules:
- Output ONLY valid JSON matching the shape: {"focus": "", "avoid": "", "anchor": "", "reason": ""}
- focus: ONE concrete thing to anchor tomorrow. 6-12 words. Action verb.
- avoid: ONE thing to NOT do tomorrow, based on today's pattern. 4-10 words.
- anchor: A short sentence he can read mid-drift to snap back. 8-14 words. Calm, firm.
- reason: Why you chose this (cite the data). 10-20 words.
- No moralizing, no "you should". Direct.
- Anchor focus on the real signals above (overdue commitments, weak axis, open contradictions, task count).
- Never mention "log score" or "daily score" — that tracker was retired.`;

    const user = `Context for drafting tomorrow's note:\n\n${contextLines}\n\nDraft the note now. JSON only.`;

    const resp = await tracedAiChat(
      { label: "ultron-tomorrow-note", source: "tool" },
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      "fast",
    );

    let draft: TomorrowNote;
    try {
      // Strip code fences if the model wrapped it
      const clean = resp.content
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
      const parsed = JSON.parse(clean) as Partial<TomorrowNote>;
      draft = {
        date: tomorrow,
        focus: (parsed.focus ?? "").trim() || "decide tomorrow's MIT on arrival",
        avoid: (parsed.avoid ?? "").trim() || "",
        anchor: (parsed.anchor ?? "").trim() || "one small thing — then the next",
        reason: (parsed.reason ?? "").trim() || "composed from today's state",
        generatedAt: new Date().toISOString(),
        approved: false,
      };
    } catch {
      // Fallback if the model returned non-JSON: stuff the raw text into focus
      draft = {
        date: tomorrow,
        focus: resp.content.slice(0, 140).trim() || "decide tomorrow's MIT on arrival",
        avoid: "",
        anchor: "one small thing — then the next",
        reason: "raw model output (parsing failed)",
        generatedAt: new Date().toISOString(),
        approved: false,
      };
    }

    // Persist as DRAFT (upsert — regenerating overwrites)
    await prisma.brainMemory.upsert({
      where: { category_key: { category: BRAIN_CATEGORIES.TOMORROW_NOTE, key: memKey } },
      create: {
        category: BRAIN_CATEGORIES.TOMORROW_NOTE,
        key: memKey,
        content: JSON.stringify(draft),
        confidence: 0.6,
        source: `ultron-draft:${resp.provider}`,
      },
      update: {
        content: JSON.stringify(draft),
        confidence: 0.6,
        source: `ultron-draft:${resp.provider}`,
      },
    });

    return NextResponse.json({ data: draft });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
