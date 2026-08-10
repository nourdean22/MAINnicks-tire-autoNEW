# Product Mission — NOUR OS (`apps/statenour`)

**Private, single-operator software.** There is exactly one user. That is a design constraint, not
a stage before growth: features are judged on whether they improve one person's decisions, and
"users should just be careful" is never an acceptable answer, because the operator is usually
reading this on a phone while something else is on fire.

## Problem

One person runs a shop, builds software, and holds the rest of a life at the same time. The
limiting factor is not effort or information — it is that context is scattered across tools,
open loops decay silently, and by the time a decision is due the evidence for it has to be
rebuilt from memory. The result is not dramatic failure but steady drift: the important thing
slips because the urgent thing was louder, and nothing in the stack notices.

The second problem is subtler and worse. An assistant that answers confidently from stale or
fabricated context does not merely fail to help — it moves decisions in the wrong direction while
feeling like help.

## Target users

The operator, on a phone, mid-task. Not a team, not a customer, not a future SaaS buyer. Design
consequences that follow directly:

- Answer-first output — the conclusion in the first sentence, the receipt inline.
- Both web apps run as standalone iOS PWAs, where `window.confirm/alert/prompt` are silently
  suppressed — in-DOM confirms and 48×48px touch targets are correctness, not polish.
- No onboarding, no multi-tenancy, no permission tiers to design around.

## Solution

An operating system for execution rather than a note-taking app: durable memory with recall that
cites its evidence, a task/mission engine that ranks by real capacity, a journal that feeds back
into what the agent knows, and the **Nick** agent on top of all of it — plus CRM, finance, wealth
and links so the operator's actual surface area is in one place.

What makes it work is the epistemic discipline, which is enforced in code rather than asked for:

- **Loud failure over silent catch.** Defect-hiding catches are treated as bugs; 29 were converted
  in one pass. A green run that hid a write-loss is worse than a red one.
- **Receipts, not claims.** A capability is proven by its artifact — the row, the drain count, the
  exit code — never by the fact that a function was invoked.
- **Unavailable data is empty, never mocked.** Same rule as the shop, for the same reason.
- **Verify before building.** The recurring failure here is not bad code, it is *rebuilding what
  already exists*: plan after plan has been gated on discovering the feature was already wired.
  Read `CURRENT-TRUTH.md` and the live system before designing anything.

## Roadmap

See [`roadmap.md`](roadmap.md) — note that statenour has no single canonical roadmap file the way
Nick's Tire does, and that file explains where the plan actually lives.
