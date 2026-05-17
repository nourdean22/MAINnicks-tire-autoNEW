/**
 * POST /api/telegram/revenue-decision-callback · v10.0.526 · Arc C · Feature 1
 *
 * Dedicated callback path for the revenue-decision approval flow. Lifted
 * the HMAC + chat-id pattern from `app/api/telegram/webhook/route.ts` so
 * the standing webhook stays focused on its existing /status, /memory,
 * /ask commands while this one only routes /approve_N, /reject_N,
 * /approve_all, /reject_all replies.
 *
 * Why a separate route (not folded into the main webhook): Telegram
 * webhooks are single-target. The operator can manually set this URL
 * via setWebhook if they want it to handle the entire bot, or the
 * existing webhook can forward `text.startsWith("/approve_") ||
 * "/reject_"` here. The standalone route also makes the contract
 * easier to test in isolation (the existing webhook's 1000-line file
 * is heavy to mock).
 *
 * Idempotency: `decideMove` is upsert-style · a duplicate /approve_1
 * returns `alreadyDecided: true` and DOESN'T mutate the row a second
 * time. So Telegram's at-least-once delivery semantics are safe.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sendTelegram } from "@/lib/services/telegram";
import {
  decideAllForDate,
  decideMove,
  etDateKey,
  listPendingMovesForDate,
} from "@/lib/services/revenue-decision-channel";

export const maxDuration = 30;

const EXPECTED_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!EXPECTED_SECRET) {
  console.warn(
    "[telegram:revenue-decision-callback] TELEGRAM_WEBHOOK_SECRET is not set. Endpoint will 503 until configured.",
  );
}

/**
 * Constant-time secret compare · same pattern as the main webhook so
 * an attacker can't timing-attack the 256-char secret. Inlined (not
 * imported) so this module stays dependency-light at load.
 */
function safeSecretEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

const APPROVE_N_RE = /^\/approve_(\d+)$/i;
const REJECT_N_RE = /^\/reject_(\d+)$/i;
const APPROVE_ALL_RE = /^\/approve_all$/i;
const REJECT_ALL_RE = /^\/reject_all$/i;

export async function POST(req: NextRequest) {
  if (!EXPECTED_SECRET) {
    return NextResponse.json(
      { ok: false, error: "TELEGRAM_WEBHOOK_SECRET not configured", code: "ENV_MISSING" },
      { status: 503 },
    );
  }
  const provided = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeSecretEqual(provided, EXPECTED_SECRET)) {
    return NextResponse.json({ ok: false, error: "bad secret" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const message = body.message as
    | { text?: string; chat: { id: number } }
    | undefined;
  if (!message?.text) return NextResponse.json({ ok: true });

  const chatId = String(message.chat.id);
  const expectedChat = process.env.TELEGRAM_CHAT_ID;
  if (expectedChat && chatId !== expectedChat) {
    // Foreign chat · silent drop (matches the main webhook's behavior).
    return NextResponse.json({ ok: true });
  }

  const text = message.text.trim();
  const date = etDateKey();

  // Single-move approve · /approve_1
  const approveMatch = text.match(APPROVE_N_RE);
  if (approveMatch) {
    const n = Number(approveMatch[1]);
    const result = await decideMove(date, n, "approved");
    await replyToOperator(result, n, "approved", date, chatId);
    return NextResponse.json({ ok: true, decision: result });
  }

  // Single-move reject · /reject_1
  const rejectMatch = text.match(REJECT_N_RE);
  if (rejectMatch) {
    const n = Number(rejectMatch[1]);
    const result = await decideMove(date, n, "rejected");
    await replyToOperator(result, n, "rejected", date, chatId);
    return NextResponse.json({ ok: true, decision: result });
  }

  // Bulk approve · /approve_all
  if (APPROVE_ALL_RE.test(text)) {
    const pending = await listPendingMovesForDate(date);
    if (pending.length === 0) {
      await sendTelegram(
        `<b>${date}</b> · no pending moves to approve.`,
        chatId,
        "HTML",
      );
      return NextResponse.json({ ok: true, decision: { updated: 0, alreadyDecided: 0 } });
    }
    const r = await decideAllForDate(date, "approved");
    await sendTelegram(
      `<b>${date}</b> · approved ${r.updated} move${r.updated === 1 ? "" : "s"}${
        r.alreadyDecided > 0 ? ` (${r.alreadyDecided} already decided)` : ""
      }.`,
      chatId,
      "HTML",
    );
    return NextResponse.json({ ok: true, decision: r });
  }

  // Bulk reject · /reject_all
  if (REJECT_ALL_RE.test(text)) {
    const pending = await listPendingMovesForDate(date);
    if (pending.length === 0) {
      await sendTelegram(
        `<b>${date}</b> · no pending moves to reject.`,
        chatId,
        "HTML",
      );
      return NextResponse.json({ ok: true, decision: { updated: 0, alreadyDecided: 0 } });
    }
    const r = await decideAllForDate(date, "rejected");
    await sendTelegram(
      `<b>${date}</b> · rejected ${r.updated} move${r.updated === 1 ? "" : "s"}${
        r.alreadyDecided > 0 ? ` (${r.alreadyDecided} already decided)` : ""
      }.`,
      chatId,
      "HTML",
    );
    return NextResponse.json({ ok: true, decision: r });
  }

  // Not a revenue-decision command · silent ack (main webhook handles
  // everything else if this endpoint is the registered target).
  return NextResponse.json({ ok: true, ignored: true });
}

async function replyToOperator(
  result:
    | { ok: true; alreadyDecided: boolean; status: "approved" | "rejected" }
    | { ok: false; reason: string },
  n: number,
  decision: "approved" | "rejected",
  date: string,
  chatId: string,
): Promise<void> {
  if (!result.ok) {
    await sendTelegram(
      `<b>${date}</b> · move ${n} not found. (${result.reason})`,
      chatId,
      "HTML",
    );
    return;
  }
  if (result.alreadyDecided) {
    await sendTelegram(
      `<b>${date}</b> · move ${n} was already ${result.status}.`,
      chatId,
      "HTML",
    );
    return;
  }
  await sendTelegram(
    `<b>${date}</b> · move ${n} · <b>${decision}</b>.`,
    chatId,
    "HTML",
  );
  void decision; // explicit for the type checker
}
