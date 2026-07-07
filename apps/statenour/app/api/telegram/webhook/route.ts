/**
 * POST /api/telegram/webhook
 *
 * Handles Telegram Bot updates:
 *   1. callback_query — inline button presses (approve morning, etc.)
 *   2. message — text commands from Nour (/status, /schedule, etc.)
 *
 * Register once:
 *   curl "https://api.telegram.org/bot$TOKEN/setWebhook?url=https://bdnick.info/api/telegram/webhook"
 *
 * Commands:
 *   /status    — Quick system snapshot (revenue, leads, loops, alerts)
 *   /schedule  — Today's time-blocked schedule
 *   /staffing  — Tomorrow's staffing prediction
 *   /memory <query> — Semantic search of brain memories
 *   /brain     — Brain health stats
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  answerCallbackQuery,
  editTelegramMessage,
  sendTelegram,
} from "@/lib/services/telegram";
import { confirmJournalLink, type JournalSilo } from "@/lib/brain/journal-brain";

/**
 * v9.1.14 · Constant-time secret compare. The previous `provided !==
 * EXPECTED_SECRET` was vulnerable to timing-attack inference of the
 * 256-char Telegram secret. This helper matches the safeEqual pattern
 * already in lib/auth-guard.ts (kept inline here so the webhook stays
 * dependency-light at module-load).
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

export const maxDuration = 30;

/**
 * Telegram is configured with a `secret_token` at setWebhook time.
 * Every POST to this endpoint carries header
 *   X-Telegram-Bot-Api-Secret-Token: <value>
 * which we validate before doing anything. Without this, anyone who
 * learns the webhook URL can forge updates. The chat-id check below
 * is a second layer — it rejects messages from unknown chats — but
 * doesn't help if an attacker spoofs Nour's chat id.
 *
 * v8.21 · Apr 29 · HARDENED · v8.33 · Apr 30 · UN-FOOTGUNNED.
 * v8.21 introduced a module-load throw if TELEGRAM_WEBHOOK_SECRET was
 * unset. That made Vercel's build step fail entirely (every Apr 29
 * deploy bounced) because Next compiles every route's module at build
 * time and the throw fired during compilation, before the env actually
 * needs to exist.
 *
 * v8.33 fixes that: the check moves into the request handler. Build
 * succeeds even when the env var isn't yet set; any inbound request
 * with the env unset returns 503 (Service Unavailable, plus a clear
 * message in logs). Forged or unsigned requests still get 401.
 *
 * Net: same fail-closed semantic for traffic, no build break.
 */
const EXPECTED_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!EXPECTED_SECRET) {
  // Surface the misconfig prominently in startup logs so dev/prod
  // operators see it. NOT a throw — see comment above.
  console.warn(
    "[telegram:webhook] TELEGRAM_WEBHOOK_SECRET is not set. The endpoint will refuse all traffic with 503 until the env var is configured.",
  );
}

export async function POST(req: NextRequest) {
  // Fail-closed if the env var is missing in this runtime instance.
  // 503 (not 401) so the operator immediately knows it's a config gap
  // versus a forged-secret rejection.
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

  // ── Handle callback_query (inline button press) ──
  const callback = body.callback_query as {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
    from?: { id: number };
  } | undefined;

  const expectedOwnerId = Number(process.env.TELEGRAM_OWNER_ID);

  if (callback?.data) {
    if (callback.from?.id !== expectedOwnerId) return NextResponse.json({ ok: true });
    await handleCallback(callback);
    return NextResponse.json({ ok: true });
  }

  // ── Handle message (text, photos, voice, etc.) ──
  const message = body.message as {
    text?: string;
    photo?: { file_id: string; width: number; height: number }[];
    voice?: { file_id: string; duration: number };
    caption?: string;
    entities?: { type: string; url?: string; offset: number; length: number }[];
    chat: { id: number };
    from?: { id: number };
  } | undefined;

  if (!message) return NextResponse.json({ ok: true });

  if (message.from?.id !== expectedOwnerId) {
    return NextResponse.json({ ok: true });
  }

  const chatId = String(message.chat.id);
  const expectedChat = process.env.TELEGRAM_CHAT_ID;
  if (expectedChat && chatId !== expectedChat) {
    return NextResponse.json({ ok: true });
  }

  // Photo input — analyze image
  if (message.photo && message.photo.length > 0) {
    await handlePhoto(message.photo, message.caption, chatId);
    return NextResponse.json({ ok: true });
  }

  // Voice note input — transcribe and act
  if (message.voice) {
    await handleVoice(message.voice, chatId);
    return NextResponse.json({ ok: true });
  }

  // Text with URLs — analyze links
  if (message.text && message.entities?.some((e) => e.type === "url")) {
    const urls = message.entities
      .filter((e) => e.type === "url")
      .map((e) => message.text!.substring(e.offset, e.offset + e.length));
    if (urls.length > 0) {
      await handleUrl(urls[0], message.text, chatId);
      return NextResponse.json({ ok: true });
    }
  }

  // Text commands
  if (message.text) {
    await handleCommand(message.text, chatId);
  }

  return NextResponse.json({ ok: true });
}

// ── Callback handler (inline buttons) ─────────────────────

