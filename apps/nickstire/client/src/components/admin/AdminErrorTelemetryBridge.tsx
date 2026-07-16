import type { AdminClientErrorRecord } from "@/lib/adminClientTelemetry";
import { trpc } from "@/lib/trpc";
import { useEffect } from "react";

export default function AdminErrorTelemetryBridge() {
  const report = trpc.adminSecurity.reportClientError.useMutation();

  useEffect(() => {
    const handler = (event: Event) => {
      const record = (event as CustomEvent<AdminClientErrorRecord>).detail;
      if (!record?.reference || !record.sectionName || !record.message) return;
      report.mutate({
        reference: record.reference,
        section: record.sectionName,
        message: record.message,
        componentStack: record.componentStack?.slice(0, 2000),
        path: record.pathname,
        userAgent: typeof navigator === "undefined" ? undefined : navigator.userAgent.slice(0, 300),
      });
    };
    window.addEventListener("nickstire:admin-client-error", handler);
    return () => window.removeEventListener("nickstire:admin-client-error", handler);
  }, [report]);

  return null;
}
