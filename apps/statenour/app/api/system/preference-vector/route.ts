/**
 * GET / POST /api/system/preference-vector · v10.0.529.33
 *
 * Arc B Feature 1 · operator-facing visibility + manual override for
 * the 8-axis preference vector. GET returns the current vector +
 * addendum + last-tune metadata. POST takes a full or partial vector
 * and saves · the cron-driven weekly tune continues to operate on top
 * of operator overrides (each tune applies a small delta · operator
 * overrides win at the moment of override but drift can re-shape the
 * vector unless the operator overrides again).
 *
 * Power+control alignment · the operator wants every dial exposed.
 * The vector is one of the only fully-inferred, fully-automated
 * pieces of operator state · this surface makes it visible AND
 * overridable. Resets are atomic · "reset to neutral" zeros every axis.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
// Phase B.6c · the preference-vector read/write assembly moved to a
// shared service so the legacy REST route AND the tRPC
// `system.preferenceVector` / `system.savePreferenceVector` procedures
// call the same functions · drift impossible.
import {
  buildPreferenceVectorView,
  savePreferenceVectorOverride,
} from "@/lib/services/preference-vector";
// The POST body schema is the SHARED validator the tRPC procedure also
// imports — the schema IS the contract.
import { preferenceVectorSaveSchema } from "@/lib/validators/system";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(req: Request) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await buildPreferenceVectorView());
}

export async function POST(req: Request) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: import("@/lib/validators/system").PreferenceVectorSaveInput;
  try {
    const json = await req.json();
    const parsed = preferenceVectorSaveSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  return NextResponse.json(
    await savePreferenceVectorOverride({
      vector: body.vector,
      reset: body.reset,
    }),
  );
}