async function handleCallback(callback: {
  id: string;
  data?: string;
  message?: { message_id: number; chat: { id: number } };
}): Promise<void> {
  const [action, param] = (callback.data ?? "").split(":");
  const messageId = callback.message?.message_id;
  const chatId = String(callback.message?.chat?.id ?? "");

  const { prisma } = await import("@/lib/prisma");

  try {
    // Deduplicate/track via ActionReceipt
    const actionKey = callback.data ?? "unknown";
    const receipt = await (prisma as any).actionReceipt.create({
      data: {
        action: actionKey,
        status: "PENDING",
      }
    });

    // Journal Brain · confirm/reject a proposed goal link from the phone.
    // callback_data: jlink:c|r:<silo>:<id>
    if (action === "jlink") {
      const parts = (callback.data ?? "").split(":");
      const accept = parts[1] === "c";
      const silo = parts[2] as JournalSilo;
      const entryId = parts.slice(3).join(":");
      const r = await confirmJournalLink(silo, entryId, accept);
      await answerCallbackQuery(
        callback.id,
        r.ok ? (accept ? "Linked ✓" : "Dismissed") : "Entry not found",
      );
      if (messageId) {
        await editTelegramMessage(
          messageId,
          accept ? "🔗 Goal link confirmed ✓" : "🔗 Link dismissed.",
          chatId,
        );
      }
      await (prisma as any).actionReceipt.update({
        where: { id: receipt.id },
        data: { status: "SUCCESS" }
      });
      return;
    }

    if (action === "intell_recall") {
      const parts = (callback.data ?? "").split(":");
      const decision = parts[1];
      const receiptId = parts[2];

      const intellReceipt = await prisma.actionReceipt.findUnique({ where: { id: receiptId } });
      if (!intellReceipt) {
        await answerCallbackQuery(callback.id, "Receipt not found.");
        return;
      }

      if (intellReceipt.status !== "PENDING") {
        if (messageId) {
          await editTelegramMessage(messageId, `⚠️ Alert already processed.`, chatId);
        }
        await answerCallbackQuery(callback.id, "Already processed.");
        return;
      }

      const payload = intellReceipt.verificationPayload as any;
      if (!payload || typeof payload !== "object" || !payload.phone || !payload.smsBody) {
        console.error("[telegram:webhook] Malformed recall payload on receipt:", receiptId, payload);
        await prisma.actionReceipt.update({
          where: { id: receiptId },
          data: {
            status: "FAILED",
            context: `Malformed payload: ${JSON.stringify(payload)}`
          }
        });
        if (messageId) {
          await editTelegramMessage(messageId, `❌ Recall alert failed: Malformed payload.`, chatId);
        }
        await answerCallbackQuery(callback.id, "Malformed payload.");
        return;
      }

      if (decision === "approve") {
        // Send Capevace SMS Gateway mock
        console.log(`[Capevace Gateway Mock] SMS to ${payload.phone}: ${payload.smsBody}`);
        
        await prisma.actionReceipt.update({
          where: { id: receiptId },
          data: {
            status: "SUCCESS",
            executedAt: new Date()
          }
        });
        
        if (messageId) {
          await editTelegramMessage(
            messageId,
            `✅ SMS Dispatched to ${payload.customerName} for ${payload.vehicle} recall.`,
            chatId
          );
        }
        await answerCallbackQuery(callback.id, "Approved!");
      } else {
        await prisma.actionReceipt.update({
          where: { id: receiptId },
          data: {
            status: "FAILED",
            context: "Rejected by operator"
          }
        });
        if (messageId) {
          await editTelegramMessage(
            messageId,
            `❌ Recall alert rejected.`,
            chatId
          );
        }
        await answerCallbackQuery(callback.id, "Rejected");
      }
      return;
    }

    if (action === "approve" || action === "deny") {
      const receiptId = param;
      const actReceipt = await prisma.actionReceipt.findUnique({ where: { id: receiptId } });
      if (!actReceipt) {
        await answerCallbackQuery(callback.id, "Receipt not found.");
        return;
      }

      if (actReceipt.status !== "PENDING") {
        if (messageId) {
          await editTelegramMessage(messageId, `⚠️ Action already processed.`, chatId);
        }
        await answerCallbackQuery(callback.id, "Already processed.");
        return;
      }

      if (action === "approve") {
        const payload = actReceipt.verificationPayload as any;
        if (!payload || typeof payload !== "object" || !payload.phone || !payload.message) {
          console.error("[telegram:webhook] Malformed SMS payload on receipt:", receiptId, payload);
          await prisma.actionReceipt.update({
            where: { id: receiptId },
            data: {
              status: "FAILED",
              context: `Malformed payload: ${JSON.stringify(payload)}`
            }
          });
          if (messageId) {
            await editTelegramMessage(messageId, `❌ SMS failed: Malformed payload.`, chatId);
          }
          await answerCallbackQuery(callback.id, "Malformed payload.");
          return;
        }

        const { callNickstire } = await import("@/lib/ai/agent-actions/shop-actions");
        try {
          const res = await callNickstire("smsBot.send", { phone: String(payload.phone), message: String(payload.message) });
          if (res) {
            await prisma.actionReceipt.update({
              where: { id: receiptId },
              data: {
                status: "SUCCESS",
                executedAt: new Date()
              }
            });
            if (messageId) {
              await editTelegramMessage(
                messageId,
                `🔗 Approved & Sent ✓\n\n<b>To:</b> ${payload.customerName || "Unknown"} (${payload.phone})\n<b>Message:</b> "${payload.message}"`,
                chatId
              );
            }
            await answerCallbackQuery(callback.id, "SMS Dispatched!");
          } else {
            throw new Error("smsBot.send returned falsy response");
          }
        } catch (err) {
          console.error("[telegram:webhook] SMS dispatch error:", err);
          await prisma.actionReceipt.update({
            where: { id: receiptId },
            data: {
              status: "FAILED",
              context: err instanceof Error ? err.message : String(err)
            }
          });
          if (messageId) {
            await editTelegramMessage(messageId, `❌ SMS dispatch failed.`, chatId);
          }
          await answerCallbackQuery(callback.id, "Dispatch failed.");
        }
      } else {
        await prisma.actionReceipt.update({
          where: { id: receiptId },
          data: {
            status: "FAILED",
            context: "Rejected by operator"
          }
        });
        if (messageId) {
          const payload = actReceipt.verificationPayload as any;
          await editTelegramMessage(
            messageId,
            `❌ Staged SMS Declined.\n\n<b>To:</b> ${payload?.customerName || "Unknown"} (${payload?.phone})\n<b>Message:</b> "${payload?.message}"`,
            chatId
          );
        }
        await answerCallbackQuery(callback.id, "Declined.");
      }
      return;
    }

    // Apr 17 separation pass — autopilot-morning approval flow retired
    // along with the cron that produced it. Shop-side approvals now
    // live in nickstire.org/admin.
    await answerCallbackQuery(callback.id, "Unknown action.");
    await (prisma as any).actionReceipt.update({
      where: { id: receipt.id },
      data: { status: "SUCCESS" }
    });
    void action;
    void param;
    void messageId;
  } catch (err) {
    console.error("[telegram:webhook] Callback error:", err);
    await answerCallbackQuery(callback.id, "Error processing action.");
  }
}

