/**
 * Nexus Audit Sampler
 */

export function shouldAuditMessage(normalizedPhone: string, body: string, variantKey: string): { shouldAudit: boolean; reason: string } {
  // 1. Mandatory audit for known high-risk variants
  if (variantKey === "nickgpt_v2" || variantKey === "nickgpt_experimental") {
    return { shouldAudit: true, reason: "high_risk_variant" };
  }

  // 2. 100% audit for any message from NickGPT variants
  if (variantKey.includes("nickgpt")) {
    return { shouldAudit: true, reason: "nickgpt_model_reply" };
  }

  // 3. Random 10% sampling for everything else (control group)
  if (Math.random() < 0.10) {
    return { shouldAudit: true, reason: "random_10pct" };
  }

  return { shouldAudit: false, reason: "skipped" };
}
