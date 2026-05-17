/**
 * POST /api/tasks/[id]/break-promise
 *
 * Called when Nour marks a PROMISE loop as broken AFTER providing
 * a reason in the modal. Does three things:
 *
 *   1. Archives the task (status → ARCHIVED)
 *   2. Writes a BrokenPromiseLog row with the reason
 *   3. Pattern-tags the reason via a cheap keyword match so Nick
 *      can reference failure patterns later (overcommitted,
 *      low-energy, forgot, external-blocker, etc)
 *
 * Body: { reason: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

import { requireSession } from "@/lib/auth-guard";
const PATTERN_RULES: Array<{ pattern: string; regex: RegExp }> = [
  { pattern: "overcommitted", regex: /\b(too much|overwhelm|no time|busy|swamped|too many)\b/i },
  { pattern: "low-energy", regex: /\b(tired|exhausted|drained|low energy|burned out|sick)\b/i },
  { pattern: "forgot", regex: /\b(forgot|slipped|missed|didn'?t remember|forgot to)\b/i },
  { pattern: "external-blocker", regex: /\b(waiting|blocked|didn'?t show|canceled|postponed)\b/i },
  { pattern: "priority-shift", regex: /\b(priority|more important|urgent|something came up)\b/i },
  { pattern: "avoidance", regex: /\b(didn'?t want|procrastinat|avoid|dread|afraid|anxious)\b/i },
  { pattern: "scope-creep", regex: /\b(bigger than|more complicated|harder than|scope|underestimat)\b/i },
];

function detectPattern(reason: string): string {
  for (const rule of PATTERN_RULES) {
    if (rule.regex.test(reason)) return rule.pattern;
  }
  return "uncategorized";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireSession(req);
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const reason = (body.reason || "").trim();

  const task = await prisma.task.findUnique({
    where: { id },
    select: { id: true, title: true, promiseTo: true, loopKind: true },
  });

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Guard: only PROMISE loops can be "broken". A ONCE or DAILY
  // loop getting this endpoint would be a client bug — refuse to
  // archive it so we don't corrupt the task.
  if (task.loopKind !== "PROMISE") {
    return NextResponse.json(
      { error: `Cannot break a ${task.loopKind} loop — only PROMISE` },
      { status: 400 }
    );
  }

  const pattern = reason ? detectPattern(reason) : null;

  // v10.0.60 · Wave A part 3 · Pre-fix the log slot was a dead
  // Promise.resolve(null) — promise breaks were silently dropped.
  // Now persisted as BrainMemory category="promise_break" so the
  // decision-pattern learning loop sees the breakage cause.
  const [updated, log] = await Promise.all([
    prisma.task.update({
      where: { id },
      data: { status: "ARCHIVED", lastTouchedAt: new Date() },
      select: { id: true, status: true },
    }),
    prisma.brainMemory
      .create({
        data: {
          category: "promise_break",
          key: `task_${id}_${Date.now()}`,
          content: JSON.stringify({
            taskId: id,
            reason: reason ?? "(no reason)",
            pattern,
            brokenAt: new Date().toISOString(),
          }),
          confidence: 1.0,
          source: "task:break-promise",
        },
      })
      .catch(() => null),
  ]);

  return NextResponse.json({ ok: true, task: updated, log });
}
