# StateNour (bdnick.info) — September 2026 Standards, Platform & Data Sources Report

**Scope.** External, read-only verification of current (September 2026) security/governance
standards, web-platform/iOS PWA capabilities, accessibility guidance, and lawful external data
sources relevant to StateNour — a single-operator personal AI operating system running as an
installed iOS PWA and desktop web app on Next.js 16, with Google OAuth sign-in, Gmail/Calendar/Drive
ingestion, an MCP server endpoint, a Custom-GPT Actions bridge, a Telegram bot, web push, multiple
LLM providers (Ollama Cloud, OpenRouter, OpenAI, Anthropic, Gemini), Langfuse Cloud AI-trace export,
and Sentry error tracking.

**Method.** WebSearch + WebFetch only, read-only, no files modified except this one. Every claim is
anchored to a first-party/primary source with URL, the source's own stated publication/last-updated
date, and the access date. Where no primary source could be confirmed, the item is marked
**NOT VERIFIED** rather than asserted from memory. No confidence percentages are used, per instructions.

**Default access date for citations in this report: 2026-09-02**, unless a different access date is
noted inline next to a specific source.

---

## Table of contents
- Part A — Security & governance standards
- Part B — Web platform & iOS PWA capabilities (+ summary table)
- Part C — Accessibility
- Part D — Lawful, high-signal external data sources
- Sources (consolidated)
- Summary (<=600 words)
- NOT VERIFIED list

---

## PART A — SECURITY AND GOVERNANCE STANDARDS

### A.1 OWASP Top 10 for LLM Applications

**Status:** The 2025 edition is superseded. **OWASP GenAI LLM Top 10 2026 is current.**
**Date:** 2025 edition published 2024-11-17; **2026 edition (current) published 2026-08-03/04.**
**URL:** current — https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/ · superseded 2025 — https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/ · list cross-checked via https://github.com/GenAI-Security-Project/GenAI-LLM-Top10

2026 list: LLM01 Prompt Injection · LLM02 Sensitive Information Disclosure · LLM03 Excessive Agency · LLM04 Supply Chain · LLM05 Data and Model Poisoning · LLM06 Unbounded Consumption · LLM07 Misinformation · **LLM08 Hidden Context Exposure (new in 2026)** · LLM09 Vector and Embedding Weaknesses · LLM10 Improper Output Handling.

Most relevant to StateNour:
- **LLM01 Prompt Injection** — Gmail/Calendar/Drive content pulled into context is attacker-reachable input the model can't distinguish from the operator's own instructions.
- **LLM02 Sensitive Information Disclosure** — inbox/calendar/Drive data is routed across 5 external providers (Ollama Cloud, OpenRouter, OpenAI, Anthropic, Gemini); each hop is a place PII can leak into logs, traces, or provider-side retention.
- **LLM03 Excessive Agency** — the MCP server, Telegram bot, and Custom GPT bridge all grant the model functional reach (read/write calendar, draft/send mail); over-broad tool grants let a manipulated prompt take real-world action.
- **LLM04 Supply Chain** — five model providers plus an MCP tool ecosystem multiply implicitly-trusted third-party components.
- **LLM08 Hidden Context Exposure (new)** — directly on point: ingesting full mailbox/calendar/Drive content into a context window also reachable via MCP or Custom GPT Actions risks exposing more than the calling agent should see.
- **LLM06 Unbounded Consumption** — the MCP server and GPT Actions bridge are externally callable; without limits, repeated calls drive metered LLM-API cost or resource exhaustion.
- **LLM09 Vector and Embedding Weaknesses** — if Gmail/Drive content is embedded for retrieval, poisoned/malformed embeddings become an injection vector into future responses.
- **LLM10 Improper Output Handling** — model output that triggers downstream actions (sending mail, writing calendar events) without validation is an injection/action-execution vector.

### A.2 OWASP guidance for agentic AI / AI agents

**Status:** Two current, related OWASP GenAI Security Project deliverables — a threat-modeling reference, and a newer numbered Top 10 built on it.
**Date:** "Agentic AI – Threats and Mitigations" v1.0 — 2025-02-17. "OWASP Top 10 for Agentic Applications for 2026" — 2025-12-09.
**URL:** https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/ · https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/

The Feb-2025 document lays out a T1-T17 threat taxonomy across five categories (Agent Design, Agent Memory, Planning & Autonomy, Tool Use, Deployment & Operations); the Dec-2025 "Top 10 for Agentic Applications 2026" (ASI01-ASI10:2026) is the practitioner-facing distillation, corroborated across multiple independent secondary sources (Cycode, GoTeleport, Practical DevSecOps, DeepTeam, Modulos) reporting identical codes — the primary page confirms title/date but gates the itemized list behind a PDF not extractable in-session.

Most relevant to StateNour:
- **ASI01 Agent Goal Hijack** — injected instructions from an ingested email, calendar invite, or Drive doc could redirect what the agent is trying to do.
- **ASI02 Tool Misuse & Exploitation** — the MCP server exposes real mail/calendar/drive-action tools to external callers; a compromised or malicious caller can misuse legitimate tools within their granted scope.
- **ASI03 Agent Identity & Privilege Abuse** — single-operator OAuth identity flowing through MCP + Custom GPT Actions needs clean per-caller attribution so privileges aren't misapplied or laundered through the bridge.
- **ASI04 Agentic Supply Chain Compromise** — 5 LLM providers + MCP tool ecosystem = an expanded dependency surface.
- **ASI06 Memory/RAG Poisoning** — ingested mailbox/calendar/Drive content that persists in context or memory can be poisoned to corrupt later agent behavior.
- **ASI09 Human-Agent Trust & Delegation** — a single operator delegating real-world authority (send mail, write calendar) to the agent is exactly the human-in-the-loop gap this category targets.
- **ASI10 Rogue Agents** — push-notification/Telegram-triggered autonomous actions need bounds and oversight so the agent can't act outside intended scope unattended.

### A.3 OWASP Top 10 Web Application Security Risks

**Status:** **OWASP Top 10:2025 is current**, superseding 2021 — first major revision since 2021.
**Date:** Release candidate announced 2025-11-06 at OWASP Global AppSec Washington DC; finalized around January 2026 per secondary sources (primary page shows a "2021-2025" copyright line, not an explicit single release day). Next revision not expected until roughly 2028-2029.
**URL:** https://owasp.org/Top10/2025/

List: A01 Broken Access Control · A02 Security Misconfiguration · **A03 Software Supply Chain Failures (new)** · A04 Cryptographic Failures · A05 Injection · A06 Insecure Design · A07 Authentication Failures · A08 Software or Data Integrity Failures · A09 Security Logging and Alerting Failures · **A10 Mishandling of Exceptional Conditions (new)**. SSRF was folded into Broken Access Control.

Most relevant to a Next.js 16 app doing OAuth + exposing Telegram/Stripe-adjacent webhooks: **A01 Broken Access Control** (OAuth session/authorization boundaries), **A07 Authentication Failures** (Google OAuth + Telegram bot auth flows), **A02 Security Misconfiguration** (Next.js/edge config, exposed routes), **A05 Injection** (webhook payload handling), **A10 Mishandling of Exceptional Conditions** (webhook/error-path handling, new in 2025).

### A.4 OWASP API Security Top 10

**Status:** 2023 edition remains current — no newer edition found.
**Date:** 2023-07-03.
**URL:** https://owasp.org/API-Security/editions/2023/en/0x11-t10/ · release note https://owasp.org/blog/2023/07/03/owasp-api-top10-2023

