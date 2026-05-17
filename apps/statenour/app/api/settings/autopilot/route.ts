import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

import { requireSession } from "@/lib/auth-guard";
/**
 * GET /api/settings/autopilot — Read auto-pilot flag states.
 * POST /api/settings/autopilot — Save auto-pilot flag states.
 *
 * Stores flags in UserPreference table (key: "autopilot_flags").
 * Falls back to defaults if no record exists.
 */

const DEFAULTS: Record<string, boolean> = {
  auto_morning_autopilot: true,
  auto_morning_brief: true,
  auto_stale_lead_alert: true,
  auto_commitment_check: true,
  auto_brain_cycle: true,
  auto_drift_escalation: true,
  auto_followup_quotes: true,
  auto_weekly_targets: false,
  auto_revenue_alerts: true,
};

// v10.0.44 — auth gate added to GET to match POST's gating.
// Pre-fix the autopilot flag state was readable unauthed (leaks
// which automation flags are active).
export async function GET(req: Request) {
  await requireSession(req);
  try {
    const pref = await prisma.userPreference.findFirst({
      where: { key: "autopilot_flags" },
    });
    const flags = pref?.value ? JSON.parse(pref.value as string) : DEFAULTS;
    return NextResponse.json({ flags });
  } catch {
    return NextResponse.json({ flags: DEFAULTS });
  }
}

export async function POST(req: Request) {
  await requireSession(req);
  try {
    const { flags } = await req.json();
    if (!flags || typeof flags !== "object") {
      return NextResponse.json({ error: "Invalid flags" }, { status: 400 });
    }

    // Merge with defaults to ensure all keys exist
    const merged = { ...DEFAULTS, ...flags };

    await prisma.userPreference.upsert({
      where: { key: "autopilot_flags" },
      create: { key: "autopilot_flags", value: JSON.stringify(merged) },
      update: { value: JSON.stringify(merged) },
    });

    return NextResponse.json({ success: true, flags: merged });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
