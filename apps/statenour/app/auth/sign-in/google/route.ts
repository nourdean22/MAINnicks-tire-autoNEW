/**
 * POST /auth/sign-in/google · the sign-in button's target (bug hunt 2026-10-22).
 *
 * It replaces an inline Server Action. Sentry JAVASCRIPT-REACT-Z: a tab opened
 * on an older build (or Safari posting before hydration) sent an action id the
 * new server did not have, and Next threw "Failed to find Server Action" on the
 * server, out of reach of the client-side deploy-skew reload. A plain form POST
 * has no action id, so it cannot skew.
 *
 * Public by route-policy's "/auth" prefix. It keeps the two things the Server
 * Action did implicitly: a same-origin check on the POST (Next compares Origin
 * with x-forwarded-host / host), and the page's callbackUrl gate.
 */
import { NextResponse } from "next/server";
import { signIn } from "@/auth";
import { resolveCallbackUrl } from "@/lib/security/callback-url";

function isCrossSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false; // same as Next's action check: a missing Origin is not refused
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export async function POST(req: Request) {
  if (isCrossSite(req)) return NextResponse.json({ error: "Cross-site sign-in refused." }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const raw = form?.get("callbackUrl");
  const redirectTo = resolveCallbackUrl(typeof raw === "string" ? raw : "");

  // redirect: false returns the provider URL instead of throwing NEXT_REDIRECT
  // (a 307 would replay this POST at Google); the state/PKCE cookies signIn sets
  // through next/headers ride on this response.
  const url: string = await signIn("google", { redirectTo, redirect: false });
  return NextResponse.redirect(url, 303);
}
