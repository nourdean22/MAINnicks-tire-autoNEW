import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

import { requireSession } from "@/lib/auth-guard";
export async function GET(req: NextRequest) {
  // v10.0.183 · auth was on POST but missing on GET. User habit
  // preferences are operator-private state.
  await requireSession(req);
  const pref = await prisma.userPreference.findUnique({
    where: { key: "habits_config" },
  });

  if (!pref) {
    return NextResponse.json({ data: null });
  }

  try {
    return NextResponse.json({ data: JSON.parse(pref.value) });
  } catch {
    return NextResponse.json({ data: null });
  }
}

export async function POST(req: NextRequest) {
  await requireSession(req);
  const body = await req.json();
  const habits = body.habits;

  if (!Array.isArray(habits)) {
    return NextResponse.json({ error: "habits must be an array" }, { status: 400 });
  }

  await prisma.userPreference.upsert({
    where: { key: "habits_config" },
    update: {
      value: JSON.stringify(habits),
      updatedAt: new Date(),
    },
    create: {
      key: "habits_config",
      value: JSON.stringify(habits),
      type: "json",
      category: "ui",
    },
  });

  return NextResponse.json({ success: true });
}