// ── Command handler (text messages) ───────────────────────

async function handleCommand(text: string, chatId: string): Promise<void> {
  const trimmed = text.trim();
  const [cmd, ...args] = trimmed.split(/\s+/);
  const command = cmd.toLowerCase();

  try {
    switch (command) {
      case "/status":
        return await cmdStatus(chatId);
      case "/schedule":
        return await cmdSchedule(chatId);
      case "/memory":
        return await cmdMemory(args.join(" "), chatId);
      case "/brain":
        return await cmdBrain(chatId);
      // v8.7 BATCH 42 — recent active alerts
      case "/alerts":
        return await cmdAlerts(chatId);
      case "/imagine":
        return await cmdImagine(args.join(" "), chatId);
      // ── Remote-write commands (#26 Telegram as full remote) ──
      // /score retired Apr 18 alongside DailyScore UI retirement.
      case "/dump":
      case "/braindump":
        return await cmdDump(args.join(" "), chatId);
      case "/task":
      case "/todo":
        return await cmdTask(args.join(" "), chatId);
      case "/mit":
        return await cmdMit(args.join(" "), chatId);
      case "/commit":
        return await cmdCommit(args.join(" "), chatId);
      case "/ask":
      case "/nick":
        return await cmdAsk(args.join(" "), chatId);
      // v8.23 — phone-first remote read extensions
      case "/goals":
        return await cmdGoals(chatId);
      case "/predict":
      case "/predictions":
        return await cmdPredict(chatId);
      case "/search":
        return await cmdSearch(args.join(" "), chatId);
      case "/stats":
        return await cmdStats(chatId);
      // 2026-05-17 · Wave-200 follow-up · bulk-SMS approval gate
      // (see src/inngest/functions/bulk-sms-approval.ts). Operator
      // approves/rejects pending campaigns straight from Telegram.
      case "/approve":
        return await cmdApprove(args.join(" "), chatId);
      case "/reject":
        return await cmdReject(args.join(" "), chatId);
      // 2026-05-28 · Wave AG · Nick Action Queue · daily approval.
      // Operator replies "/qa 1 3" / "/qa all" / "/qa none" to the
      // 8am morning batch · execute cron at 9am ships approved rows.
      case "/qa":
        return await cmdQa(args.join(" "), chatId);
      case "/help":
        return await sendTelegram(
          `🤖 <b>Nick Commands — Personal OS</b>\n\n` +
            `<b>READ</b>\n` +
            `/status — System snapshot\n` +
            `/schedule — Today's schedule\n` +
            `/memory [q] — Search memories\n` +
            `/search [q] — Semantic search journal + chat\n` +
            `/brain — Brain health\n` +
            `/goals — Active goals + pace\n` +
            `/predict — Top open predictions\n` +
            `/stats — Quick numeric snapshot\n` +
            `/alerts — Recent active alerts\n` +
            `/imagine [prompt] — Generate image\n` +
            `\n<b>WRITE (remote control)</b>\n` +
            `/dump [text] — Brain dump to journal\n` +
            `/task [text] — Create task\n` +
            `/mit [text] — Set today's MIT\n` +
            `/commit [text] — Create commitment\n` +
            `/ask [question] — Ask Nick anything\n\n` +
            `\n<b>OUTREACH (Wave-200)</b>\n` +
            `/approve [campaignId] — Approve pending bulk-SMS\n` +
            `/reject [campaignId] — Reject pending bulk-SMS\n` +
            `\n<b>NICK QUEUE (Wave AG · 2026-05-28)</b>\n` +
            `/qa 1 3 — approve today's queued moves #1 and #3\n` +
            `/qa all — approve every move in today's queue\n` +
            `/qa none — reject every move in today's queue\n\n` +
            `<i>Shop ops (pace, staffing, customers) live in nickstire.org/admin.</i>`,
          chatId
        ).then(() => {});
      default:
        // Not a command — ignore (don't spam back)
        return;
    }
  } catch (err) {
    console.error("[telegram:cmd]", command, err);
    await sendTelegram(`⚠️ Command failed: ${err instanceof Error ? err.message : "unknown error"}`, chatId);
  }
}

// ── Remote-write commands (#26) ───────────────────────────
// Turns Telegram into a full remote control for NOUR OS. Every
// command hits the same service layer the web UI uses, so nothing
// drifts between the two surfaces.

async function cmdDump(args: string, chatId: string): Promise<void> {
  if (!args.trim()) {
    await sendTelegram(
      `Usage: /dump [text]\n\nDumps the text through the full brain-dump ingest pipeline (extracts tasks, insights, commitments, mood, type).`,
      chatId
    );
    return;
  }
  try {
    const { ingestJournal } = await import("@/lib/brain/journal-ingest");
    const result = await ingestJournal(args);
    const r = result as unknown as {
      tasksCreated?: number;
      insightsStored?: number;
      commitmentsFound?: number;
      entryType?: string;
      summary?: string;
    };
    await sendTelegram(
      `🧠 <b>Dumped</b>\n\nType: <b>${r.entryType || "raw"}</b>\nTasks: ${r.tasksCreated ?? 0}\nInsights: ${r.insightsStored ?? 0}\nCommitments: ${r.commitmentsFound ?? 0}${r.summary ? `\n\n<i>${r.summary.slice(0, 400)}</i>` : ""}`,
      chatId
    );
  } catch (err) {
    await sendTelegram(`⚠️ Dump failed: ${(err as Error).message}`, chatId);
  }
}

