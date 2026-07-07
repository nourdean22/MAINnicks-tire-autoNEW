import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { getAuthRuntimeMode, getOperatorSession } from "@/lib/auth";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

type SignInPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const operator = await getOperatorSession();
  const runtimeMode = getAuthRuntimeMode();
  const params = (await searchParams) || {};
  const rawCallback = typeof params.callbackUrl === "string" ? params.callbackUrl : "";
  // Prevent open redirect — only allow relative paths (not protocol-relative //evil.com)
  const callbackUrl =
    (rawCallback.startsWith("/") && !rawCallback.startsWith("//"))
      ? rawCallback
      : process.env.NEXT_PUBLIC_APP_URL || "/chat";

  if (runtimeMode === "google" && operator.email === (process.env.AUTH_ALLOWED_EMAIL || "").trim()) {
    redirect(callbackUrl);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--nour-bg)] p-4">
      <GlassCard className="w-full max-w-sm p-8 text-center">
        <div className="w-10 h-10 rounded-xl bg-[var(--nour-gold)] text-[var(--text-primary)] font-mono text-sm font-bold flex items-center justify-center mx-auto mb-6">
          N
        </div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--nour-gold)] mb-2">NOUR OS</p>
        <h1 className="text-xl font-semibold mb-2">Operator access</h1>
        <p className="text-sm text-[var(--nour-text-secondary)] mb-6">
          {runtimeMode === "google"
            ? "Sign in with the approved Google account to open the control plane."
            : "Google auth is not configured. Running in local operator mode."}
        </p>

        {runtimeMode === "google" ? (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: callbackUrl });
            }}
          >
            <Button
              type="submit"
              className="w-full bg-[var(--nour-gold)] text-[var(--text-primary)] hover:bg-[var(--nour-gold)]/90 font-medium"
            >
              Continue with Google
            </Button>
          </form>
        ) : (
          <div className="text-left bg-[var(--nour-bg)] rounded-lg p-3 text-xs text-[var(--nour-text-secondary)]">
            <p className="font-medium text-[var(--nour-text)] mb-1">Local mode active</p>
            <p>Set AUTH_SECRET, AUTH_GOOGLE_CLIENT_ID, AUTH_GOOGLE_CLIENT_SECRET, and AUTH_ALLOWED_EMAIL in your environment to enable production auth.</p>
          </div>
        )}
      </GlassCard>
    </main>
  );
}
