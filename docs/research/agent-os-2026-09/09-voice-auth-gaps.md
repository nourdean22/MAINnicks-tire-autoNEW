# Track 9 — Voice / Auth / Connectors / Multimodal / Missed Gaps (verified 2026-09-03)

`[V]` verified primary source · `[S]` secondary only · `[E]` engineering judgment.
⚠ Many 2026 "comparison" sites that dominate search are SEO content farms.

## A. Voice / ambient assistant

### STT
| Engine | License | Latest | Verdict |
|---|---|---|---|
| **whisper.cpp** | MIT | v1.9.3 · 2026-08-20 `[S]` | **KEEP — the default on Windows.** Single binary, no Python, CUDA + Vulkan |
| faster-whisper | MIT | active | **KEEP** — best Python path; what Home Assistant's Wyoming add-on uses |
| NVIDIA Parakeet TDT 0.6B v3 | **CC-BY-4.0** | v3 (Granary, 25 langs + LID) | **AUGMENT** — 6.34% avg WER, **RTFx ≈3,333**. ⚠ NeMo is Linux-first; on Windows use the ONNX export via sherpa-onnx `[E]`. ⚠ conflicting report ranks it "23rd in accuracy" — accuracy-vs-throughput tradeoff is real |
| Canary-Qwen 2.5B | CC-BY-4.0 *(verify)* | #1 Open ASR, **5.63% WER** | **WATCH** — accuracy king, too heavy for always-on |
| **Mistral Voxtral Transcribe 2 / Realtime** | **Apache-2.0** | 2026-02-04 | **AUGMENT** — most interesting Apache-2.0 **streaming** ASR of 2026 |
| **Moonshine** | MIT | model Mar 2026, `moonshine-js` | **KEEP (niche)** — best for wake-word follow-on and **in-browser STT on the iPhone PWA** |
| pyannote.audio 4.0 | open weights, HF-gated | community-1 | **AUGMENT** — only real diarization option |

### Wake word
| Option | License | Verdict |
|---|---|---|
| **openWakeWord** | ⚠ **Code Apache-2.0, but PRETRAINED MODELS are CC BY-NC-SA 4.0** `[V]`; **v0.6.0 · Feb 2024 — no release in ~2.5 yrs** | ⛔ **REPLACE** — the NC-licensed models are a real commercial trap, and it's stale |
| microWakeWord | Apache-2.0 | **KEEP (edge only)** — right answer for ESP32-S3 satellites |
| **livekit-wakeword** | Apache-2.0 *(verify)* | **AUGMENT → likely KEEP.** Launched Apr 2026. Trains a custom wake word in one command. Claims **100× fewer false positives/hr, 86% vs 69% recall vs openWakeWord**. ⚠ vendor-published — verify |
| **Picovoice Porcupine** | Proprietary | ⛔ **DO NOT USE — free-tier keys stopped working 2026-06-30**; commercial plans start ~$6,000 |

### TTS
| Model | License | Verdict |
|---|---|---|
| **Kokoro-82M** | **Apache-2.0** | **KEEP — best default.** CPU-real-time, 54 voices, unencumbered. ⚠ thin bus factor (71 commits, 172 open issues) |
| **Piper** | ⚠ **LICENSE CHANGED: `rhasspy/piper` archived Oct 2025 (MIT) → `OHF-Voice/piper1-gpl` is GPL-3.0** | **KEEP for HA, but read the GPL** — also embeds GPL espeak-ng. MIT-era binaries stopped getting fixes Oct 2025 |
| Chatterbox (Resemble) | **MIT** | **AUGMENT** — best MIT-licensed cloning; ⚠ the 65.3% preference stat is the vendor's own study |
| Orpheus | Apache-2.0 | WATCH — quality/VRAM tradeoff rarely worth it |
| **Coqui XTTS v2** | ⚠ **CPML — NON-COMMERCIAL weights**; Coqui defunct Jan 2024 | ⛔ **DO NOT USE commercially — there is no one left who can sell you a license.** The single most common licensing mistake in this category |
| **Mistral Voxtral TTS** | ⚠ **CC BY-NC 4.0** | ⛔ **DO NOT USE self-hosted commercially** |
| Supertonic 3 / PocketTTS / Kitten | varies | **WATCH** — PocketTTS ships in Pipecat v1.7.0 (CPU-only) `[V]`, test it first |

