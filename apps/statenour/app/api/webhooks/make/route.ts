/**
 * POST /api/webhooks/make — Receives webhooks from Make.com scenarios.
 *
 * Make.com sends JSON payloads when scenarios complete.
 * This is the universal receiver — routes by `scenario` field in payload.
 *
 * Security: Validates MAKE_WEBHOOK_SECRET header if configured.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

// v9.1.14 · Removed `requireSession()` from this external webhook path.
// Make.com calls this URL from its cloud automation servers — it has no
// browser session cookie. The auth-coverage retrofit script in v8.26
// blanket-added requireSession to every mutating route, but external
// webhooks need secret-header auth, NOT session auth. With requireSession
// in place, every Make.com POST in production with auth env vars set was
// being 401'd before it ever reached the MAKE_WEBHOOK_SECRET check below.
// The MAKE_WEBHOOK_SECRET gate (timing-safe) is the correct primitive
// for this route.

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

interface MakeWebhookPayload {
  scenario: string;
  timestamp?: string;
  data: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  // Validate webhook secret — REQUIRED (reject if not configured)
  const secret = process.env.MAKE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  const headerSecret = req.headers.get("x-make-secret") || req.headers.get("authorization") || "";
  if (!safeEqual(headerSecret, secret) && !safeEqual(headerSecret, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: MakeWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload.scenario) {
    return NextResponse.json({ error: "Missing 'scenario' field" }, { status: 400 });
  }

  // ── Idempotency guard ─────────────────────────────────────────────
  // Use timestamp + scenario as a dedup key to prevent replayed webhooks
  const dedupeKey = payload.timestamp
    ? `make_${payload.scenario}_${payload.timestamp}`
    : null;
  if (dedupeKey) {
    const existing = await prisma.executionInsight.findFirst({
      where: {
        insightType: "webhook_make",
        metadata: { path: ["dedupeKey"], equals: dedupeKey },
      },
    }).catch(() => null);
    if (existing) {
      return NextResponse.json({ received: true, deduplicated: true, scenario: payload.scenario });
    }
  }

  // Log the webhook for observability
  try {
    await prisma.executionInsight.create({
      data: {
        insightType: "webhook_make",
        title: `Make.com: ${payload.scenario}`,
        detail: JSON.stringify(payload.data).slice(0, 2000),
        score: 1,
        metadata: {
          scenario: payload.scenario,
          receivedAt: new Date().toISOString(),
          source: "make.com",
          ...(dedupeKey && { dedupeKey }),
        },
      },
    });
  } catch {
    // Don't fail the webhook if logging fails
    console.error("[webhooks/make] Failed to log webhook");
  }

  // Route by scenario
  const result = await routeScenario(payload);

  return NextResponse.json({
    received: true,
    scenario: payload.scenario,
    ...result,
  });
}

async function routeScenario(payload: MakeWebhookPayload): Promise<Record<string, unknown>> {
  switch (payload.scenario) {
    case "new_lead":
      return handleNewLead(payload.data);
    case "review_alert":
      return handleReviewAlert(payload.data);
    case "social_post":
      return handleSocialPost(payload.data);
    case "invoice_created":
      return handleInvoiceCreated(payload.data);
    case "appointment_booked":
      return handleAppointmentBooked(payload.data);
    default:
      return { handled: false, message: `Unknown scenario: ${payload.scenario}` };
  }
}

// --- Scenario Handlers ---

async function handleNewLead(data: Record<string, unknown>) {
  // Future: Create lead in DB, notify via SSE, trigger follow-up
  return { handled: true, action: "lead_queued", data };
}

async function handleReviewAlert(data: Record<string, unknown>) {
  // Future: Store review, trigger response workflow
  return { handled: true, action: "review_stored", data };
}

async function handleSocialPost(data: Record<string, unknown>) {
  // Future: Log social post, update content calendar
  return { handled: true, action: "post_logged", data };
}

async function handleInvoiceCreated(data: Record<string, unknown>) {
  // Future: Sync with financial tracking
  return { handled: true, action: "invoice_synced", data };
}

async function handleAppointmentBooked(data: Record<string, unknown>) {
  // Future: Create appointment in schedule, send confirmation
  return { handled: true, action: "appointment_created", data };
}
