/**
 * POST /api/notifications/subscribe — Register push subscription
 * DELETE /api/notifications/subscribe — Remove push subscription
 */
import { NextRequest, NextResponse } from "next/server";
import { saveSubscription, removeSubscription, VAPID_PUBLIC_KEY } from "@/lib/notifications/push";

import { requireSession } from "@/lib/auth-guard";
export async function GET() {
  // Return the VAPID public key so the client can subscribe
  return NextResponse.json({ publicKey: VAPID_PUBLIC_KEY });
}

export async function POST(req: NextRequest) {
  await requireSession(req);
  try {
    const body = await req.json();
    const { subscription } = body;

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }

    await saveSubscription(subscription);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: "Failed to save subscription" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  await requireSession(req);
  try {
    const body = await req.json();
    const { endpoint } = body;
    if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
    await removeSubscription(endpoint);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to remove subscription" }, { status: 500 });
  }
}