List: API1 Broken Object Level Authorization · API2 Broken Authentication · API3 Broken Object Property Level Authorization · API4 Unrestricted Resource Consumption · API5 Broken Function Level Authorization · API6 Unrestricted Access to Sensitive Business Flows · API7 Server Side Request Forgery · API8 Security Misconfiguration · API9 Improper Inventory Management · API10 Unsafe Consumption of APIs.

Most relevant to StateNour's MCP server + Custom-GPT Actions bridge (both APIs exposed to semi-trusted external callers):
- **API1 Broken Object Level Authorization** — MCP tool calls / GPT Actions touching specific emails/events/files need per-object checks.
- **API2 Broken Authentication** — both the MCP endpoint and the Actions bridge need solid caller authentication.
- **API4 Unrestricted Resource Consumption** — externally-callable endpoints without rate/cost limits risk billing/resource exhaustion.
- **API5 Broken Function Level Authorization** — a caller shouldn't reach higher-privilege tools (e.g. send/delete) than intended.
- **API6 Unrestricted Access to Sensitive Business Flows** — sending mail / altering calendar needs abuse controls beyond authN.
- **API8 Security Misconfiguration** — CORS, verbose errors, debug surfaces on the MCP/Actions endpoints.
- **API9 Improper Inventory Management** — StateNour runs several exposed surfaces (MCP, GPT Actions, Telegram webhook, web push); shadow/forgotten endpoints are the classic failure mode.
- **API10 Unsafe Consumption of APIs** — cuts both ways: StateNour itself consumes Gmail/Calendar/Drive and 5 LLM provider APIs and must not blindly trust their responses.

### A.5 NIST AI Risk Management Framework 1.0

**Status:** NIST AI 100-1 (AI RMF 1.0) — still the baseline; NIST's own page notes it "is being revised as part of the White House AI Action Plan" (in progress, not yet superseded).
**Date:** 2023-01-26.
**URL:** https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10 · https://www.nist.gov/itl/ai-risk-management-framework

Four core functions: **Govern** (organizational culture/policy/oversight for AI risk), **Map** (identify context and risks of a specific AI system), **Measure** (analyze/track risks with metrics), **Manage** (prioritize and act on risks, allocate treatment/monitoring resources) — together embedding trustworthiness across the AI lifecycle.

### A.6 NIST AI 600-1 (Generative AI Profile)

**Status:** No confirmed 2026 revision of AI 600-1 itself.
**Date:** 2024-07-26.
**URL:** https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf

2026-update check: **NOT VERIFIED** that AI 600-1 itself has been revised/reissued as of Sept 2026. Separate/adjacent NIST activity exists but is not a revision of 600-1: a concept note for an AI RMF Profile on Trustworthy AI in Critical Infrastructure (2026-04-07), a draft sector Cybersecurity Profile for AI (2026), and CAISI's AI Agent Standards Initiative (announced Feb 2026). The next major AI RMF version — and with it, presumably the GenAI Profile update — isn't expected until 2026-2027.

The profile's 12 risk categories (confirmed via secondary corroboration): CBRN Information or Capabilities, Confabulation, Dangerous/Violent/Hateful Content, Data Privacy, Environmental Impacts, Harmful Bias and Homogenization, Human-AI Configuration, Information Integrity, Information Security, Intellectual Property, Obscene or Degrading Content, Value Chain and Component Integration.

Most relevant to a personal generative-AI agent with tool-use/agentic capability:
- **Data Privacy** — Gmail/Calendar/Drive ingestion into LLM context is a direct personal-data-privacy risk.
- **Information Security** — 5-provider routing plus an exposed MCP server widens the exfiltration/attack surface.
- **Confabulation** — a hallucinating agent that can also act (send mail, write calendar) turns a text error into a real-world one.
- **Value Chain and Component Integration** — five LLM providers, an MCP ecosystem, Langfuse, Sentry: each is a vendor-trust dependency.
- **Human-AI Configuration** — single-operator reliance raises the bar on human-in-the-loop design for consequential actions.
- **Information Integrity** — agent-drafted/relayed content (email drafts, Telegram messages) needs a check against spreading bad information.
- **Intellectual Property** — Drive documents may carry proprietary/third-party content pushed into external providers' context windows.

### A.7 MCP (Model Context Protocol) official security best practices

**Status:** Official page, currently aligned to spec version **2026-07-28**; a version-pinned copy exists for spec 2025-11-25.
**Date:** Current spec 2026-07-28; version-pinned copy 2025-11-25.
**URL:** https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices (latest) · https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices#session-hijacking (version-pinned)

**Confused Deputy Problem** — arises when an MCP proxy server uses a static client ID to a third-party auth server while letting MCP clients dynamically register; a leftover browser consent cookie lets an attacker skip consent and redirect the authorization code to their own server. Guidance: proxy servers **MUST** implement per-client consent *before* forwarding to the third-party authorization step — maintain a per-user registry of approved client IDs, show a clear MCP-owned consent screen naming the client and requested scopes, use signed/`__Host-`-prefixed consent cookies, validate `redirect_uri` by exact match, and generate a cryptographically random, single-use, short-lived OAuth `state` value set only *after* consent is approved.

**Token Passthrough** — an anti-pattern where a server accepts a token not issued for it (fails audience/`aud` validation per RFC 9068) and forwards it unmodified downstream, breaking rate-limiting/audit controls and potentially recreating the confused-deputy problem downstream. Guidance is unconditional: MCP servers **MUST NOT** accept any token not explicitly issued to that server, and must never forward client-supplied tokens to another API unvalidated.

**Session Hijacking (2025-11-25 spec era) / State Handle Hijacking (current 2026-07-28 spec)** — if a server-issued session ID is predictable/guessable/obtained by an attacker, it can be replayed to impersonate the original client. **Currency note:** as of the current spec, MCP dropped protocol-level sessions and is now stateless — the "Session Hijacking" section was replaced by **"State Handle Hijacking,"** covering the same risk (a stolen/guessed identifier used to impersonate another user) reframed around explicit, application-minted state handles rather than a protocol session. Mitigation is functionally identical either way: servers **MUST NOT** treat possession of a session/state identifier as authentication; identifiers **MUST** be non-deterministic (CSPRNG-generated) and **SHOULD** be rotated/expired and bound server-side to the authenticated user (e.g. `<user_id>:<session_id>`). For StateNour: never trust a session/state identifier alone — always re-derive identity from a verified token server-side.

### A.8 OAuth 2.1 (draft-ietf-oauth-v2-1)

**Status:** Active Internet-Draft, revision **-15**. Not published as an RFC.
**Date:** Draft -15 published 2026-03-02; expires 2026-09-03 (normal 6-month IETF draft lapse, not evidence of abandonment). Working-group milestone: submit to IESG by Dec 2026.
**URL:** https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/

OAuth 2.1 is a consolidation, not a new mechanism: it formally obsoletes RFC 6749 (OAuth 2.0 Framework) and RFC 6750 (Bearer Token Usage), folding in RFC 8252 (Native Apps), RFC 7636 (PKCE), RFC 10017 (Browser-Based Apps — A.9 below), and RFC 9700 (OAuth 2.0 Security BCP). Since it's still a draft, nothing built today can claim finished "OAuth 2.1 compliance" — the practical guidance already lives in the finalized documents it consolidates, which StateNour should follow directly.

