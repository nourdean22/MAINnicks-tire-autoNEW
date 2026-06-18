import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await requireSession(req);
  return NextResponse.json({ ok: false, error: "Venice retired" });
}
