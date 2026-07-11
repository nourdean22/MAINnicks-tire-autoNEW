interface CanonicalGscSummary {
  metricDefinitionVersion: "gsc-revenue-ops-v1";
  from: string;
  to: string;
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
  ctrUnit: "ratio";
  source: "gsc_official_no_dimension";
  fetchedAt: string;
  topQueries: Array<{ key: string; clicks: number; impressions: number; ctr: number; position: number }>;
  topPages: Array<{ key: string; clicks: number; impressions: number; ctr: number; position: number }>;
}

function getConfig() {
  return {
    url: process.env.NICKSTIRE_URL || process.env.NICKS_ADMIN_URL || "https://nickstire.org",
    key: process.env.STATENOUR_SYNC_KEY || process.env.BRIDGE_API_KEY || "",
  };
}

function unwrapTrpcPayload(value: unknown): CanonicalGscSummary | null {
  const root = value as {
    result?: { data?: { json?: CanonicalGscSummary } | CanonicalGscSummary };
  };
  const data = root?.result?.data;
  if (!data) return null;
  if (typeof data === "object" && "json" in data) return data.json ?? null;
  return data as CanonicalGscSummary;
}

export async function queryCanonicalGscSummary(input: {
  from: string;
  to: string;
  timeoutMs?: number;
}): Promise<{ data: CanonicalGscSummary } | { error: string; statusCode?: number }> {
  const { url, key } = getConfig();
  if (!key) return { error: "No sync key configured." };

  try {
    const response = await fetch(`${url}/api/trpc/statenourMetrics.gscExecutiveSummary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        json: {
          syncKey: key,
          startDate: input.from,
          endDate: input.to,
        },
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 15000),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      return { error: `HTTP ${response.status}`, statusCode: response.status };
    }
    const data = unwrapTrpcPayload(json);
    if (!data) return { error: "Canonical GSC bridge returned an invalid payload." };
    return { data };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