async function cmdTask(args: string, chatId: string): Promise<void> {
  if (!args.trim()) {
    await sendTelegram(`Usage: /task [text]`, chatId);
    return;
  }
  try {
    // v10.0.529.99 · Wave 43 · route through canonical service +
    // dynamic inbox resolver. Was hardcoded "m-inbox" + raw
    // prisma.task.create · would silently fail if the inbox row was
    // ever deleted AND skipped audit/priority-sync/cache-invalidation.
    const { createTask } = await import("@/lib/services/tasks");
    const { resolveInboxMissionId } = await import("@/lib/services/missions");
    const title = args.trim().slice(0, 200);
    const inboxMissionId = await resolveInboxMissionId();
    const task = await createTask({
      title,
      missionId: inboxMissionId,
      status: "INBOX",
      nextPhysicalAction: title,
      effort: "M15",
      roiScore: 50,
      frictionScore: 50,
      energyRequired: "MEDIUM",
      context: "PHONE",
      finishCondition: "Item resolved · outcome logged",
      autoPriorityExplanation: "captured via Telegram /task",
    });
    if (!task) {
      await sendTelegram(`⚠️ Task save returned no view-model · check /system/errors`, chatId);
      return;
    }
    await sendTelegram(
      `✅ <b>Task created</b>\n\n${task.title}\n<i>id: ${task.id.slice(0, 8)} · inbox</i>`,
      chatId
    );
  } catch (err) {
    await sendTelegram(`⚠️ Task failed: ${(err as Error).message}`, chatId);
  }
}

async function cmdMit(args: string, chatId: string): Promise<void> {
  if (!args.trim()) {
    await sendTelegram(
      `Usage: /mit [text]\n\nSets today's MIT (Most Important Task) in the brain_memory table — synced to the /command HQ.`,
      chatId
    );
    return;
  }
  try {
    const { prisma } = await import("@/lib/prisma");
    const date = new Date().toISOString().slice(0, 10);
    await prisma.brainMemory.upsert({
      where: { category_key: { category: BRAIN_CATEGORIES.MIT, key: date } },
      update: { content: args.trim(), confidence: 1.0 },
      create: {
        category: BRAIN_CATEGORIES.MIT,
        key: date,
        content: args.trim(),
        source: "telegram",
        confidence: 1.0,
      },
    });
    await sendTelegram(`⚔️ <b>MIT locked</b>\n\n${args.trim()}`, chatId);
  } catch (err) {
    await sendTelegram(`⚠️ MIT failed: ${(err as Error).message}`, chatId);
  }
}

async function cmdCommit(args: string, chatId: string): Promise<void> {
  if (!args.trim()) {
    await sendTelegram(`Usage: /commit [text]`, chatId);
    return;
  }
  try {
    const { prisma } = await import("@/lib/prisma");
    const today = new Date().toISOString().slice(0, 10);
    const commitment = await prisma.commitment.create({
      data: {
        dateMade: today,
        toWhom: "self",
        description: args.trim().slice(0, 500),
        status: "active",
      },
    });
    await sendTelegram(
      `🤝 <b>Commitment locked</b>\n\n${commitment.description}`,
      chatId
    );
  } catch (err) {
    await sendTelegram(`⚠️ Commit failed: ${(err as Error).message}`, chatId);
  }
}

async function cmdAsk(args: string, chatId: string): Promise<void> {
  if (!args.trim()) {
    await sendTelegram(`Usage: /ask [question] — get a one-shot answer from Nick`, chatId);
    return;
  }
  try {
    const { tracedAiChat } = await import("@/lib/ai/traced-aichat");
    const result = await tracedAiChat(
      { label: "telegram-ask", source: "tool", metadata: { chatId } },
      [
        {
          role: "system",
          content:
            "You are Nick — Nour's Chief of Staff. Telegram mobile context, keep the answer under 200 words, no fluff, data-first. End with ONE specific action.",
        },
        { role: "user", content: args.trim() },
      ],
      "reason"
    );
    if (result.provider === "none") {
      await sendTelegram(`⚠️ No AI provider available right now.`, chatId);
      return;
    }
    await sendTelegram(`🧠 <b>Nick</b>\n\n${result.content.slice(0, 3500)}`, chatId);
  } catch (err) {
    await sendTelegram(`⚠️ Ask failed: ${(err as Error).message}`, chatId);
  }
}

// ── Individual commands ───────────────────────────────────

async function cmdStatus(chatId: string): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  const { today } = await import("@/lib/utils/datetime");

  // Apr 17 sweep: OpenLoop + DailyScore retired. Status now reports
  // the live Task queue + reflections.
  const [inbox, ready, doing, alerts, leads, commitments, reflectedToday] =
    await Promise.all([
      prisma.task.count({ where: { status: "INBOX" } }).catch(() => 0),
      prisma.task.count({ where: { status: "READY" } }).catch(() => 0),
      prisma.task.count({ where: { status: "DOING" } }).catch(() => 0),
      (async () => {
        const { getUnresolvedAlerts } = await import("@/lib/mastery/drift-engine");
        return (await getUnresolvedAlerts().catch(() => [])).length;
      })(),
      Promise.resolve(0).catch(() => 0),
      prisma.commitment
        .count({ where: { status: { in: ["active", "in_progress"] } } })
        .catch(() => 0),
      prisma.reflection.count({ where: { date: today() } }).catch(() => 0),
    ]);

  await sendTelegram(
    `📊 <b>NOUR OS Status</b> — ${now()}\n\n` +
      `📥 Inbox: ${inbox} · ▶︎ Ready: ${ready} · 🔥 Doing: ${doing}\n` +
      `⚠️ Drift alerts: ${alerts}\n` +
      `📱 New leads: ${leads}\n` +
      `✅ Commitments: ${commitments}\n` +
      `📝 Reflections today: ${reflectedToday}`,
    chatId
  );
}

async function cmdSchedule(chatId: string): Promise<void> {
  const { generateDailySchedule } = await import("@/lib/brain/daily-scheduler");
  const schedule = await generateDailySchedule();

  const blockLines = schedule.blocks.map((b) => {
    const emoji = b.type === "deep_work" ? "🧠" : b.type === "body" ? "💪" : b.type === "communication" ? "📞" : b.type === "review" ? "📝" : "⚙️";
    return `${emoji} <b>${b.time}</b> ${b.task.slice(0, 50)}`;
  });

  await sendTelegram(
    `📋 <b>Today's Schedule</b>\n\n${blockLines.join("\n")}\n\n${schedule.summary}`,
    chatId
  );
}

