/**
 * /system/status · server-side metadata shell.
 *
 * page.tsx is "use client" (it lives off useUltronFetch), so the
 * metadata export has to live here. Layout is otherwise a pass-through.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "System Status · statenour",
  description: "Operator OS-health glance · security · infrastructure · cognition · cost",
};

export default function SystemStatusLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