**Voice-cloning legality (Ohio):** the model license is half of it. Cloning *your own* voice is fine.
Cloning a third party without consent exposes right-of-publicity claims, and from **2026-08-02** EU AI
Act Art. 50 deepfake-labeling duties if any EU person is in scope. **Rule: clone only your own voice,
and label synthetic audio** `[E]`.

### Realtime pipelines
| Framework | License | Verdict |
|---|---|---|
| **Pipecat** | **BSD-2** | **KEEP** — v1.8.1 · 2026-08-27, near-daily cadence. Right choice for a single-user pipeline |
| LiveKit Agents | Apache-2.0 | **AUGMENT** — pick if you want WebRTC-native barge-in, multi-device, or SIP |
| **LiveKit turn-detector** | open weights | **KEEP** — Qwen2.5-0.5B distilled, CPU-friendly. **Semantic end-of-utterance is the single biggest UX win over raw VAD** |
| **Silero VAD** | MIT | **KEEP** — v6.2.1 · 2026-02-24, universal, no strings |
| Vocode | MIT | ⛔ **DO NOT USE** — development slowed, **actively seeking maintainers** |
| Moshi / Ultravox / **Qwen3.5-Omni** | varies | **WATCH** — Qwen3.5-Omni (2026-03-30, 30B MoE/3B active) is the first credible open GPT-realtime substitute, **but 30B MoE is not an always-on budget on one desktop** `[E]` |

**Latency budget (target ≤800 ms perceived):** wake 20–80ms · VAD 30–50ms · **turn detection
50–150ms** · STT 150–300ms after end-of-speech · **LLM TTFT 200–600ms (dominant variable)** ·
TTS TTFA 70–250ms.
**Measured framework overhead: LiveKit SFU→worker <2ms, Pipecat frame passing <5ms — the framework is
never your latency problem; the model stack is.**

⚠ **E20: Turn detection is a distinct discipline.** Most personal-agent specs write "VAD" and stop.
**VAD answers *is someone talking*; turn detection answers *are they done*. Conflating them is why
home-built voice agents interrupt constantly.**

**Home Assistant's Wyoming protocol** is the reference architecture worth stealing even if you never
run HA: **define voice stages as network services behind a tiny protocol**, so you can swap
Kokoro→PocketTTS or whisper.cpp→Voxtral without touching the agent.

## B. Auth — the plain answer
> **For one person: passkeys + a reverse proxy is enough. Do not run an enterprise IdP.** Authentik,
> Keycloak, Zitadel and Ory solve problems you do not have. Keycloak for one human means a JVM, a
> Postgres, an upgrade treadmill, and a new single point of failure between you and your own tools.

**The ladder:** (1) **WebAuthn passkeys in the existing Next.js app** via SimpleWebAuthn or Better
Auth, sessions in Postgres — zero new infra. (2) If you want app-agnostic gating for many self-hosted
tools: **Authelia** as forward-auth behind Caddy (<30 MB RAM). (3) Only with real non-family users:
Authentik. (4) **Never for one person:** Keycloak, Zitadel, Ory.

| Library | License | Latest | Verdict |
|---|---|---|---|
| **SimpleWebAuthn** | MIT | **v14.0.0 · 2026-09-02** — adds ML-DSA post-quantum algs, WebAuthn Signal API; **min Node 22** | **KEEP** — de-facto standard. ⚠ single maintainer |
| **Better Auth** | MIT *(verify)* | ~100K weekly downloads by Mar 2026 | **KEEP** — fastest path to passkeys + OAuth + 2FA in Next.js 16 |
| **Zitadel** | ⚠ **AGPL-3.0 since 2025** (was Apache-2.0) | — | ⛔ **DO NOT USE** — license change + event-sourced storage growth for zero benefit at n=1 |

**Network:** **Tailscale Personal is free forever — 6 users, unlimited devices, 50 tagged resources**
(expanded from 3/100 in Apr 2026) `[V]`. Metadata visible to Tailscale; WireGuard data plane is E2E.
**Headscale** (BSD-3) is the escape hatch. ⚠ **NetBird moved server components to AGPLv3 in v0.53.0
(Aug 2025)**. **Cloudflare Tunnel + Access** free ≤50 users — but ⚠ **Cloudflare terminates TLS and
can see plaintext HTTP**, so use it only for the public edge, never the private agent plane.

**Recovery — the #1 solo-operator failure mode:** **register 2–3 passkeys on different devices from
day one.** A single passkey is a single point of lockout. Current guidance favors *passwordless*
break-glass with a **device-bound** hardware key. ⚠ **Digital legacy is part of auth:** Bitwarden ships
Emergency Access (7–14 day wait); **1Password does not**. For a one-person company whose agent holds
live credentials, that's real continuity risk.