async function cmdMemory(query: string, chatId: string): Promise<void> {
  if (!query.trim()) {
    await sendTelegram("Usage: /memory <search query>\nExample: /memory customer alignment issue", chatId);
    return;
  }

  const { semanticSearch } = await import("@/lib/brain/embedding-utils");
  const results = await semanticSearch(query, 5);

  if (results.length === 0) {
    // Fall back to keyword search
    const { prisma } = await import("@/lib/prisma");
    const memories = await prisma.brainMemory.findMany({
      where: { content: { contains: query, mode: "insensitive" } },
      orderBy: { confidence: "desc" },
      take: 5,
      select: { category: true, content: true, confidence: true },
    });

    if (memories.length === 0) {
      await sendTelegram(`🔍 No memories found for "${query}"`, chatId);
      return;
    }

    const lines = memories.map(
      (m) => `[${m.category}] (${(m.confidence * 100).toFixed(0)}%) ${m.content.slice(0, 120)}`
    );
    await sendTelegram(
      `🔍 <b>Memory Search</b> (keyword)\nQuery: "${query}"\n\n${lines.join("\n\n")}`,
      chatId
    );
    return;
  }

  const lines = results.map(
    (r) => `(${(r.similarity * 100).toFixed(0)}% match) ${r.content.slice(0, 120)}`
  );
  await sendTelegram(
    `🔍 <b>Memory Search</b> (semantic)\nQuery: "${query}"\n\n${lines.join("\n\n")}`,
    chatId
  );
}

async function cmdBrain(chatId: string): Promise<void> {
  const { brainMemory } = await import("@/lib/brain/memory-manager");
  const { prisma } = await import("@/lib/prisma");

  const [status, embeddingCount] = await Promise.all([
    brainMemory.getStatus(),
    prisma.vectorEmbedding.count({ where: { sourceType: "brain_memory" } }).catch(() => 0),
  ]);

  const s = status as {
    total: number;
    permanent: number;
    temporary: number;
    avgConfidence: number;
    byCategory: { category: string; count: number }[];
  };

  const topCats = s.byCategory.slice(0, 5).map((c) => `  ${c.category}: ${c.count}`).join("\n");

  await sendTelegram(
    `🧠 <b>Brain Health</b>\n\n` +
      `Total memories: ${s.total}\n` +
      `Permanent: ${s.permanent} | Temporary: ${s.temporary}\n` +
      `Avg confidence: ${s.avgConfidence}\n` +
      `Embeddings: ${embeddingCount}/${s.total}\n\n` +
      `<b>Top categories:</b>\n${topCats}`,
    chatId
  );
}

/**
 * v8.23 — /goals: active LifeGoals with progress + pace.
 */
async function cmdGoals(chatId: string): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  const goals = await prisma.lifeGoal.findMany({
    where: { status: "active", deletedAt: null },
    orderBy: [{ horizon: "asc" }, { progress: "desc" }],
    take: 10,
    select: {
      title: true,
      domain: true,
      horizon: true,
      progress: true,
      currentValue: true,
      targetValue: true,
      unit: true,
      deadline: true,
    },
  });

  if (goals.length === 0) {
    await sendTelegram("🎯 No active goals. Set one with /ask 'add a goal: …'", chatId);
    return;
  }

  const lines = goals.map((g) => {
    const pct = Math.round(g.progress);
    const bar = "▰".repeat(Math.floor(pct / 10)) + "▱".repeat(10 - Math.floor(pct / 10));
    const dl = g.deadline
      ? ` · ${Math.max(0, Math.round((g.deadline.getTime() - Date.now()) / 86_400_000))}d left`
      : "";
    const value = `${Math.round(g.currentValue * 10) / 10}/${g.targetValue}${g.unit}`;
    const horizon = g.horizon ? `[${g.horizon}] ` : "";
    return `${horizon}<b>${escapeHtml(g.title)}</b>\n  ${bar} ${pct}% · ${value}${dl}`;
  });

  await sendTelegram(`🎯 <b>Active Goals (${goals.length})</b>\n\n${lines.join("\n\n")}`, chatId);
}

/**
 * v8.23 — /predict: top open predictions Nick has made.
 */
async function cmdPredict(chatId: string): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  const predictions = await prisma.prediction.findMany({
    where: { status: "pending" },
    orderBy: [{ confidence: "desc" }, { targetDate: "asc" }],
    take: 8,
    select: {
      prediction: true,
      category: true,
      confidence: true,
      targetDate: true,
      basis: true,
    },
  });

  if (predictions.length === 0) {
    await sendTelegram("🔮 No open predictions yet.", chatId);
    return;
  }

  const lines = predictions.map((p) => {
    const conf = Math.round(p.confidence * 100);
    return (
      `<b>[${p.category}]</b> ${escapeHtml(p.prediction.slice(0, 200))}\n` +
      `  ${conf}% confidence · target ${p.targetDate}`
    );
  });

  await sendTelegram(
    `🔮 <b>Open Predictions (${predictions.length})</b>\n\n${lines.join("\n\n")}`,
    chatId,
  );
}

/**
 * v8.23 — /search: semantic search over BrainMemory + brain dumps.
 * Composes on the embedding pipeline that v8.22 wired into journal
 * ingest. Falls back to keyword search when embeddings are empty.
 */
