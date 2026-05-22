/**
 * app/voice/layout.tsx · straggler-pages REST→tRPC slice (2026-05-22)
 *
 * /voice lives OUTSIDE the (mastery) route group, so it does NOT
 * inherit the `<TRPCProvider>` that `app/(mastery)/layout.tsx`
 * supplies. The voice page was migrated off `useAuthedFetch` onto a
 * tRPC hook (`operator.morningBrief`), and a tRPC hook with no
 * `<TRPCProvider>` ancestor throws "Unable to find tRPC Context" at
 * static prerender — `next build` would fail.
 *
 * This layout supplies the provider for the /voice subtree so the page
 * (and any future /voice/* surface) can use tRPC hooks normally.
 */

import { TRPCProvider } from "@/components/providers/trpc-provider";

export default function VoiceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <TRPCProvider>{children}</TRPCProvider>;
}
