import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DOMAINS } from "@/lib/mastery/config";
import { today, toDateString } from "@/lib/utils/datetime";

import { requireSession } from "@/lib/auth-guard";
export async function GET(request: NextRequest) {
  await requireSession(request);
  try {
    const { searchParams } = request.nextUrl;
    const domain = searchParams.get("domain");
    const range = searchParams.get("range");

    if (domain && range) {
      const days = range === "90d" ? 90 : range === "30d" ? 30 : 90;
      const since = new Date();
      since.setDate(since.getDate() - days);
      const rows = await prisma.masteryScore.findMany({
        where: { domain, date: { gte: toDateString(since) } },
        orderBy: { date: "asc" },
      });
      return NextResponse.json({ ok: true, data: { history: rows } });
    }

    // Latest score per domain
    const latest = await Promise.all(
      DOMAINS.map(async (d) => {
        const row = await prisma.masteryScore.findFirst({
          where: { domain: d.key },
          orderBy: { date: "desc" },
        });
        return {
          ...d,
          score: row?.score ?? d.baseline,
          date: row?.date ?? null,
          evidence: row?.evidence ?? null,
          delta: row?.delta ?? 0,
        };
      })
    );

    // Radar chart data
    const radar = latest.map((d) => ({
      domain: d.label,
      current: d.score,
      baseline: d.baseline,
    }));

    return NextResponse.json({ ok: true, data: { domains: latest, radar } });
  } catch (err) {
    console.error("[mastery] GET Error:", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  await requireSession(request);
  try {
    const body = await request.json();
    const date = body.date || today();
    const { domain, score, evidence } = body;

    if (!domain || score === undefined) {
      return NextResponse.json({ ok: false, error: "domain and score required" }, { status: 400 });
    }

    // Calculate delta from previous score
    const prev = await prisma.masteryScore.findFirst({
      where: { domain },
      orderBy: { date: "desc" },
      select: { score: true },
    });
    const delta = prev ? Math.round((score - prev.score) * 10) / 10 : 0;

    await prisma.masteryScore.upsert({
      where: { date_domain: { date, domain } },
      create: { date, domain, score, evidence: evidence || null, delta },
      update: { score, evidence: evidence || null, delta },
    });

    return NextResponse.json({ ok: true, data: { domain, score, delta } });
  } catch (err) {
    console.error("[mastery] POST Error:", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
