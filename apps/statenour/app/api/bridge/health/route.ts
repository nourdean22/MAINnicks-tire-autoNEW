import { NextResponse } from "next/server";
import { requireBridgeAuth } from "@/lib/bridge-auth";

export async function GET(req: Request) {
  try {
    requireBridgeAuth(req);
  } catch (err) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0",
  });
}