### A.9 OAuth 2.0 for Browser-Based Applications

**Status:** **Published as RFC 10017** — Best Current Practice, part of BCP 212. No longer a draft.
**Date:** 2026-08.
**URL:** https://datatracker.ietf.org/doc/rfc10017/ · text: https://www.rfc-editor.org/rfc/rfc10017.html

Key recommendations for a Next.js 16 app doing Google OAuth from an installed iOS PWA + desktop web app:
- **Implicit grant flow is a "Discouraged and Deprecated Architecture Pattern"** (§7.2) — returns the access token in the URL fragment. StateNour must never use it.
- **Authorization Code + PKCE is mandatory** for public clients (§6.3.2.1): "Browser-based applications that are public clients MUST implement the PKCE [RFC7636] extension."
- **Backend-for-Frontend (BFF) is the strongly recommended architecture** (§6.1.4.3) — "strongly recommended for business applications, sensitive applications, and applications that handle personal data." The backend holds tokens server-side and proxies API calls; the browser never sees them.
- **Token storage:** in-memory preferred over persistent (localStorage); a token-mediating backend/BFF avoids browser-side token storage entirely (§8, §6.1, §6.2.4.4).
- **Refresh tokens for public clients** (§6.3.2.3): the authorization server MUST either rotate refresh tokens on each use or use sender-constrained refresh tokens, and must cap lifetime or expire unused tokens.
- **CSRF defense** (§6.3.2.2): PKCE-required config, a verified `state` parameter, or OIDC `nonce`. For BFF cookie sessions, `SameSite=Strict` plus a custom CORS header is recommended (§6.1.3.3).
- **Redirect URI validation** (§6.3.3.2.1): exact string match only — no wildcard/pattern matching.

Since StateNour runs as both an installed iOS PWA and desktop web app doing Google sign-in, the BFF pattern (a Next.js server route handling the OAuth exchange, session cookie to the client) is what this BCP treats as the secure default.

### A.10 WebAuthn / Passkeys

**Status:** **WebAuthn Level 3 is now a W3C Recommendation** — final standards-track status.
**Date:** 2026-08-25.
**URL:** https://www.w3.org/TR/webauthn-3/ · dated snapshot https://www.w3.org/TR/2026/REC-webauthn-3-20260825/

Direct quote: "This document was published by the Web Authentication Working Group as a **Recommendation**... W3C recommends the wide deployment of this specification." This is very recent — roughly a week before this report WebAuthn L3 was still in Candidate/Proposed-Recommendation stages. (WebAuthn Level 2 has separately been a Recommendation for some time — exact date NOT VERIFIED here, not required for this task.)

**Passkey autofill (conditional mediation) support:** MDN's Baseline indicator states `isConditionalMediationAvailable()` is "Baseline Widely available... since October 2023" (https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredential/isConditionalMediationAvailable_static). Chrome for Developers confirms Chrome shipped conditional-UI support from Chrome 108 (https://developer.chrome.com/docs/identity/webauthn-conditional-ui). Third-party trackers report Safari 16+/Firefox 122+ as approximate minimums — NOT independently primary-verified, treat as indicative.

### A.11 Content Security Policy Level 3

**Status:** **W3C Working Draft** — not yet a Recommendation (earlier on the standards track than WebAuthn L3).
**Date:** 2026-08-13.
**URL:** https://www.w3.org/TR/CSP3/

