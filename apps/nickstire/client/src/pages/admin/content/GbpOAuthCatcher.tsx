/**
 * GBP OAuth code-exchange catcher — mounted at the Admin SHELL level.
 *
 * Why here and not in GBPPostGenerator: Google redirects back to /admin with
 * ?code=...&state=gbp-oauth, but the component that used to run the exchange
 * only mounts inside Content & AI → GBP sub-tab. Landing anywhere else in the
 * admin meant the single-use code sat in the URL and silently expired — the
 * operator "connected" and nothing happened. The shell always mounts, so the
 * exchange now runs no matter which tab the redirect lands on.
 *
 * The URL is scrubbed BEFORE the mutation fires: OAuth codes are single-use,
 * so a re-render or refresh must never replay the exchange (the second
 * attempt would fail with invalid_grant and toast a confusing error).
 */
import React from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export function GbpOAuthCatcher() {
  const utils = trpc.useUtils();
  const reconnect = trpc.gbp.reconnect.useMutation({
    onSuccess: () => {
      toast.success("Google Business Profile connected!");
      void utils.gbp.getAuthStatus.invalidate();
    },
    onError: (err: { message: string }) => toast.error(`GBP connect failed: ${err.message}`),
  });

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code || params.get("state") !== "gbp-oauth") return;
    params.delete("code");
    params.delete("state");
    const clean = window.location.pathname + (params.toString() ? `?${params.toString()}` : "");
    window.history.replaceState({}, "", clean);
    reconnect.mutate({ code });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount; the code is single-use
  }, []);

  return null;
}
