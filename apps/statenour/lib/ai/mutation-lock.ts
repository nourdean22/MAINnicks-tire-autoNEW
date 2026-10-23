/**
 * NICK_MUTATION_LOCK, read ONE way: lib/ai/tools.ts authorityGate refuses tool
 * writes with it, and lib/services/chat/brain-context.ts uses it to keep the
 * contradiction lanes from asking a question whose answer the gate would refuse.
 * An unreadable flag is "unknown", and both callers treat unknown as locked
 * (fail closed). Kept out of lib/ai/tools.ts because that module imports every tool.
 */
import { getFlag } from "@/lib/feature-flags";

export type MutationLockState = "off" | "on" | "unknown";

export function readMutationLock(): MutationLockState {
  try {
    return getFlag("NICK_MUTATION_LOCK")?.isOn ? "on" : "off";
  } catch {
    return "unknown";
  }
}