async function cmdSearch(query: string, chatId: string): Promise<void> {
  if (!query.trim()) {
    await sendTelegram("Usage: /search <query>\nExample: /search burnout patterns", chatId);
    return;
  }
  const { semanticSearch } = await import("@/lib/brain/embedding-utils");
  const { prisma } = await import("@/lib/prisma");
  const hits = await semanticSearch(query, 6);

  if (hits.length === 0) {
    // Fall back to LIKE search across journal + memory
    const dumps = await prisma.brainDump.findMany({
      where: { rawThoughts: { contains: query, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { rawThoughts: true, createdAt: true, summary: true },
    });
    if (dumps.length === 0) {
      await sendTelegram(`🔍 No matches for "${query}".`, chatId);
      return;
    }
    const lines = dumps.map(
      (d) =>
        `${d.createdAt.toISOString().slice(0, 10)}\n${escapeHtml(
          (d.summary ?? d.rawThoughts).slice(0, 220),
        )}`,
    );
    await sendTelegram(
      `🔍 <b>Keyword search</b> "${escapeHtml(query)}"\n\n${lines.join("\n\n")}`,
      chatId,
    );
    return;
  }

  const lines = hits.map(
    (h) =>
      `(${(h.similarity * 100).toFixed(0)}%) ${escapeHtml(h.content.slice(0, 220))}`,
  );
  await sendTelegram(
    `🔍 <b>Semantic search</b> "${escapeHtml(query)}"\n\n${lines.join("\n\n")}`,
    chatId,
  );
}

/**
 * v8.23 — /stats: numeric snapshot — counts across the OS for a
 * quick at-a-glance pulse from the phone.
 */
async function cmdStats(chatId: string): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);

  const [
    activeGoals,
    pendingPredictions,
    activeTasks,
    activeCommitments,
    recentJournal,
    recentAlerts,
    embeddingTotal,
  ] = await Promise.all([
    prisma.lifeGoal.count({ where: { status: "active" } }).catch(() => 0),
    prisma.prediction.count({ where: { status: "pending" } }).catch(() => 0),
    prisma.task
      .count({ where: { status: { in: ["INBOX", "READY", "DOING"] }, deletedAt: null } })
      .catch(() => 0),
    prisma.commitment
      .count({ where: { status: { in: ["active", "in_progress"] } } })
      .catch(() => 0),
    prisma.brainDump.count({ where: { createdAt: { gte: sevenDaysAgo } } }).catch(() => 0),
    prisma.brainMemory
      .count({
        where: {
          category: {
            in: [
              "correlation_alert",
              "decision_quality_drift",
              "schema_drift_alert",
              "storage_quota_alert",
              "creation_spike_alert",
              "update_spike_alert",
              "brain_bus_alert",
            ],
          },
          createdAt: { gte: sevenDaysAgo },
          deletedAt: null,
        },
      })
      .catch(() => 0),
    prisma.vectorEmbedding.count().catch(() => 0),
  ]);

  await sendTelegram(
    `📊 <b>Quick Stats</b> — ${now()}\n\n` +
      `🎯 ${activeGoals} active goals\n` +
      `🔮 ${pendingPredictions} open predictions\n` +
      `▶︎ ${activeTasks} live tasks\n` +
      `🤝 ${activeCommitments} commitments\n\n` +
      `<b>Last 7 days</b>\n` +
      `📝 ${recentJournal} journal entries\n` +
      `🚨 ${recentAlerts} brain alerts fired\n\n` +
      `<b>Brain</b>\n` +
      `🧬 ${embeddingTotal.toLocaleString()} vectors indexed`,
    chatId,
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * v8.7 BATCH 42 — /alerts command. Pulls the last 5 active alert
 * BrainMemory rows across all alert categories. Composes with the
 * v8.5 alert-Telegram-bridge (which auto-pushes new alerts) so Nour
 * can also pull on demand.
 */
async function cmdAlerts(chatId: string): Promise<void> {
  const { prisma } = await import("@/lib/prisma");

  const ALERT_CATS = [
    "correlation_alert",
    "decision_quality_drift",
    "schema_drift_alert",
    "storage_quota_alert",
    "creation_spike_alert",
    "update_spike_alert",
    "brain_bus_alert",
  ];

  const alerts = await prisma.brainMemory.findMany({
    where: {
      category: { in: ALERT_CATS },
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { category: true, content: true, createdAt: true },
  });

  if (alerts.length === 0) {
    await sendTelegram("✅ No active alerts in the last 30 days.", chatId);
    return;
  }

  const labels: Record<string, string> = {
    correlation_alert: "🔗",
    decision_quality_drift: "📉",
    schema_drift_alert: "⚠️",
    storage_quota_alert: "💾",
    creation_spike_alert: "🌊",
    update_spike_alert: "🔁",
    brain_bus_alert: "🛰️",
  };

  const formatAge = (iso: Date): string => {
    const ms = Date.now() - iso.getTime();
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
    return `${Math.round(ms / 86_400_000)}d ago`;
  };

  const escapeHtml = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const lines = alerts.map(
    (a) =>
      `${labels[a.category] ?? "•"} <b>${escapeHtml(a.category)}</b> · ${formatAge(a.createdAt)}\n${escapeHtml(a.content.slice(0, 240))}`,
  );

  await sendTelegram(
    `<b>Recent active alerts (${alerts.length})</b>\n\n${lines.join("\n\n")}`,
    chatId,
  );
}

// ── Multi-modal input handlers ────────────────────────────

async function handlePhoto(
  photos: { file_id: string; width: number; height: number }[],
  caption: string | undefined,
  chatId: string
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;

  // Get the largest photo (last in array)
  const photo = photos[photos.length - 1];

  try {
    // Get file path from Telegram
    const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${photo.file_id}`);
    const fileData = await fileRes.json();
    const filePath = fileData.result?.file_path;

    if (!filePath) {
      await sendTelegram("Couldn't process the photo. Try again.", chatId);
      return;
    }

    // Download the image
    const imageUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const imageRes = await fetch(imageUrl);
    const imageBuffer = await imageRes.arrayBuffer();
    const base64 = Buffer.from(imageBuffer).toString("base64");
    const mimeType = filePath.endsWith(".png") ? "image/png" : "image/jpeg";

    // Analyze with multimodal AI (send actual image data)
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    let analysisText = "";

    // Primary: Anthropic Claude (native vision support)
    if (anthropicKey) {
      try {
        const aRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
            max_tokens: 500,
            messages: [{
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
                { type: "text", text: `You are Nick, analyzing an image for Nour (tire shop CEO). ${caption ? `Caption: "${caption}". ` : ""}What is this? Any actionable insight? One recommendation.` },
              ],
            }],
          }),
        });
        if (aRes.ok) {
          const aData = await aRes.json();
          analysisText = aData.content?.[0]?.text ?? "";
        }
      } catch { /* fall through */ }
    }

    // Last resort: text-only analysis based on caption
    if (!analysisText) {
      const { tracedAiChat } = await import("@/lib/ai/traced-aichat");
      const result = await tracedAiChat(
        { label: "telegram-photo-fallback", source: "tool", metadata: { chatId } },
        [
          { role: "system", content: "You received a photo you cannot see. Respond based on the caption only. Be honest that you can't see the image." },
          { role: "user", content: `Photo (${photo.width}x${photo.height}). ${caption ? `Caption: "${caption}"` : "No caption."}` },
        ],
        "fast"
      );
      analysisText = result.content;
    }

    await sendTelegram(`📸 <b>Photo Analysis</b>\n\n${analysisText.slice(0, 3500)}`, chatId);

    // Store as brain memory
    const { brainMemory } = await import("@/lib/brain/memory-manager");
    await brainMemory.remember(
      "visual_input",
      `photo_${Date.now()}`,
      `Photo analyzed: ${analysisText.slice(0, 300)}${caption ? ` (caption: ${caption})` : ""}`,
      "telegram-photo"
    );
  } catch (err) {
    await sendTelegram(`Photo analysis failed: ${err instanceof Error ? err.message : "unknown error"}`, chatId);
  }
}

async function handleVoice(
  voice: { file_id: string; duration: number },
  chatId: string
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;

  try {
    await sendTelegram(`🎙️ Transcribing ${voice.duration}s voice note...`, chatId);

    // Get file from Telegram
    const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${voice.file_id}`);
    const fileData = await fileRes.json();
    const filePath = fileData.result?.file_path;

    if (!filePath) {
      await sendTelegram("Couldn't process the voice note.", chatId);
      return;
    }

    // Download audio
    const audioUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const audioRes = await fetch(audioUrl);
    const audioBuffer = await audioRes.arrayBuffer();

    // Transcribe via HuggingFace Whisper
    const hfKey = process.env.HUGGINGFACE_API_KEY;
    let transcript = "";

    if (hfKey) {
      const whisperRes = await fetch(
        "https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${hfKey}` },
          body: Buffer.from(audioBuffer),
        }
      );

      if (whisperRes.ok) {
        const data = await whisperRes.json();
        transcript = data.text || "";
      }
    }

    if (!transcript) {
      await sendTelegram("Transcription failed. Try again or type your message.", chatId);
      return;
    }

    // Process the transcription as a command or message
    await sendTelegram(`📝 <b>Transcribed:</b> "${transcript}"`, chatId);

    // If it starts with a slash command, route it
    if (transcript.trim().startsWith("/")) {
      await handleCommand(transcript.trim(), chatId);
    } else {
      // Treat as a brain dump / note
      const { brainMemory } = await import("@/lib/brain/memory-manager");
      await brainMemory.remember(
        "voice_note",
        `voice_${Date.now()}`,
        transcript,
        "telegram-voice"
      );
      await sendTelegram("✅ Stored as brain memory.", chatId);
    }
  } catch (err) {
    await sendTelegram(`Voice processing failed: ${err instanceof Error ? err.message : "unknown error"}`, chatId);
  }
}

async function handleUrl(
  url: string,
  fullText: string,
  chatId: string
): Promise<void> {
  try {
    await sendTelegram(`🔗 Analyzing: ${url.slice(0, 60)}...`, chatId);

    // Fetch the page content
    const res = await fetch(url, {
      headers: { "User-Agent": "NOUR-OS/1.0" },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      await sendTelegram(`Couldn't fetch URL (${res.status}). It may be behind auth.`, chatId);
      return;
    }

    const html = await res.text();

    // Extract text content (basic HTML stripping)
    const textContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);

    // AI analysis
    const { tracedAiChat } = await import("@/lib/ai/traced-aichat");
    const result = await tracedAiChat(
      { label: "telegram-url-summary", source: "tool", metadata: { chatId, urlHost: (() => { try { return new URL(url).host; } catch { return null; } })() } },
      [
        {
          role: "system",
          content: `You are Nick, analyzing a URL shared by Nour (tire shop CEO). Summarize the content in 3-5 sentences.
Focus on: what's relevant to Nour's business or personal goals.
If it's a competitor, note what they're doing.
If it's a tool/product, assess if it's useful for Nick's Tire.
If it's news/article, extract the key insight.`,
        },
        {
          role: "user",
          content: `URL: ${url}\nNour's message: "${fullText}"\n\nPage content (first 3000 chars):\n${textContent}`,
        },
      ],
      "fast"
    );

    await sendTelegram(`🔗 <b>Link Analysis</b>\n\n${result.content.slice(0, 3500)}`, chatId);

    // Store as brain memory
    const { brainMemory } = await import("@/lib/brain/memory-manager");
    await brainMemory.remember(
      "link_analysis",
      `url_${Date.now()}`,
      `Analyzed URL: ${url} — ${result.content.slice(0, 200)}`,
      "telegram-url"
    );
  } catch (err) {
    await sendTelegram(`URL analysis failed: ${err instanceof Error ? err.message : "unknown error"}`, chatId);
  }
}

async function cmdImagine(prompt: string, chatId: string): Promise<void> {
  if (!prompt.trim()) {
    await sendTelegram("Usage: /imagine <description>\nExample: /imagine a tire shop logo with flames and gold", chatId);
    return;
  }

  await sendTelegram(`🎨 Generating: "${prompt.slice(0, 60)}..."`, chatId);

  try {
    const { generateImageWithFallback } = await import("@/lib/ai/gemini-image");
    const result = await generateImageWithFallback(prompt);

    // Send as photo via Telegram Bot API
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return;

    const imageBuffer = Buffer.from(result.base64, "base64");
    const formData = new FormData();
    formData.append("chat_id", chatId);
    formData.append("photo", new Blob([imageBuffer], { type: "image/png" }), "generated.png");
    formData.append("caption", `🎨 "${prompt.slice(0, 100)}"\nModel: ${result.model} | Size: ${result.size}`);

    await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: "POST",
      body: formData,
    });
  } catch (err) {
    await sendTelegram(`Image generation failed: ${err instanceof Error ? err.message : "unknown error"}`, chatId);
  }
}