## C. Connectors
| Domain | Approach | Watch-out |
|---|---|---|
| **Gmail** | **IMAP + app password, or narrow OAuth scopes** | ⚠ `https://mail.google.com/` and full-mailbox scopes are **restricted** → **CASA Tier 2 audit, re-verified every 12 months, ~$540–$1,000/yr**. Set the app **Internal** or stay narrow |
| **Calendar/Contacts** | **CalDAV / CardDAV** as the abstraction | Covers iCloud, Fastmail, Proton, Radicale, Baikal. Google Calendar scopes are *sensitive*, not restricted — lighter |
| **GitHub** | **Official `github/github-mcp-server`** | ⭐ **Append `/readonly` to any toolset URL to restrict to read tools** — the cleanest permission-tier primitive found in the whole MCP ecosystem |
| Google Drive/Docs | community MCP (`taylorwilsdon/google_workspace_mcp`) | ⚠ **No official Google MCP.** Pin a commit, read the code, run over stdio locally. Prefer `drive.file` over `drive.readonly` |
| **Telegram** | **Official Bot API** | **KEEP** — free, documented, no ToS grey zone. **The only messaging platform that is unambiguously fine** |
| Slack | Official remote MCP at `mcp.slack.com` | needs workspace-admin approval |
| **Signal** | — | ⛔ **No official bot API.** DO NOT USE for automation |
| **WhatsApp** | — | ⛔ **DO NOT USE.** Unofficial libs violate ToS (**bans pushed to whatsmeow users May 2025, including low-volume reply-only use**); and Meta's policy **banning general-purpose chatbots took effect 2026-01-15** — *both* routes are closed |
| Databases | dedicated **read-only role** + `statement_timeout` | An agent with your app's write creds is a blast-radius problem |
| Home automation | **Official HA `mcp_server`** (entity-scoped), v2026.9.0 | — |
| **Finance (read-only)** | **SimpleFIN Bridge $15/yr** (read-only, ~24 refreshes/day, used by Actual Budget) or **Teller.io free dev tier (100 connections)** | ⚠ **GoCardless/Nordigen is CLOSED to new signups and winding down** — any tutorial pointing there is stale. Never grant write/payment scopes |

### OAuth token lifecycle — the failure mode nobody designs for
- ⚠ **Consent screen in "Testing" → refresh tokens expire after 7 DAYS.** *The #1 cause of "my
  integration silently died last week."*
- Production → no fixed expiry, but tokens die after **6 months unused**, on password change (Gmail
  scopes), on revoke, or when the **50-token-per-client-per-user cap** silently invalidates the oldest.

**Design consequences:** store `refresh_token`, `expires_at`, `scope`, `issued_at`, `last_success_at`
per connector — not just the token · **refresh proactively at 50% of TTL, never lazily on 401** ·
**touch every connector on a schedule** so nothing crosses the 6-month line · **treat `invalid_grant`
as user-actionable, not retryable** — retrying a revoked grant forever is how you get rate-limited.

### Permission tiers
Rank by **reversibility and blast radius, not by how capable the agent is.**
`read` (none; log everything — **the read tier is where injection ENTERS**) → `draft` (inert) →
`propose` (shown, no side effect) → **`execute-with-confirmation`** (fresh WebAuthn user-verification,
**in-DOM never `window.confirm`**, action summary + undo window; **keep this tier small or it stops
being a control**) → `autonomous-low-risk` (budget + rate cap + kill switch).
**Deny by default on timeout — an unanswered approval must expire to "no."**

### Connector health — the thing personal-agent specs always omit
Per connector persist `last_success_at`, consecutive failures, token TTL remaining, scope drift,
rate-limit headroom. **Alert on the FIRST `invalid_grant`**, and on `last_success_at` older than 2×
expected cadence. **Silent connector death is indistinguishable from "nothing happened today" — the
same failure the /brain audit already caught in another form.**

### MCP security
⚠ **~5.5% of 1,899 surveyed MCP servers showed tool poisoning; 72.4% cascade rate** when multiple
servers are compromised. The 2025 Supabase incident had a malicious instruction embedded in a
**support ticket** the agent then executed. OWASP classifies this as **ASI01 Agent Goal Hijack**.
**Rules:** pin server versions by commit · run community servers over stdio locally, never remote ·
own least-privilege credential per server · **never let a `read`-tier tool's output select the
arguments of an `execute`-tier tool without a human in between.**