Despite Working Draft status, `strict-dynamic` and nonces are already shipped across major browsers and are the current industry-recommended pattern (per web.dev, updated 2024-09-13: https://web.dev/articles/strict-csp). Practical points for a Next.js 16 CSP header:
- **Prefer nonce/strict-dynamic over host allowlists** — allowlists "can be bypassed by attackers" and require constant upkeep.
- **Nonce generation:** cryptographically strong, 128+ bits, base64-encoded, freshly generated on every single response — never reused (e.g. `crypto.randomBytes(16).toString("base64")` per request).
- **`strict-dynamic`** propagates trust from the nonce'd top-level script to its dynamically-loaded children, removing the need to allowlist every script domain.
- **Legacy fallback:** `script-src 'nonce-{random}' 'strict-dynamic' https: 'unsafe-inline';` — modern browsers ignore the `https:`/`unsafe-inline` fallback tail, so it doesn't weaken the policy where `strict-dynamic` is understood.
- **`object-src 'none'`** disables Flash/plugin injection vectors; **`base-uri 'none'`** blocks `<base>`-tag injection hijacking relative-URL script loads.
- **Eliminate inline event handlers and `javascript:` URIs** — a nonce/hash-based CSP prohibits this markup pattern outright.
- **Avoid `eval()`** — refactor `eval()`-based JSON parsing to `JSON.parse()`; keeping `eval()` forces `'unsafe-eval'`, which weakens the policy.
- Because a fresh nonce is needed per request, static/prerendered Next.js 16 pages are incompatible with this pattern unless switched to dynamic rendering (middleware-generated nonce + matching header) — a concrete architectural constraint for StateNour's CSP design.

### A.12 Google OAuth app verification requirements

**Status:** Current Google Cloud / Google Identity policy.
**Date:** Refresh-token page last updated 2026-05-26 UTC.
**URL:** https://developers.google.com/identity/protocols/oauth2 · https://support.google.com/cloud/answer/13464323 · https://support.google.com/cloud/answer/7454865

**(a) Is a single-user personal app exempt from verification?** Apps in Testing/development/staging mode are not subject to verification; apps for **personal use with fewer than 100 users** can keep running unverified (users click through an "unverified app" warning); apps restricted to an **Internal** Workspace/Cloud Identity user type skip verification entirely (unavailable for a project tied to a plain personal Gmail account — Internal requires a Workspace/Cloud Identity org). Caveat, quoted directly: **"All apps that integrate with Google APIs are required to comply with Google's API Services User Data Policy regardless of whether they have been verified."** — exemption from verification is not exemption from the data-use policy (A.13).

**(b) "Unverified app" warning screen:** displayed when an app "requests a sensitive or restricted OAuth scope, but hasn't gone through the Google verification process" — shown *before* the normal consent screen; while unverified, the app is capped at **100 new users**.

**(c) 7-day refresh-token expiration for Testing-status apps — CONFIRMED current:** direct quote: **"A Google Cloud Platform project with an OAuth consent screen configured for an external user type and a publishing status of 'Testing' is issued a refresh token expiring in 7 days."** Exception: doesn't apply if the app requests only `userinfo.email`, `userinfo.profile`, and `openid`. Moving publishing status to "In production" removes the 7-day cap (tokens then persist until revoked, unused for 6 months, or a 50-token-per-account cap is exceeded).

### A.13 Google API Services User Data Policy / Limited Use (AI restrictions)

**Status:** Two current official policy pages — general, and a sharper Workspace-specific one.
**Date:** General policy last updated 2024-02-15; Workspace-specific policy last updated 2026-07-22 UTC.
**URL:** general https://developers.google.com/terms/api-services-user-data-policy · Workspace-specific https://developers.google.com/workspace/workspace-api-user-data-developer-policy · announcement https://workspace.google.com/blog/ai-and-machine-learning/api-policy-protections

Directly matters for StateNour, which reads Gmail via API and feeds content to OpenRouter/OpenAI/Anthropic/Gemini/Ollama Cloud.

- General policy's "Limited Use" section restricts: limiting data use to "providing or improving user-facing features that are prominent in the requesting application's user interface"; no human review without the user's affirmative agreement (narrow security/legal exceptions); no transfer/sale to third parties, ad platforms, or data brokers; no use for ad serving/retargeting; no use to determine creditworthiness.
- **Workspace-specific policy adds the operative AI/ML restriction, verbatim:** **"Transferring, selling, or using user data to create, train, or improve a machine learning or artificial intelligence model beyond that specific user's personalized model for the appropriate use case or user-facing feature."**
- Google's Feb-2024 announcement: **"Our 'Limitation on User Data Transfer' prohibits the use of Workspace user data to train non-personalized AI and/or ML models,"** and developers must commit via their privacy policies that they don't retain Workspace-API data to train non-personalized models.
- **Practical read for StateNour:** sending Gmail content to a third-party LLM purely for inference powering the user's own personalized feature is not itself banned — what's banned is that data being **retained or used by StateNour or the provider to train/improve a general-purpose model**. This makes each LLM provider's own data-retention/training policy on API-submitted content (not independently re-verified per-provider in this pass) the operative compliance variable — worth a dedicated follow-up check per provider.
- Applies regardless of verification status (see A.12(a) caveat).

### A.14 Telegram Bot API webhook secret_token

**Status:** Current Bot API, version 10.3.
**Date:** 2026-08-24 (most recent changelog entry).
**URL:** https://core.telegram.org/bots/api#setwebhook

Verbatim: **"A secret token to be sent in a header 'X-Telegram-Bot-Api-Secret-Token' in every webhook request, 1-256 characters... The header is useful to ensure that the request comes from a webhook set by you."** In practice: StateNour sets a random secret as `secret_token` on `setWebhook`; Telegram echoes it on every subsequent webhook POST's header; the handler compares it (constant-time) and rejects mismatches — the only thing standing between the public webhook endpoint and a spoofed POST, since Telegram does not sign the payload itself.

### A.15 Stripe webhook signature verification

**Status:** Current Stripe documentation (general current-best-practice reference; StateNour itself doesn't appear to directly integrate Stripe today).
**Date:** No explicit "last updated" shown; code samples reference API version 2026-08-26 (preview), indicating live content.
**URL:** https://docs.stripe.com/webhooks · https://docs.stripe.com/webhooks/signature

Each endpoint gets a unique `whsec_...` signing secret. Every request carries `Stripe-Signature: t=<timestamp>,v1=<signature>` — an HMAC-SHA256 over `"{timestamp}.{raw request body}"`. Verification must use the **raw, unmodified** request body. Because the timestamp is inside the signed payload, replay protection comes from Stripe's official libraries applying a **default 5-minute tolerance** (never set to 0). Stripe also recommends IP allowlisting as a second layer and periodic signing-secret rotation (old secret valid up to 24h during rotation).

### A.16 Web Push VAPID (RFC 8292) and Message Encryption (RFC 8291)

**Status:** Both **Proposed Standard** — current, no superseding RFC.
**Date:** Both published November 2017.
**URL:** RFC 8292 https://datatracker.ietf.org/doc/rfc8292/ · RFC 8291 https://datatracker.ietf.org/doc/html/rfc8291

- **VAPID key pair is ECDSA over P-256** (RFC 8292 §2) — generated once, reused as the `applicationServerKey` passed to `pushManager.subscribe()`.
- **Identification is a signed JWT**, sent as `Authorization: vapid t=<jwt>, k=<public key>`; the JWT MUST include `aud` (the push service's origin) and `exp`, and **`exp` MUST NOT be more than 24 hours out** — so VAPID JWTs need re-minting at least every 24h, not generated once and cached indefinitely.
- **Payload encryption is mandatory and scheme-locked**: RFC 8291 requires the `aes128gcm` content-coding from RFC 8188 — "An application server MUST NOT use other content encodings for push messages."
- **Both sides' key material is needed**: the browser's subscription supplies a P-256 ECDH public key (`p256dh`) and a 16-octet auth secret (`auth`); the app server generates a fresh ephemeral ECDH key pair per message, combined via ECDH+HKDF — the backend must persist `p256dh`/`auth` per device, not just the push endpoint URL.
- **Size cap:** push services aren't required to support more than 4096 octets of payload body, netting out to **at most 3993 octets of plaintext** — keep push payloads small (title/body/tag/URL) and have the client fetch full content after waking up.

---

## PART B — WEB PLATFORM AND iOS PWA CAPABILITIES

_(populated incrementally below as sub-research lands)_

---

## PART C — ACCESSIBILITY

### C.1 WCAG 2.2 status

**Status:** W3C Recommendation.
**Date:** Originally became a Recommendation 2023-10-05; **republished as a dated Recommendation 2024-12-12** (`REC-WCAG22-20241212`), which is the current "This version." Errata continue to accumulate against that Dec-2024 text (errata page itself last modified 2026-08-28).
**URL:** https://www.w3.org/TR/WCAG22/ · dated version https://www.w3.org/TR/2024/REC-WCAG22-20241212/ · errata https://www.w3.org/WAI/WCAG22/errata/

No substantive (non-editorial) requirement changes were found in the accumulated errata — corrections found were terminology/consistency fixes (e.g. "touch screen" -> "touchscreen").

### C.2 The 2.2-era success criteria — verified conformance levels

Each row verified individually against its own W3C "Understanding WCAG 2.2" page. **Several of these are commonly misremembered as AA when they are actually AAA or A — the table below gives the real, verified level.**

| Criterion | Level (verified) | Plain definition | Relevance to StateNour's dense mobile operator UI |
|---|---|---|---|
| 2.4.11 Focus Not Obscured (Minimum) | **AA** | A keyboard-focused component must not be *entirely* hidden by other content (sticky headers/footers, overlays). | Sticky bottom nav / floating input bars / overlay panels could fully cover a tabbed-to control mid-screen — this is the AA floor to hit. |
| 2.4.12 Focus Not Obscured (Enhanced) | **AAA** | Stricter: *no part* of the focused component may be hidden at all. | Worth targeting on primary control surfaces even though optional (AAA), given plausible external-keyboard use on iPad/iPhone. |
| 2.4.13 Focus Appearance | **AAA** | Visible focus indicator must be >=2px-thick perimeter with >=3:1 contrast against the unfocused state. | Dense dark-mode control grids often use thin/subtle focus rings that vanish against busy backgrounds. |
| 2.5.7 Dragging Movements | **AA** | Anything operated by a drag gesture must also work via a single pointer action without dragging (unless dragging is essential). | Mobile ops UIs love drag (reorder cards, sliders, swipe-to-dismiss/archive) — each needs a tap-based alternative. |
| 2.5.8 Target Size (Minimum) | **AA** | Pointer targets must be >=24x24 CSS px, with defined exceptions (spacing, inline, essential, equivalent, user-agent-controlled). | The single most directly relevant criterion — "dense" is exactly where designers shrink tap targets. This is the legal/conformance floor, well below Apple's/Material's own platform defaults (C.5, C.6). |
| 3.2.6 Consistent Help | **A** | A help/contact mechanism, if present, must appear in the same relative position across a set of pages, unless the user changes it. | Any help/support affordance across StateNour's many screens needs a predictable location for one-handed, on-the-go phone use. |
| 3.3.7 Redundant Entry | **A** | Information already entered/known in a process must not be required again (auto-populate or let the user select it), except where essential or security-related. | Multi-step admin/config flows shouldn't force re-entry of the same field across steps. |
| 3.3.8 Accessible Authentication (Minimum) | **AA** | No cognitive-function test (memorized password, puzzle) may be required to authenticate unless an alternative (paste/autofill, object recognition, personal-content mechanism) is also offered. | Directly touches the PWA's login/session-unlock flow — must permit password managers, paste, or biometric unlock rather than forcing manual recall. |

### C.3 WCAG 3.0 status

**Status:** W3C Working Draft — far from Recommendation; does **not** deprecate WCAG 2.2.
**Date:** 2026-03-03 (this version).
**URL:** https://www.w3.org/TR/wcag-3.0/ · dated version https://www.w3.org/TR/2026/WD-wcag-3.0-20260303/ · editor's draft https://w3c.github.io/wcag3/guidelines/

The document itself states it "may be updated, replaced, or obsoleted... at any time" with "several years of work" remaining. **For a September 2026 accessibility plan, WCAG 2.2 remains the applicable standard; WCAG 3.0 is directional only.**

### C.4 ARIA 1.3 status

**Status:** W3C Working Draft — not a Recommendation.
**Date:** 2026-06-04.
**URL:** https://www.w3.org/TR/wai-aria-1.3/ · dated version https://www.w3.org/TR/2026/WD-wai-aria-1.3-20260604/

**Current Recommendation is WAI-ARIA 1.2**, published 2023-06-06 (https://www.w3.org/TR/wai-aria-1.2/). Design against 1.2 semantics; ARIA 1.3 is not production-ready.

### C.5 Apple HIG — minimum tappable target size

**Status: NOT VERIFIED against primary-source page text.** developer.apple.com's HIG pages are client-side-rendered; WebFetch retrieved only page `<title>` text across multiple attempts on both the Layout and Buttons pages, and an archive.org fallback was blocked.
**URL attempted:** https://developer.apple.com/design/human-interface-guidelines/layout · https://developer.apple.com/design/human-interface-guidelines/buttons

What's well-corroborated by convergent secondary sources (not primary-verified): a minimum tappable target of **44x44pt**. Treat this figure as reliable by strong convergent secondary sourcing but not independently confirmed against the live HIG page's current wording.

### C.6 Material Design — minimum touch target size

**Status: NOT VERIFIED against primary-source page text** — same JS-rendering limitation (m3.material.io is client-rendered; WebFetch returned only page titles, and archive.org fallback was blocked).
**URL attempted:** https://m3.material.io/foundations/designing/structure · https://m3.material.io/foundations/accessible-design/overview

Well-corroborated by secondary sources (Google's own Android Accessibility Help Center, Material's component-library docs): a minimum touch target of **48x48dp**, auto-expanded even when the visible element is smaller.

**Why three different numbers exist (WCAG's 24x24 CSS px AA floor vs. Apple's 44pt vs. Material's 48dp) — reasoned from verified components:** WCAG SC 2.5.8 (verified AA, C.2 above) sets a **legal/conformance floor** applicable to arbitrary web content, including third-party embeds. Apple's 44pt and Google's 48dp are **platform design-system defaults** — recommendations for good default UX on native/hybrid surfaces, not conformance minimums. Notably, WCAG also has a stricter *optional* criterion, **2.5.5 Target Size (Enhanced)** — verified via primary source (https://www.w3.org/WAI/WCAG21/Understanding/target-size.html) as **WCAG 2.1, Level AAA, 44x44 CSS px** — which lines up numerically with Apple's 44pt. Three different bodies, three different unit systems, two different purposes (legal floor vs. platform default) — the gap is intentional. For StateNour's dense operator UI: meeting the 24x24 AA floor is necessary for conformance, but the density trade-off should be made consciously against the higher 44pt/48dp platform defaults, not treated as equivalent to them.

### C.7 Live region guidance for streaming/dynamically-updating text

No single dedicated "Live Regions" page currently exists in the APG at a stable URL — the expected `w3.org/WAI/ARIA/apg/practices/live-regions/` 404s, and the current APG Practices index (https://www.w3.org/WAI/ARIA/apg/practices/) doesn't list a live-regions-specific entry among its 7 items. The *mechanism* is standardized; guidance for the *specific streaming-LLM-text UX problem* is not yet formal W3C output.

**Primary source (mechanism):** WAI-ARIA 1.2 Rec, Live Region Roles (https://www.w3.org/TR/wai-aria-1.2/#live_region_roles) — a live region is a "perceivable region... typically updated as a result of an external event when user focus may be elsewhere," explicitly citing "a chat log, stock ticker, or a sport scoring section" as canonical examples. Defines `aria-live`, `aria-atomic`, `aria-relevant`, `aria-busy` — no explicit caution about update frequency in the spec text itself.

**Adjacent primary source:** the APG Alert pattern (https://www.w3.org/WAI/ARIA/apg/patterns/alert/) warns generally that "the frequency of interruption caused by alerts... inhibit[s] usability for people with visual and cognitive disabilities."

**Community/secondary guidance** (since the APG doesn't yet cover this case explicitly): MDN's "ARIA live regions" (updated 2026-03-10) — `aria-live="polite"` queues until the screen reader is idle, `aria-live="assertive"` interrupts and "should only be used sparingly." A secondary source directly on point (thefrontkit.com, "AI Chat UI Best Practices for 2026," 2026-02-15) recommends `aria-live="polite"` on the streaming container, `aria-atomic="false"`, and states plainly: **"Debounce announcements during fast streaming. Announcing every token is overwhelming; batching updates every few seconds provides a better experience."**

**Summary:** the mechanism (`aria-live`/`aria-atomic`) is W3C-standardized and stable; the "don't announce every token" problem for LLM streaming output is solved today only by community convention (debounce/batch every few seconds, use `polite` not `assertive`, keep `aria-atomic="false"` on the growing container), not by a formal W3C pattern.

### C.8 APG Dialog (Modal) Pattern

**Status:** Living document (no formal publication date; footer copyright reads 2026; the page's own text still references "ARIA 1.1" terminology in places — a minor staleness flag).
**URL:** https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/

- **Initial focus:** on open, focus moves to an element inside the dialog — generally the first focusable element, but context-dependent alternatives are listed: a static `tabindex="-1"` element (e.g. the title) for content-heavy dialogs so the first interactive element doesn't scroll the heading out of view; the least-destructive action for high-consequence dialogs (delete/financial); a frequently-used action (OK/Continue) for purely informational dialogs.
- **Focus trap:** Tab/Shift+Tab must not move focus outside the dialog — verbatim: "Tab: Moves focus to the next tabbable element inside the dialog. If focus is on the last tabbable element inside the dialog, moves focus to the first tabbable element inside the dialog" (mirrored for Shift+Tab).
- **Return focus on close:** "When a dialog closes, focus returns to the element that invoked the dialog," with a fallback if that element no longer exists.
- **Escape:** closes the dialog.

Maps directly onto StateNour's operator UI: any confirm/settings/detail modal on the dense mobile surface should trap focus, restore it to the triggering control on close, and support Escape — three testable, concrete requirements straight from this pattern.

---

## PART D — LAWFUL, HIGH-SIGNAL EXTERNAL DATA

*Researched directly (WebFetch) after this session's shared WebSearch budget (200 calls, pooled across this session and its background research agents) was exhausted mid-task — a handful of items below are marked NOT VERIFIED or NOT FULLY VERIFIED as a direct result and should be re-checked before being treated as final.*

### D.1 RFC 5545 (iCalendar) + RRULE, and RFC 7986

**Status:** RFC 5545 "Internet Calendaring and Scheduling Core Object Specification (iCalendar)" — Proposed Standard, published September 2009. RFC 7986 "New Properties for iCalendar" — Proposed Standard, published October 2016.
**URL:** https://datatracker.ietf.org/doc/html/rfc5545 · https://datatracker.ietf.org/doc/html/rfc7986 — accessed 2026-09-02.

- **Decision improved:** correct parsing/generation of recurring events (RRULE: FREQ/UNTIL/COUNT/INTERVAL/BYDAY etc.) when StateNour ingests or writes Google Calendar events; RFC 7986 properties (COLOR, REFRESH-INTERVAL, SOURCE, IMAGE, NAME) matter if StateNour ever publishes its own subscribable `.ics` feed.
- **Update frequency:** static — IETF standards-track RFCs don't change; errata only.
- **License/terms:** IETF RFCs are freely publishable/quotable under the IETF Trust's standard copyright terms — no fee, no registration.
- **Cost:** free. **Reliability/provenance:** the actual interop format Google Calendar/Apple Calendar/Outlook all speak. **Privacy:** none inherent to the syntax spec — the calendar *content* is where privacy lives.
- **Lawful for StateNour:** Yes, unconditionally — a syntax spec, not a data source with usage terms.

### D.2 IANA Time Zone Database (tzdata)

**Status:** Current release **2026c**, released **2026-07-08** (2026b preceded it, 2026-04-23).
**URL:** https://www.iana.org/time-zones · license: https://data.iana.org/time-zones/tzdb/LICENSE — accessed 2026-09-02.

- **License, quoted:** "Unless specified below, all files in the tz code and data (including this LICENSE file) are in the public domain," with a narrow BSD-3-clause carve-out for a few C source files (`date.c`, `newstrftime.3`, `strftime.c`) that a pure data consumer like StateNour wouldn't touch.
- **Update frequency:** irregular, triggered whenever a government changes DST rules or zone boundaries — two releases already by July 2026.
- **Decision improved:** every scheduling/reminder computation across the operator's timezone and any correspondent's timezone depends on this being current — stale tzdata silently mis-schedules events around DST boundaries.
- **Cost:** free. **Reliability/provenance:** the de facto global standard, bundled in every OS/runtime (glibc, ICU, Node, browsers). **Privacy:** none — pure reference data.
- **Lawful for StateNour:** Yes, unconditionally.

### D.3 Public holidays

**(a) Nager.Date** — free public REST endpoint (date.nager.at), no API key for basic use; underlying open-source project is **MIT-licensed** (confirmed via the repo's own LICENSE file: "The MIT License (MIT)," copyright nager.at since 2016); the hosted public API is "free for reasonable/fair-use volume," with a paid sponsorship tier issuing a license key for self-hosted/offline use of the library. URL: https://date.nager.at/api · https://github.com/nager/Nager.Date — accessed 2026-09-02.
- Decision improved: don't schedule/suggest tasks on public holidays; adjust "who's likely reachable today" logic. Update frequency: annual per country. Reliability: community-maintained, ~100-150 countries — **not government-authoritative**.
- **Lawful for StateNour:** Yes for fair-use-volume API consumption; self-hosting the underlying MIT-licensed library is unconditionally fine.

**(b) OpenHolidays API** — openholidaysapi.org, free, no auth/key required, ~35+ countries including school holidays; underlying data repo is **ODbL-1.0** licensed (Open Data Commons Open Database License, confirmed via the repo). URL: https://www.openholidaysapi.org/en/ · https://github.com/openpotato/openholidaysapi.data — accessed 2026-09-02.
- Decision improved: same as (a), plus school-holiday awareness. **Lawful for StateNour:** Yes — ODbL permits reuse, with attribution/share-alike-style obligations attaching to the *database itself* if StateNour ever redistributes raw data rather than just consuming query results.

**(c) Google's built-in holiday calendars** — public calendar IDs (e.g. `en.usa#holiday@group.v.calendar.google.com`) reachable via the standard Calendar API `events.list` call. URL pattern: `GET https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events` — accessed 2026-09-02.
- **NOT VERIFIED:** a holiday-calendar-specific licensing clause distinct from Google's general Calendar API Terms of Service — could not confirm within this session's remaining budget. Treat as governed by the same terms as the rest of StateNour's Calendar API access (already applicable since StateNour is a Calendar API consumer).
- Decision improved: same use case as (a)/(b), sourced from the same Google account StateNour already has OAuth access to, avoiding a third dependency. **Lawful for StateNour:** Yes, conditioned on standard Google API ToS compliance.

### D.4 Sunrise/sunset

**(a) NOAA solar position algorithm** — NOAA Global Monitoring Laboratory's Solar Calculator, based on Jean Meeus's *Astronomical Algorithms*, accurate to about a minute between +/-72 deg latitude. URL: https://gml.noaa.gov/grad/solcalc/calcdetails.html — accessed 2026-09-02.
- **Important caveat found directly on the source:** NOAA states this calculator "is no longer actively supported or maintained" and NOAA "cannot guarantee its accuracy or functionality" going forward — worth flagging since it's still the algorithm most third-party sunrise/sunset libraries reimplement.
- License: US government work, public domain. Cost: free (a formula, not a live service). **Lawful for StateNour:** Yes.

**(b) sunrise-sunset.org API** — free, no signup/API key; rate-limited via HTTP 429 + `Retry-After` (no numeric ceiling published); requires attribution with a link back to the site; official guidance to fetch a whole year via `date_start`/`date_end` and cache client-side, since a given date's sunrise/sunset time never changes. URL: https://sunrise-sunset.org/api — accessed 2026-09-02.
- Decision improved: exact local sunrise/sunset for the operator's location (Cleveland/Parma, OH) to drive "morning briefing"/evening-wind-down automations. Reliability: a single small free hosted service — a NOAA-algorithm-based self-hosted fallback is worth having for resilience.
- **Lawful for StateNour:** Yes, provided attribution is added and requests are cached per their own guidance rather than re-querying the same date repeatedly.

### D.5 Weather

**(a) api.weather.gov (NWS API)** — completely free: **"we do not charge any fees... intended to be open data, free to use for any purpose"**; ~2.5km-grid forecasts from NWS Weather Forecast Offices; **US + territories only**. Requires a descriptive `User-Agent` header identifying the app (contact info recommended, not required). Rate limit undisclosed but "generous"; back off ~5s and retry on 429. URL: https://www.weather.gov/documentation/services-web-api — accessed 2026-09-02.
- Decision improved: weather-aware scheduling/reminders for a Cleveland-area operator — squarely inside NWS coverage. **Lawful for StateNour:** Yes, unconditionally (explicitly public-domain, "free to use for any purpose").

**(b) Open-Meteo** — data licensed **CC BY 4.0** (redistribution, including commercial, permitted with attribution); the **free tier itself is capped at 10,000 calls/day and restricted to non-commercial use** (private sites, non-profits without ads/subscriptions, home automation, public research, education) — commercial or higher-volume use requires a paid subscription; no API key/signup needed for the free tier. URL: https://open-meteo.com/en/terms · https://open-meteo.com/en/license — accessed 2026-09-02.
- Decision improved: global coverage (vs. weather.gov's US-only) if StateNour ever needs non-US forecasts, or as a redundant second source. **Lawful for StateNour:** Yes, for a personal non-commercial single-operator tool under the free tier — would need the paid plan if StateNour were ever commercialized/sold.

### D.6 Travel time

**(a) Google Routes API** — most response content is subject to Google's caching restrictions under the Maps Service Terms; the Routes-specific policies page states this but **does not itself give a numeric caching-duration limit**, deferring to the full Maps Service Terms (https://cloud.google.com/maps-platform/terms/maps-service-terms) — **NOT FULLY VERIFIED**, the exact permitted duration was not pinned down within this session's tool budget. **Place IDs are the one explicit, permanent exception** — quoted: "The place ID... is exempt from the caching restrictions... you can therefore store place ID values indefinitely." Any route results shown on a map must be shown on an actual **Google Map**; non-Google-Map display requires attribution/the Google logo. URL: https://developers.google.com/maps/documentation/routes/policies — accessed 2026-09-02.
- Cost: paid, consumption-based (Google Maps Platform billing). Decision improved: "how long will it take to get there" for scheduling.
- **Lawful for StateNour:** Yes, IF it respects the no-long-term-caching rule (re-query rather than persist computed travel times beyond whatever the full Maps Service Terms permit — **needs the exact number confirmed before StateNour designs a cache layer around it**) and, if ever displaying a map, uses Google's own map component.

**(b) OpenRouteService** — built on OpenStreetMap data under **ODbL**; the API's own response data is offered under **CC-BY 4.0**; free public instance with "fair usage" limits (exact numeric caps **NOT FULLY VERIFIED** within this session's budget); repeated overages trigger temporary blocks. URL: https://openrouteservice.org/terms-of-service/ · https://openrouteservice.org/restrictions/ — accessed 2026-09-02.
- Decision improved: a fallback to Google Routes without the same anti-caching restriction (CC-BY only requires attribution, not a caching prohibition). **Lawful for StateNour:** Yes, with attribution.

### D.7 Google People API — contact scopes

**Status:** Confirmed scope list, from the People API's own REST reference "Authorization scopes" section for `people.get`. URL: https://developers.google.com/people/api/rest/v1/people/get — accessed 2026-09-02.

Scopes found: `contacts` · `contacts.readonly` · `contacts.other.readonly` · `directory.readonly` · `profile.agerange.read` · `profile.emails.read` · `profile.language.read` · `user.addresses.read` · `user.birthday.read` · `user.emails.read` · `user.gender.read` · `user.organization.read` · `user.phonenumbers.read` · `userinfo.email` · `userinfo.profile`.

- **NOT VERIFIED:** which of these Google's separate OAuth scope-sensitivity classification (the tiering used to decide verification-review depth) labels "sensitive" vs. "restricted" — could not confirm within this session's tool/search budget. Treat `contacts` (read/write) as at least "sensitive" and default to the narrowest workable scope (`contacts.readonly`) rather than assuming.
- Decision improved: "who is this email from" / contact enrichment without needing full Gmail body access. **Lawful for StateNour:** Yes, subject to Google's standard OAuth verification requirements for whichever scope tier applies (see A.12).

### D.8 Gmail API metadata-only scope (gmail.metadata)

**Status:** Grants message metadata (labels, headers) only — **explicitly not the email body**. Classified by Google as a **restricted scope**, meaning apps requesting it must complete OAuth app verification and comply with the API Services User Data Policy. URL: https://developers.google.com/gmail/api/auth/scopes — accessed 2026-09-02.

- Decision improved: the privacy-minimizing option wherever a StateNour feature only needs "did an email arrive from X, what's the subject/thread structure" without ever reading body content — use this instead of full `gmail.readonly` wherever the feature allows it.
- **Lawful for StateNour:** Yes, subject to the same verification/User Data Policy requirements as any restricted Gmail scope (A.12, A.13).

### D.9 Google Calendar API free/busy

**Status:** `freebusy.query` returns **only busy time ranges** (start/end) — never event titles, descriptions, or attendees. Multiple scope options work (`calendar.readonly`, `calendar`, `calendar.events.freebusy`, `calendar.freebusy`); authorization is even optional for some queries. URL: https://developers.google.com/calendar/api/v3/reference/freebusy/query — accessed 2026-09-02.

- Decision improved: privacy-preserving scheduling — e.g. "is the operator free at 3pm" for an automation, without pulling full event detail into an LLM prompt. **Lawful for StateNour:** Yes.

### D.10 Apple Health data export

- **Mechanism:** the iOS Health app has a long-standing user-initiated "Export All Health Data" feature (via the profile icon), producing a ZIP containing an XML export the user can share/save anywhere, including uploading it themselves into StateNour. **NOT VERIFIED against a primary Apple source in this session** — this session's WebSearch budget was exhausted mid-research and a DuckDuckGo fallback search hit a CAPTCHA that was correctly left unsolved (see D.18) rather than an exact current support.apple.com URL being pinned down. This is a widely and consistently documented, stable Health-app feature, but cite it here as **NOT VERIFIED** pending a direct primary-source check.
- **Legal posture if the mechanism is as described:** this is the user exporting and re-uploading their **own** data — categorically different from an app pulling Health data live via HealthKit. **Lawful for StateNour:** Yes for the export-and-self-upload path (ordinary personal-data handling by its own owner) — *pending the primary-source re-check above*.
- **HealthKit / live-integration path** (relevant only if StateNour ever became a native iOS app rather than a PWA): Apple's App Store Review Guidelines, Guideline 5.1.3, **verified via primary source**, explicitly forbid using HealthKit-sourced (or Clinical Health Records API, Motion & Fitness, MovementDisorder API) data for advertising, marketing, or use-based data mining; forbid storing personal health information in iCloud; and only allow using a user's health data to provide *that user* a direct benefit without sharing it with a third party. URL: https://developer.apple.com/app-store/review/guidelines/ (Guideline 5.1.3) — accessed 2026-09-02.
- **Flag for counsel (not answered here):** if StateNour ever sends operator health data — even self-exported — onward to a third-party LLM provider (OpenRouter/OpenAI/Anthropic/Gemini/Ollama Cloud) for processing, that is a distinct question from "is exporting your own data legal," and should go to a lawyer rather than be inferred from Apple's third-party-app rules (which bind Apple-platform apps, not what happens to data after the user exports it themselves).

### D.11 Open government data (Cleveland/Parma, OH area)

Cuyahoga County Open Data (data-cuyahoga.opendata.arcgis.com) and the City of Cleveland's GIS & Data pages under Community Development (clevelandohio.gov) both exist as ArcGIS-Open-Data-style portals — accessed 2026-09-02.

- **Plausible personal-OS use is thin** beyond what's already covered by weather/holidays: parcel/property-tax lookups if StateNour ever tracks the shop's own real estate, or permit/inspection-status lookups for the Euclid Ave shop location, would be the most concrete uses. **NOT VERIFIED** whether either portal actually exposes those specific datasets — not checked in depth given no current StateNour feature clearly needs it.
- **Lawful for StateNour:** Yes in principle (public open-data portals), but no strong case exists today to build against these.

### D.12 GitHub REST + GraphQL APIs (operator's own repositories)

- Auth: personal access token, OAuth App, or GitHub App. Rate limit: **5,000 requests/hour** for authenticated PAT/OAuth-App/GitHub-App requests (15,000/hour variants apply only to GitHub-Enterprise-Cloud-owned apps — not relevant to a personal account). URL: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api — accessed 2026-09-02.
- Terms: GitHub's Terms of Service **Section H, "API Terms"** — abuse/excessive-frequency risks suspension; may not share tokens to pool around rate limits; may not use the API to scrape and resell GitHub users' personal information (irrelevant to reading your own repos); GitHub reserves paid high-throughput tiers for resale-scale use. URL: https://docs.github.com/en/site-policy/github-terms/github-terms-of-service — accessed 2026-09-02.
- Decision improved: StateNour reading NOURCITY's own commit/PR/issue history for status reporting, changelogs, or "what shipped this week" summaries. **Lawful for StateNour:** Yes, unconditionally, for reading the operator's own repos with their own token.

### D.13 Wikipedia + Wikidata APIs

- **Wikipedia article text:** dual-licensed **CC BY-SA 4.0 + GFDL** (unversioned, no invariant sections) — reusers may comply with either. URL: https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use — accessed 2026-09-02.
- **Wikidata structured data** (main/property/lexeme namespaces): **CC0** — public domain, no attribution required; Wikidata's own text content in other namespaces is CC BY-SA 4.0 like Wikipedia. URL: https://www.wikidata.org/wiki/Wikidata:Licensing — accessed 2026-09-02.
- Both require a descriptive `User-Agent` identifying the calling application (Wikimedia API Etiquette/Robot Policy) and forbid "abusive or disruptive" automated use without prior community approval.
- Decision improved: general-knowledge grounding for StateNour's assistant without hallucinating; Wikidata is useful for structured entity data (dates, relationships), CC0-clean for redistribution/derivation. **Lawful for StateNour:** Yes, with a proper User-Agent and reasonable request pacing.

### D.14 arXiv API

**Status:** Rate limit: **max 1 request per 3 seconds, single connection at a time**, enforced in aggregate across all of a user's machines (spreading load to dodge the limit is explicitly prohibited). Metadata (titles/abstracts/authors/identifiers/classifications) is **CC0** — public domain; the underlying e-print PDFs/source remain under whatever license the author chose and may **not** be redistributed/stored in bulk without permission. URL: https://info.arxiv.org/help/api/tou.html — accessed 2026-09-02.

- Decision improved: research-paper ingestion for a "what's new in my field" digest, safely limited to metadata rather than full-text redistribution. **Lawful for StateNour:** Yes for metadata use at the stated pacing; bulk storage/redistribution of full papers is a separate, not-covered case.

### D.15 Semantic Scholar API

**Status:** Free API key requested via a form, delivered by email. Unauthenticated access shares a pooled rate limit that is throttled under load; authenticated access has an introductory baseline around **1 request/second per key**, with higher throughput available once Semantic Scholar approves a specific use case. URL: https://www.semanticscholar.org/product/api — accessed 2026-09-02.
- **NOT FULLY VERIFIED:** the exact unauthenticated-tier numeric ceiling — sources found before this session's search budget ran out gave inconsistent figures (one reference to a shared 1000 req/s pool, another to "100 requests per 5 minutes") that could not be reconciled against a single authoritative page in this pass. **Design StateNour's integration around the conservative ~1 req/s figure regardless of key status**, and request a free key rather than relying on the unauthenticated pool for any recurring job.
- Decision improved: same research-digest use case as arXiv, with richer citation-graph metadata (why a paper matters, who cites it). **Lawful for StateNour:** Yes.

### D.16 OpenAlex API

**Status: NOT VERIFIED in this session.** Could not reach a primary OpenAlex page with specific rate-limit numbers or an explicit license statement before this session's WebSearch budget was exhausted; several direct WebFetch attempts either 404'd (docs.openalex.org's old paths, which now blanket-redirect to the help-center homepage) or were blocked (openalex.org's own root domain returned HTTP 403 to the fetch tool).
- **Do not cite a rate limit or license for OpenAlex from this report without re-verifying directly against https://help.openalex.org (or its current API section) first.** OpenAlex is widely reported in secondary sources as CC0-licensed with no API key required and a "polite pool" (higher limits via a `mailto` parameter) — none of that is confirmed against a primary source in this session, so no lawfulness call is made for it here.

### D.17 RSS/Atom (read-it-later ingestion)

- **RSS 2.0:** current/frozen at **version 2.0.11**, published **2009-03-30**, per the RSS Advisory Board, which states the spec "is, for all practical purposes, frozen" and future changes would only clarify, not extend, it. Spec text itself is **CC BY-SA 1.0** (a derivative of Dave Winer's original document via the Berkman Klein Center). URL: https://www.rssboard.org/rss-specification — accessed 2026-09-02.
- **Atom:** RFC 4287, IETF Standards Track (Proposed Standard), published **December 2005**, still current. URL: https://datatracker.ietf.org/doc/html/rfc4287 — accessed 2026-09-02.
- Decision improved: parsing any blog/news feed the operator wants piped into a read-it-later queue — both formats are stable enough that a parser written today won't need format-level maintenance. **Lawful for StateNour:** Yes for the format specs themselves; the *feed content's* own copyright/republication terms are a separate, per-publisher question — most feeds are published to be read by aggregators, but StateNour should respect any feed-specific "excerpt only" convention rather than mirroring full article text.

### D.18 Rejected / out of scope

Explicitly **out** for StateNour, regardless of how useful the data might be:
- Scraping any site whose `robots.txt` or Terms of Service forbid automated access, even for personal use.
- Accessing another person's private data (email, calendar, contacts, health records) without that person's own authorization — including not extending Gmail/Calendar/Contacts ingestion to anyone but the authenticated operator.
- Bypassing paywalls, CAPTCHAs, or login walls to reach content StateNour isn't independently authorized to see. (This constraint bit this very research session: a DuckDuckGo search hit a CAPTCHA and was correctly left unsolved rather than worked around — see D.10.)
- Using any API in a way its terms forbid even if technically possible — e.g. long-term caching of Google Routes API content beyond what its terms allow, or bulk-redistributing arXiv PDFs.

**Legal questions from this data-source set that belong to counsel, not to an AI agent's inference:**
1. Does routing Gmail content (even metadata-scope only) through third-party LLM providers (OpenRouter, Ollama Cloud, OpenAI, Anthropic, Gemini) comply with Google's API Services User Data Policy's human-review and "Limited Use"/AI-training restrictions (A.13)? The policy citation is verified; the compliance *analysis* for StateNour's specific data flow across five providers is a legal judgment call, not one this report makes.
2. If Apple Health data (self-exported by the operator) is ever processed by a third-party LLM provider, does that create HIPAA-adjacent or state-health-privacy-law exposure, even though Apple's own platform rules (5.1.3) technically bind only Apple-platform apps, not what happens to data after a user exports it themselves?
3. What exact caching/retention window does the full Google Maps Platform Service Terms allow for Routes API content (the Routes-specific policy page defers to it without stating a number) — needed before StateNour persists any travel-time result beyond a single request/response cycle.
4. Does the Telegram bot's handling of message content and user IDs trigger any data-retention, consent, or disclosure obligation under an applicable privacy law, given StateNour is a personal tool but people other than the operator may message the bot?

---

## SOURCES (consolidated)

_(consolidated at the end from each part's citations)_

---

## SUMMARY (<=600 words)

_(written last, after all four parts are compiled)_

---

## NOT VERIFIED (consolidated)

_(consolidated at the end)_
