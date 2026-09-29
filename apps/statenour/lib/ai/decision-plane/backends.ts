import {
  SystemOneHttpBackend,
  type SystemOneHttpBackendConfig,
} from "./system-one-http";
import type { DecisionBackend } from "./types";

export type DecisionBackendName = "decider" | "kev" | "typesafe";

export interface DecisionBackendStatus {
  id: DecisionBackendName;
  requested: boolean;
  configured: boolean;
  trust: "private" | "external" | "unknown";
  reason: string;
}

const SUPPORTED = new Set<DecisionBackendName>(["decider", "kev", "typesafe"]);

function requestedNames(): DecisionBackendName[] {
  const raw = process.env.DECISION_PLANE_SHADOW_BACKENDS ?? "";
  const names = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(names)].filter(
    (name): name is DecisionBackendName => SUPPORTED.has(name as DecisionBackendName),
  );
}

function allowExternalState(): boolean {
  return process.env.NICK_DECISION_PLANE_ALLOW_EXTERNAL_STATE === "1";
}

function makeConfig(name: DecisionBackendName): SystemOneHttpBackendConfig | null {
  const external = allowExternalState();
  switch (name) {
    case "decider": {
      const baseUrl = process.env.DECIDER_BASE_URL?.trim();
      const model = process.env.DECIDER_MODEL?.trim();
      if (!baseUrl || !model) return null;
      return {
        id: name,
        baseUrl,
        model,
        apiKey: process.env.DECIDER_API_KEY?.trim() || undefined,
        allowExternalState: external,
      };
    }

    case "kev": {
      const baseUrl = process.env.KEV_BASE_URL?.trim();
      if (!baseUrl) return null;
      return {
        id: name,
        baseUrl,
        model: process.env.KEV_MODEL?.trim() || "kev-latest",
        apiKey: process.env.KEV_API_KEY?.trim() || undefined,
        allowExternalState: external,
      };
    }
    case "typesafe": {
      const apiKey = process.env.TYPESAFE_API_KEY?.trim();
      if (!apiKey) return null;
      return {
        id: name,
        baseUrl: process.env.TYPESAFE_BASE_URL?.trim() || "https://api.typesafe.ai",
        model: process.env.TYPESAFE_DEFAULT_MODEL?.trim() || "jev-latest",
        apiKey,
        // Hosted TypeSafe is intentionally unusable until the operator
        // separately attests that raw decision state may leave our network.
        allowExternalState: external,
      };
    }
  }
}

export function getDecisionBackendStatuses(): DecisionBackendStatus[] {
  const requested = new Set(requestedNames());
  return (["decider", "kev", "typesafe"] as const).map((id) => {
    if (!requested.has(id)) {
      return {
        id,
        requested: false,
        configured: false,
        trust: "unknown",
        reason: "not requested in DECISION_PLANE_SHADOW_BACKENDS",
      };
    }

    const config = makeConfig(id);
    if (!config) {
      const missing =
        id === "decider"
          ? "DECIDER_BASE_URL or DECIDER_MODEL missing"
          : id === "kev"
            ? "KEV_BASE_URL missing"
            : "TYPESAFE_API_KEY missing";
      return { id, requested: true, configured: false, trust: "unknown", reason: missing };
    }

    try {
      const backend = new SystemOneHttpBackend(config);
      return {
        id,
        requested: true,
        configured: true,
        trust: backend.trust,
        reason:
          backend.trust === "private"
            ? "configured on a private endpoint"
            : "configured with explicit external-state attestation",
      };
    } catch (err) {
      return {
        id,
        requested: true,
        configured: false,
        trust: "unknown",
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

export function getConfiguredDecisionBackends(): DecisionBackend[] {
  const requested = requestedNames();
  const backends: DecisionBackend[] = [];
  for (const name of requested) {
    const config = makeConfig(name);
    if (!config) continue;
    // Constructor enforces the public-endpoint egress policy.
    try {
      backends.push(new SystemOneHttpBackend(config));
    } catch {
      // Status endpoint exposes the reason. Runtime shadow evaluation simply
      // skips an unsafe/misconfigured backend instead of blocking chat.
    }
  }
  return backends;
}
