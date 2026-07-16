import { trpc } from "@/lib/trpc";
import { Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface Props {
  enabled: boolean;
  verified: boolean;
  accountLabel: string;
  onVerified: () => void;
}

export default function AdminMfaGate({ enabled, verified, accountLabel, onVerified }: Props) {
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const begin = trpc.adminSecurity.beginMfaSetup.useMutation({
    onSuccess: setSetup,
    onError: (error) => toast.error(error.message),
  });
  const verify = trpc.adminSecurity.verifyMfa.useMutation({
    onSuccess: ({ reference }) => {
      toast.success(`Two-factor verified · ${reference}`);
      onVerified();
    },
    onError: (error) => toast.error(error.message),
  });

  if (verified) return null;

  return (
    <main id="main-content" className="min-h-screen bg-background flex items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-xl border border-border/50 bg-card p-6 shadow-xl" aria-labelledby="mfa-title">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-5">
          {enabled ? <LockKeyhole className="w-6 h-6 text-primary" /> : <ShieldCheck className="w-6 h-6 text-primary" />}
        </div>
        <h1 id="mfa-title" className="text-xl font-semibold text-foreground">
          {enabled ? "Verify two-factor authentication" : "Secure this admin account"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          {enabled
            ? `Enter the six-digit authenticator code for ${accountLabel}.`
            : "Admin access requires an authenticator app. Setup must be completed before operational data is available."}
        </p>

        {!enabled && !setup && (
          <button
            type="button"
            onClick={() => begin.mutate()}
            disabled={begin.isPending}
            className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {begin.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Begin secure setup
          </button>
        )}

        {setup && (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-foreground">Add this account to Google Authenticator, 1Password, Authy, or another TOTP app:</p>
            <a className="block break-all rounded-lg border border-border/50 bg-background p-3 text-xs text-primary underline" href={setup.otpauthUri}>
              Open authenticator setup
            </a>
            <div className="rounded-lg border border-border/50 bg-background p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Manual setup key</div>
              <code className="mt-1 block break-all text-sm text-foreground select-all">{setup.secret}</code>
            </div>
          </div>
        )}

        {(enabled || setup) && (
          <form
            className="mt-6 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              verify.mutate({ code });
            }}
          >
            <label className="block text-xs font-medium text-muted-foreground" htmlFor="admin-mfa-code">Six-digit code</label>
            <input
              id="admin-mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-lg border border-border bg-background px-4 py-3 text-center text-2xl tracking-[0.4em] text-foreground"
              aria-describedby="mfa-help"
            />
            <p id="mfa-help" className="text-xs text-muted-foreground">Codes rotate every 30 seconds.</p>
            <button
              type="submit"
              disabled={code.length !== 6 || verify.isPending}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {verify.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Verify and enter admin
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