// ── Bulk-SMS approval (Wave-200 follow-up · 2026-05-17) ─────
//
// Emits `bulk-sms/approval-response` events that the
// `bulk-sms-approval` Inngest function is waiting for via
// step.waitForEvent. The Inngest function dispatches (or rejects)
// based on the decision. Operator usage:
//
//   /approve <campaignId>      → approve & dispatch
//   /reject  <campaignId>      → reject & audit
//
// Both commands return immediately · the actual SMS send happens
// inside the Inngest function step (currently TEMPLATE only · no
// actual SMS dispatch wired). Per
// apps/statenour/src/inngest/functions/bulk-sms-approval.ts.

async function emitApprovalResponse(
  campaignId: string,
  decision: "approve" | "reject",
  chatId: string,
): Promise<void> {
  if (!campaignId) {
    await sendTelegram(
      `Usage: <code>/${decision} &lt;campaignId&gt;</code>`,
      chatId,
    );
    return;
  }
  try {
    const { getInngest } = await import("@/lib/inngest/client");
    const inngest = getInngest();
    await inngest.send({
      name: "bulk-sms/approval-response",
      data: { campaignId, decision },
    });
    await sendTelegram(
      `✅ ${decision === "approve" ? "Approved" : "Rejected"} · ` +
        `<code>${campaignId}</code> · Inngest will ${
          decision === "approve" ? "dispatch" : "audit + exit"
        } within seconds.`,
      chatId,
    );
  } catch (err) {
    await sendTelegram(
      `⚠️ Failed to emit ${decision} for <code>${campaignId}</code>: ${
        err instanceof Error ? err.message.slice(0, 200) : "unknown error"
      }`,
      chatId,
    );
  }
}

