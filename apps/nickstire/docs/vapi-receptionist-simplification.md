# VAPI Inbound Receptionist — front-to-back simplification (wave-182)

**Before:** ~40,000 chars (~10.8k tokens) · **After:** 17,400 chars (~4,700 tokens) — **56% leaner.**
**Verified:** tsc 0 · brand-voice lint 0 violations · all interpolations + tools + the liquid template intact · template compiles + exports unchanged.

**Approach:** Moderate, in-place section compression — **behavior-preserving.** Every rule, tool, flow, and kill-list entry is kept; what was removed is duplication, embedded wave-by-wave *audit rationale* (editor notes, not model instructions), and verbose example dialogues. Scope: inbound `ASSISTANT_SYSTEM_PROMPT` only (the 3 outbound prompts + `FIRST_MESSAGE` + `VOICEMAIL_MESSAGE` untouched — already tight).

---

## Old → new behavior map (zero behavior dropped)

| Behavior | Status |
|---|---|
| IDENTITY — name / address / hours / reviews / tire-first / $60 + free-install package | **KEPT** (all `${BUSINESS.*}` interpolations intact) |
| VOICE — direct/calm/Cleveland-warm, "sound like" examples, "I'll text address only when sent:true", no literal "I don't know", job description | **KEPT** |
| Kill-list — fake-stock claims · all sale-killers (no-price / call-back-later / check-availability / no-opening / no-schedule / do-you-want-drop-off) · no repair $ beyond 3 anchors · dead-air tells ("anything else?" + 6-sec "are you still there?") · SMS-degraded "I'll text" | **KEPT** (operational entries verbatim-equivalent) |
| Kill-list — corporate-adjective enumeration ("trusted/expert/quality/premium/…") | **COMPRESSED to a category** ("if it sounds like a brochure, cut it"). Two reasons: the brand-voice CI lint flags those literal words on any rewrite, and the VOICE rule ("real shop guy, numbers over adjectives") already enforces it. Behavior identical for a phone agent. |
| HARD RULE 1 — sell-the-visit, 3 anchors only, the acknowledge→pivot→de-risk→urgency→close→capture pattern, oil close + which-oil | **KEPT** (GOOD examples trimmed 5→2; the BAD-examples list dropped — it duplicated the kill-list) |
| HARD RULES 2-5 — no named person · no "same day" unless `getCurrentWaitTime()` · no fake stock · end-call recap + `sendConfirmationSms` + degraded handling | **KEPT** |
| HARD RULE 6 — transfer on FIRST ask (+ trigger phrases + also-transfer cases) · HOURS GATE OPEN/CLOSED + `escalate` · PHONE-CAPTURE-BEFORE-TRANSFER + parallel capture | **KEPT.** The VAPI liquid time-template `{{"now" | date … }}` preserved verbatim. |
| TOOLS — all 9 custom (`tireSizeFromVehicle`, `tireInquiry`, `checkTireStock`, `bookSlot`, `getCurrentWaitTime`, `capacityCheck`, `escalate`, `sendConfirmationSms`, `shopInfo`) + built-in `transferCall`, with params + usage rules | **KEPT** (verbose descriptions → one tight line each; `getCurrentWaitTime`/`capacityCheck` share a line — both still wired) |
| FLOW 1 tire — NEW/USED/ODD confident-answer scripts + capture-via-tireInquiry close + no-empty-transfer rule | **KEPT** (the full Honda dialogue example removed; the scripts it demonstrated stay) |
| FLOW 2 repair — 3-beat RELIEF→URGENCY→CAPTURE close + the acknowledge→probe→urgency→close→capture pattern + price-up-front variant | **KEPT** (Camry dialogue + the "WHY THIS ORDER (wave-181.43)" psychology essay removed) |
| FLOW 3 transfer / FLOW 4 end-call + ANTI-LOOP | **KEPT** (FLOW 3 now points to Rule 6; anti-loop rationale trimmed) |
| SPECIAL CASES — flat · Spanish/Arabic · wrong-number · vehicle-at-shop · **tow play** (triggers + pitch + capture + confirm + tools + waffling close) · rack-check · callback-capture · walk-in/FCFS (wait vs drop-off) | **KEPT** |
| TRUST PHRASES (8 conditional) · URGENCY LIBRARY (8) · SMS-DEGRADED · NAME ECHO (Deepgram mishear) · COMPLIANCE (robot disclosure) · IF-STUCK · CORE | **KEPT** (the curiosity/FCFS phrase sub-banks dropped — those phrasings are demonstrated throughout the flows) |
| Embedded rationale everywhere — "wave-X audit found…", "21 of 76 transfers", "killed 12+ calls in 14 days", "burns VAPI minutes", "phone-quote conversions are weak" | **REMOVED** from the runtime prompt (editor-facing, not instructions) |

---

## Deploy + verify (operator-side)

This change is **inert until re-pushed** — the file only feeds `buildAssistantConfig`.

1. `npx tsx scripts/vapi-update-assistant.ts` (needs `VAPI_API_KEY`). It fetches the live assistant first and **preserves your dashboard-managed transfer/forward number** — a re-push won't blow it away.
2. Place 2-3 test calls and confirm:
   - **Used-tire ask** → tire-first, "$60 installed", capture + `tireInquiry`.
   - **Brake/repair ask** → the 3-beat free-check close, **no repair price quoted**.
   - **"Transfer me to a person"** → transfers on the first ask after grabbing a callback number.
3. Optional: `npx tsx scripts/vapi-prompt-diff.ts` to see the source-vs-live char delta.

If a behavior feels off on a live call, the full pre-simplification prompt is one `git revert` away.
