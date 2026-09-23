/**
 * CONTROL fixture for tests/scripts/seed-policies-dry-run.test.ts.
 *
 * This is the import chain `scripts/seed-policies.ts` loads DYNAMICALLY after
 * installing its `Module._load` stub — imported here STATICALLY, with no stub.
 * `derive-rule-policies` → `lib/brain/autonomous-engine` → `lib/ai/budget.ts`
 * → `server-only`, a Next.js tripwire whose entry throws by design and that
 * only the Next bundler rewrites to a no-op. Under plain `tsx` this file MUST
 * crash before the log line below runs.
 *
 * If it ever stops crashing, the tripwire moved or was removed, and the
 * positive half of the sibling test would pass for the wrong reason. Not a
 * `.test.ts` file on purpose: vitest must not collect it, tsx must spawn it.
 */
import "@/lib/automation/derive-rule-policies";

console.log("control: server-only did not trip");