async function cmdApprove(args: string, chatId: string): Promise<void> {
  await emitApprovalResponse(args.trim(), "approve", chatId);
}

async function cmdReject(args: string, chatId: string): Promise<void> {
  await emitApprovalResponse(args.trim(), "reject", chatId);
}

// ── Nick Action Queue (Wave AG · 2026-05-28) ─────────────────
//
// Daily approval surface · operator replies to the 8am morning batch
// with "/qa 1 3" / "/qa all" / "/qa none". Updates AutonomousAction
// rows whose payload.queueDate = today. The 9am execute cron then
// dispatches everything approved.
//
// Syntax · index list is 1-based and matches the order shown in the
// proposal Telegram message (which is payload.queueIndex). Anything
// not in the list stays pending — the operator can defer or run /qa
// again later.

async function cmdQa(args: string, chatId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { prisma } = await import("@/lib/prisma");

  // Pull today's pending nick_action rows.
  const rows = await prisma.autonomousAction.findMany({
    where: {
      ruleName: { startsWith: "nick_action_" },
      approval: "pending",
      idempotencyKey: { startsWith: `nick_action::${today}::` },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      idempotencyKey: true,
      payload: true,
      ruleName: true,
      trigger: true,
    },
  });

  if (rows.length === 0) {
    await sendTelegram(
      `📭 No pending Nick moves for ${today}. Today's batch may already be approved/executed — check /system/approvals.`,
      chatId,
    );
    return;
  }

  // Index → row lookup. We trust payload.queueIndex (set by the
  // proposer) — fall back to insertion order if payload is missing.
  const byIndex = new Map<number, (typeof rows)[number]>();
  rows.forEach((r, i) => {
    const payload = r.payload as Record<string, unknown> | null;
    const idx =
      typeof payload?.queueIndex === "number"
        ? (payload.queueIndex as number)
        : i + 1;
    byIndex.set(idx, r);
  });

  const trimmed = args.trim().toLowerCase();
  let targets: { idx: number; id: string }[] = [];
  let decision: "approved" | "rejected" = "approved";

  if (!trimmed) {
    await sendTelegram(
      `Usage: <code>/qa 1 3</code> · <code>/qa all</code> · <code>/qa none</code>\n\n${rows.length} pending today.`,
      chatId,
    );
    return;
  }

  if (trimmed === "all") {
    targets = [...byIndex.entries()].map(([idx, row]) => ({ idx, id: row.id }));
  } else if (trimmed === "none") {
    decision = "rejected";
    targets = [...byIndex.entries()].map(([idx, row]) => ({ idx, id: row.id }));
  } else {
    const indices = trimmed
      .split(/[\s,]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (indices.length === 0) {
      await sendTelegram(
        `Couldn't parse indices from "${args.slice(0, 60)}". Try <code>/qa 1 3</code>, <code>/qa all</code>, or <code>/qa none</code>.`,
        chatId,
      );
      return;
    }
    for (const idx of indices) {
      const row = byIndex.get(idx);
      if (row) targets.push({ idx, id: row.id });
    }
    if (targets.length === 0) {
      await sendTelegram(
        `No matching moves for ${indices.join(", ")}. Today has ${rows.length} pending (#${[...byIndex.keys()].sort((a, b) => a - b).join(", #")}).`,
        chatId,
      );
      return;
    }
  }

  // Apply the decision in a single transaction so a partial failure
  // doesn't leave the queue in a torn state.
  let updated = 0;
  try {
    const result = await prisma.autonomousAction.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: {
        approval: decision,
        approvedBy: "nour-telegram",
      },
    });
    updated = result.count;
  } catch (err) {
    await sendTelegram(
      `⚠️ Queue update failed: ${err instanceof Error ? err.message.slice(0, 160) : "unknown"}`,
      chatId,
    );
    return;
  }

  const verb = decision === "approved" ? "approved" : "rejected";
  const idxList = targets
    .map((t) => t.idx)
    .sort((a, b) => a - b)
    .join(", ");
  await sendTelegram(
    `✅ <b>${verb}</b> · ${updated} of ${targets.length} (#${idxList})\n\n` +
      (decision === "approved"
        ? "Execute cron at 09:00 UTC ships them."
        : "Rejected rows stay in the audit trail."),
    chatId,
  );
}

// ── Helpers ───────────────────────────────────────────────

function now(): string {
  return new Date().toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
}