## D. Multimodal
**OCR:** **PaddleOCR-VL 1.6** (Apache-2.0, **96.33% OmniDocBench**) — best open default · dots.ocr ·
**DeepSeek-OCR** (cost-per-page winner for bulk) · Tesseract (clean simple text only).
⚠ **Honest caveat: OmniDocBench proves layout/table/formula parsing, NOT production
key-information-extraction reliability on your invoices and currencies — validate numerics yourself.**

**Local image:** **FLUX.2 [klein] 4B (Apache-2.0, ~8GB)** — best license/quality/VRAM combo ·
**Qwen-Image-Edit (Apache-2.0)** — instruction-driven editing, lower VRAM · SDXL (legacy LoRA
ecosystem) · ⚠ FLUX.2 [dev] 32B is a **non-commercial dev license** — check before any ad use.
*Directly relevant to the standing "no fake AI people in Nick's Tire ads" rule: Qwen-Image-Edit +
FLUX.2 klein cover real product-object editing entirely locally, $0, Apache-2.0.*

**Screenshot/GUI:** OmniParser (MIT) + UI-TARS. See Track 4 for benchmarks.

**Where proprietary is still clearly ahead:** long-context multi-page document reasoning · image
prompt-adherence and text-rendering-in-images · realtime speech-to-speech naturalness · video ·
**multilingual ASR breadth (Whisper 99+ langs vs Parakeet's 25)**.

## E. "What did we miss" — 20 items with evidence
| # | Area | Verdict |
|---|---|---|
| **E1** | **iOS PWA platform ceiling** — no Background Sync, no silent push, push only when Home-Screen-installed | 🔴 **HARD CONSTRAINT.** The phone can never *run* the agent — only command and confirm it. All scheduling on Railway/Windows |
| **E2** | **Cost-runaway kill switches** — documented: an agent burned **$15 in under 10 minutes**; OpenRouter now ships **Guardrails** with per-key spend caps returning 402 | **KEEP — implement BEFORE autonomy.** Per-feature token budget, context diet, model routing, hard circuit breaker. **Per-entity caps, not shared pools.** Add a per-run tool-call ceiling |
| **E3** | Local-first/CRDT sync | **AUGMENT** — PowerSync-over-Postgres is the shortest path to an app that works on bad LTE in a tire bay. (But see Track 8: scope Yjs to the editor) |
| **E4** | **Open-weight LICENSE compliance** — Llama's license is a **bilateral contract under California law** w/ downstream propagation, 700M-MAU threshold, naming duty, output-training ban; Llama 3.2 multimodal **excludes EU-domiciled** users; **Gemma 4 moved to Apache-2.0** | **KEEP a license register**: one row per model — license, commercial-OK, redistribution-OK, naming duty, geo-exclusions. *Same bug class as the XTTS/CPML trap above* |
| **E5** | **Agent identity & delegation** — IETF `draft-oauth-identity-chaining` **passed WG last call in early 2026**, on the RFC track | **WATCH but design for it now** — record `(user, agent, tool, scope, hop)` on every action. **Retrofitting audit is far worse than logging from day one** |
| **E6** | **EU AI Act — what actually bit 2026-08-02**: Art. 50 transparency duties **LIVE** (chatbot disclosure, AI-content marking, deepfake labeling); penalties to **€15M or 3% turnover**. High-risk pushed to **Dec 2027 / Aug 2028** | **AUGMENT** — cheap insurance: label synthetic audio/images, disclose the bot, keep a model inventory. **Do NOT buy "high-risk compliance" — it doesn't apply yet** |
| **E7** | **Supply-chain attestation** — npm trusted publishing auto-generates Sigstore provenance. ⚠ **May 2026 "Mini Shai-Hulud" shipped packages with cryptographically VALID provenance** because the build platform didn't meet SLSA Build L3 | **KEEP** — enable trusted publishing. **Lesson: a valid attestation is not a safety claim — verify WHICH builder signed it** |
| **E9** | **Energy/thermal** — RTX 4090 **throttles at 83 °C costing 10–20% inference speed**; a box idling at 80 W ≈ **$9.79/mo at $0.17/kWh**; 5090 at 8h/day ≈ $31/mo | **AUGMENT** — wake-on-demand the GPU, cap sustained clocks, keep STT/TTS on CPU so the GPU sleeps. *(Moot on the measured host — no discrete GPU)* |
| **E10** | **Reproducible environments** — Nix = deepest but **2–3 weeks to competence for one person**; devcontainers = lowest barrier but only as reproducible as your **digest pinning** | **AUGMENT: devcontainers + digest pinning, or mise.** Nix's payback exceeds this project's memory. *Directly addresses the recurring "new workspace pkg missing from app Dockerfile" clog* |
| **E11** | **DR drills** — standard is **3-2-1-1-0**, where the **0 means zero unverified restores** | 🔴 **KEEP — schedule an actual restore.** *Neon PITR is not a backup you've tested.* See Track 7 |
| **E12** | Data portability / vendor exit — DMA mandates "real-time and continuous" portability | **AUGMENT** — build an export path *out* of your agent's memory from the start. **The connector easiest to add is the one hardest to leave** |
| **E13** | **Notification fatigue** — users disable notifications wholesale under overload | **KEEP.** Test: notify only if asked-for, time-sensitive-and-costly-to-miss, needs a decision only they can make, or carries context available nowhere else. *The brief-push combine already implemented this — extend the rule to every new alert; default new types to digest* |
| **E14** | **Accessibility as legal** — **European Accessibility Act enforcement began 2025-06-28**; EN 301 549 → WCAG 2.1 AA, v4.1.1 planned 2026 for WCAG 2.2 AA; micro-enterprise exemption **<10 employees AND <€2M** | **AUGMENT** — exemption likely covers Nick's Tire for EU; **US ADA Title II/III litigation is the live domestic risk.** Voice-first UI is an accessibility *asset* if you keep a keyboard path |
| **E15** | **WASM/browser-local inference** — **WebGPU enabled by default across all major browsers 2025-11-25**, incl. **Safari on iOS 26** | **WATCH → selective KEEP.** Realistic use: **Moonshine STT + embeddings in-browser on the iPhone**, not a 20B LLM. Offline dictation at zero server cost |
| **E16** | **P2P device execution** — **llama.cpp RPC backend** is the repeatable path; AMD published a 4-node cluster running a trillion-param-class model via it | **WATCH** — moot with one box; if a second machine appears, **llama.cpp RPC, not exo** |
| **E17** | **Content provenance (C2PA)** — real in hardware 2026 (Pixel 10, Leica, Nikon, Canon, Sony, Galaxy S26); BBC/NYT/Reuters/AP signing. ⚠ **the chain breaks whenever a platform strips metadata on upload** | **WATCH — adopt on OUTPUTS only.** Sign images your agent generates so you can prove provenance; **don't build anything depending on inbound credentials surviving Instagram** |
| **E18** | **Recording law — Ohio is ONE-PARTY consent** | **KEEP — you are legally clear for your own always-on capture in Ohio.** ⚠ Two caveats: calls with parties in **two-party states (CA, FL, PA, IL, WA)** flip the analysis — strictest jurisdiction governs; and a shop-floor mic capturing conversations you aren't part of is the illegal case. **Store a per-recording state/participant field, not a global consent flag** |
| **E19** | **Digital legacy / continuity for a one-person company** | **AUGMENT** — an agent holding live API keys, Railway, prod DB creds and a Meta business account with no successor path is a single point of failure **for the business**, not just the tooling |
| **E20** | Turn detection as a distinct discipline | **KEEP** — see Voice above |

## Recommended $0 blueprint
Wake: livekit-wakeword · VAD+turn: Silero v6.2.1 + LiveKit turn-detector · STT: whisper.cpp
large-v3-turbo (Moonshine in the PWA) · TTS: Kokoro-82M · Orchestration: Pipecat v1.8.1 ·
Auth: Better Auth or SimpleWebAuthn v14, **3 passkeys registered** · Network: **Tailscale Personal
($0)** · Connectors: Telegram Bot API, GitHub MCP `/readonly`, HA `mcp_server`, IMAP, CalDAV ·
Finance: Teller free or SimpleFIN $15/yr · Vision: PaddleOCR-VL + FLUX.2 klein + Qwen-Image-Edit.
**Recurring: $0–15/yr + electricity.**

## Top 5 risks to close first
1. **openWakeWord's pretrained models are CC BY-NC-SA** — a commercial-use defect if already specced.
2. **XTTS v2 / Voxtral TTS are non-commercial weights** with no seller left. Any cloning plan on them is void.
3. **Piper relicensed to GPL-3.0** Oct 2025; the MIT repo is archived — check what your HA path pulls.
4. **Google OAuth in "Testing" dies every 7 days**; restricted Gmail scopes drag in an annual CASA audit.
5. **No cost kill switch = unbounded liability** the moment any tier goes autonomous. **Ship the
   circuit breaker before the autonomy.**
