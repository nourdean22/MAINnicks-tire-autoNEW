export interface AdminClientErrorRecord {
  reference: string;
  sectionName: string;
  message: string;
  componentStack?: string;
  pathname: string;
  occurredAt: string;
}

const STORAGE_KEY = "nickstire.adminClientErrors";
const MAX_RECORDS = 20;

function createReference(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `ADM-${timestamp}-${random}`;
}

/**
 * Records a bounded, privacy-safe diagnostic trail in the operator browser and
 * emits a structured event that an installed monitoring integration can consume.
 */
export function recordAdminClientError(input: {
  sectionName: string;
  error: Error;
  componentStack?: string;
}): AdminClientErrorRecord {
  const record: AdminClientErrorRecord = {
    reference: createReference(),
    sectionName: input.sectionName,
    message: input.error.message || "Unknown client error",
    componentStack: input.componentStack?.slice(0, 8_000),
    pathname: typeof window === "undefined" ? "/admin" : window.location.pathname,
    occurredAt: new Date().toISOString(),
  };

  if (typeof window !== "undefined") {
    try {
      const existing = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
      const records = Array.isArray(existing) ? existing : [];
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([record, ...records].slice(0, MAX_RECORDS)),
      );
    } catch {
      // Storage may be unavailable in private/restricted browser contexts.
    }

    window.dispatchEvent(new CustomEvent("nickstire:admin-client-error", { detail: record }));
  }

  return record;
}
