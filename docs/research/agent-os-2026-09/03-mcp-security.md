# Track 3 — MCP / Tool Fabric + Agent Security (researched 2026-09-03)

Confidence key: ◆ primary source verified · ◇ secondary/vendor claim · ⚠ disputed or marketing framing

## A1. MCP spec state — revision `2026-07-28` ◆

Lineage: `2024-11-05` → `2025-03-26` → `2025-06-18` → `2025-11-25` → **`2026-07-28`**.
**This is the largest breaking revision in MCP's history.** Any MCP client/server code targeting
`2025-*` has a 12-month clock on it.

### MCP is stateless now
| Removed / changed | Detail | SEP |
|---|---|---|
| `initialize` / `notifications/initialized` handshake | **Gone.** Every request carries `_meta["io.modelcontextprotocol/protocolVersion"]` + `clientCapabilities` + `clientInfo` | SEP-2575 |
| `Mcp-Session-Id` + protocol sessions | **Gone.** `tools/list` etc. MUST NOT vary per-connection. Cross-call state = **server-minted opaque handles passed as ordinary tool args** | SEP-2567 |
| SSE resumability (`Last-Event-ID`) | **Gone.** Broken stream = lost request; client MUST re-issue with a **new request ID** | SEP-2575 |
| HTTP GET + `resources/subscribe` | Replaced by **`subscriptions/listen`** (one long-lived POST-response stream, opt-in per notification type) | SEP-2575 |
| `ping`, `logging/setLevel`, `notifications/roots/list_changed` | **Removed.** Log level per-request via `_meta[...logLevel]` | SEP-2575 |
| **NEW** `server/discover` | Servers **MUST** implement. Advertises protocol versions, capabilities, identity | SEP-2575 |

**Transports:** stdio + Streamable HTTP only. HTTP+SSE now formally **Deprecated** (SEP-2596).
New required headers `Mcp-Method`, `Mcp-Name`; `x-mcp-header` in `inputSchema` mirrors a primitive
param into `Mcp-Param-{Name}` for LB/WAF routing (SEP-2243). ⚠ Spec explicitly warns: **do not mark
secrets with `x-mcp-header`** — intermediaries see it.

### Authorization
| Item | Status |
|---|---|
| OAuth 2.1 + RFC 8707 resource indicators + RFC 9728 | base (since 2025-06-18) |
| **Dynamic Client Registration (RFC 7591)** | **DEPRECATED** → Client ID Metadata Documents (PR #2858) ◆ |
| RFC 9207 `iss` | AS SHOULD return; clients **MUST** validate against recorded issuer (SEP-2468) |
| Credential binding | Clients **MUST** key creds by issuer, **MUST NOT** reuse across AS, **MUST** re-register on AS change (SEP-2352) — direct confused-deputy hardening |

### Sampling / Roots / Logging — all DEPRECATED (SEP-2577) ◆
Migrations: pass dirs/files as tool params or resource URIs (not Roots); call your LLM provider
directly (not Sampling); stderr or OTel (not Logging). 12-month minimum deprecation window.

All server→client requests now use **Multi Round-Trip Requests (MRTR)** (SEP-2322): server returns
`{"resultType":"input_required","inputRequests":{...},"requestState":"<opaque>"}`; client retries the
original request with a **new JSON-RPC id** carrying `inputResponses` + `requestState`. Replaces
`roots/list`, `sampling/createMessage`, `elicitation/create`.
All results carry required `resultType` (`"complete"` | `"input_required"`).

### Tools — annotations & structured output ◆ (verified against `schema/2026-07-28/schema.json`)
`ToolAnnotations` still carries `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`,
`title`. ⚠ **Spec: clients MUST consider tool annotations untrusted unless from trusted servers.
Annotations are a UX hint, NEVER an authorization primitive.**

`outputSchema`/`structuredContent` loosened to any JSON Schema 2020-12 keyword and any JSON value
(SEP-2106). Servers MUST conform to their own `outputSchema`; clients SHOULD validate.

**Two error channels — this matters directly for the bdnick regex-gate bug:**
- JSON-RPC `error` (unknown tool `-32602`, malformed) — **model unlikely to recover**
- `result.isError: true` with actionable text — **model CAN self-correct**; clients SHOULD feed to model

### Other 2026 additions
Cacheable lists (`ttlMs` + `cacheScope` **required** on `tools/list` etc., SEP-2549) · deterministic
tool ordering SHOULD (enables prompt-cache hits) · **OTel `traceparent`/`tracestate`/`baggage` in
`_meta`** (SEP-414) · extensions framework `{vendor}/{name}`, always opt-in (SEP-2133) · Tasks moved
OUT of core to `io.modelcontextprotocol/tasks` (SEP-2663) · MCP Apps `io.modelcontextprotocol/ui`
(ext-apps v1.7.5, 2026-07-23, 2.8k stars) · error codes `-32020..-32099` reserved for spec ·
formal feature-lifecycle policy w/ 12-month deprecation window.

## A2. Gateways / registries

**Official MCP Registry — still PREVIEW** ◆ (repo 7,217 stars, v1.8.1 2026-08-06, license NOASSERTION).
Metadata only, not a package host. Namespace auth via reverse-DNS + GitHub/DNS/HTTP challenge is its
**only real security control**. **Explicitly delegates security scanning downstream.** Not designed
for self-hosting. **Verdict: WATCH — use as a discovery index, never a trust boundary. Never auto-install.**

| Project | License | Latest | Verdict |
|---|---|---|---|
| IBM/mcp-context-forge | Apache-2.0 | v1.0.9 · 2026-09-01; 4,414 stars, **839 open issues** | **AUGMENT** — most feature-complete OSS gateway (MCP + A2A + REST/gRPC); single-vendor, heavy backlog; run pinned |
| docker/mcp-gateway + Catalog | MIT | ships in Docker Desktop; 1,553 stars | **KEEP local dev only** — real value = containerized MCP servers w/ restricted privileges + network by default |
| obot-platform/obot | MIT | v0.25.4 · 2026-09-01 | **WATCH/AUGMENT** — k8s-native; ⚠ their own gateway comparison blog is vendor marketing |
| microsoft/mcp-gateway | MIT | pushed 2026-08-25; 811 stars | **WATCH** — stateful-session premise partly obsoleted by SEP-2567 |
| stacklok/toolhive | Apache-2.0 | v0.46.0 · 2026-08-27; 2,068 stars | **KEEP** — strongest sandboxing-first posture; best OSS fit if hosting third-party MCP servers |
| pomerium/pomerium | Apache-2.0 | v0.33.1 · 2026-08-18; 4,988 stars | **KEEP** as identity-aware proxy **in front of** a gateway; mature pre-MCP codebase |
| lasso-security/mcp-gateway | MIT | v1.2.0 · **2026-01-21**, last push 2026-01-22 (~7.5mo stale) | **DO NOT USE** — abandoned relative to the spec break |
| ArcadeAI/arcade-mcp | MIT | pushed 2026-09-02 | **AUGMENT** — useful pattern reference for per-end-user tool OAuth |
| MintMCP / TrueFoundry / Lunar / Composio | proprietary | — | **DO NOT USE** for single-tenant — adds a vendor to your trust boundary for ~300 lines of controls |

> **For bdnick specifically: you do not have an MCP fan-out problem — you have 181 in-process tools
> behind a broken gate. A gateway solves the wrong layer.** Steal the control-plane model
> (registry table → policy decision → audit row) and implement it in Next.js/Prisma.

## A3. Tool reliability — the scaling pattern

**Deferred tool definitions + tool search is now the mainstream answer**, and it is protocol-visible.
Anthropic's Tool Search Tool / on-demand MCP loading: ◇ ~85% tool-token reduction; Claude Code 2.1.x
defers all MCP tool definitions behind `ENABLE_TOOL_SEARCH`; servers pin hot tools with
`_meta['anthropic/alwaysLoad']`. ◇ Anthropic evals report **49% → 74% accuracy on Opus 4** with tool
search vs flat loading.

⚠ **This is the correct replacement for a hard `NICK_TOOL_BUDGET` cap. A budget silently truncates;
retrieval degrades gracefully and is measurable (recall@k).** Spec now supports the caching half
natively (deterministic ordering + `ttlMs`/`cacheScope`). Competing OSS: Stacklok MCP Optimizer.

| Concern | Implementation | License | Latest (verified) | Verdict |
|---|---|---|---|---|
| Schema validation | zod | MIT | **4.5.4 · 2026-08-29** | KEEP — validate both directions |
| JSON Schema 2020-12 | ajv | MIT | 8.20.0 · 2026-04-24 | KEEP — MCP schemas are JSON Schema, not Zod; cadence slowing |
| Retries/backoff | p-retry | MIT | 8.0.1 · 2026-09-01 | KEEP |
| Breaker+timeout+bulkhead | cockatiel | MIT | **npm 4.0.0 · 2026-05-26** (GH Releases stale at v2.0.0 — npm is the real channel) | KEEP — single-maintainer; MIT + small surface makes vendoring viable |
| Breaker (alt) | opossum | Apache-2.0 | v10.0.0 · 2026-06-24 | AUGMENT — Red Hat-backed, better diversity, weaker composition |
| Contract tests | pact-js | NOASSERTION | v17.1.3 · 2026-08-26 | AUGMENT — value is contracts vs upstream APIs, not MCP |
| Tool probe | modelcontextprotocol/inspector | ⚠ **no license detected** | 2.5.0 · 2026-09-02 | **AUGMENT, dev-only** — was CVE-2025-49596 (CVSS 9.4 RCE). Never expose. |
| Tracing | OTel GenAI semconv | Apache-2.0 | ⚠ **all `gen_ai.*` still "Development", none Stable** | AUGMENT — instrument now, expect churn |
| Tool flags | OpenFeature js-sdk | Apache-2.0 | server-sdk v1.23.0 · 2026-07-28 | AUGMENT — makes "tool X disabled" an auditable flag eval, not a regex accident |

**OTel span tree:** `invoke_agent` → `chat` → `execute_tool`. As of **v1.42.0 the MCP conventions
moved into the GenAI semconv repo**. Pair with SEP-414 `_meta` traceparent so traces survive the MCP hop.

**Spec's normative floor** ◆ — Servers MUST: validate inputs · implement access controls · **rate
limit tool invocations** · sanitize outputs. Clients SHOULD: confirm sensitive ops with a human ·
show tool inputs before calling · validate results before passing to the LLM · **implement timeouts**
· **log tool usage for audit**.

**Idempotency:** `idempotentHint` is untrusted metadata only. Real idempotency is yours —
Stripe-style key derived from `(conversation_id, turn_id, tool_name, canonical_args_hash)`, unique
index in Postgres storing the prior response. (bdnick already had a `task_events` 17ms double-write —
same class, same fix.)

## A4. Adjacent standards — adoption vs hype
| Standard | Real signal | Honest read |
|---|---|---|
| **MCP** | 9.1k stars spec repo; TS SDK 1.30.0 · 2026-07-27 | **Won the tool layer**, but 2026-07-28 broke it hard; long bimodal period ahead |
| **AGENTS.md** | ◇ 60,000+ repos by mid-2026; read by Claude Code, Codex, Cursor, Aider, Copilot, Gemini CLI | **Real, low-risk, near-zero cost. Adopt.** |
| **Agent Skills (SKILL.md)** | ◇ 40+ clients; ◇ **~490,000 skills** across SkillsMP/Skills.sh/ClawHub (2026-03) | **Real adoption, genuine governance gap** — half a million unsigned markdown+script bundles with no provenance layer. Snyk's agent-scan now scans skills, not just MCP servers. |
| **A2A** | LF project, **150+ member orgs**, production use | **Genuinely graduated** — but solves *inter-agent* coordination. **Irrelevant to a single-user agent. Skip.** |
| AP2 (payments) | ◇ 60+ orgs | Watch only |
| MCP Apps (`io.mcp/ui`) | ext-apps 2,788 stars, v1.7.5 | **The UI one to watch** — inside MCP governance. AG-UI/A2UI still shakeout. ⚠ most "six protocols" listicles are content marketing |
| **Tool-manifest signing** | **No standard exists** | **Biggest structural gap in the ecosystem — exactly why rug pulls work.** Closest: sigstore/cosign (v3.1.3 · 2026-08-06), in-toto/attestation (v1.2.0 · 2026-03-18). Build hash-pinning yourself. |

## B. Threat landscape — documented incidents

| Date | Incident | ID / severity | What happened |
|---|---|---|---|
| 2025-04-01 | **Tool Poisoning** first PoC (Invariant Labs) | — | Malicious instructions in **tool descriptions** — visible to LLM, not user. Exfiltrated repo contents + message history, **no user interaction** |
| 2025-06-13 | **MCP Inspector RCE** | **CVE-2025-49596, CVSS 9.4** | Localhost UI, no auth by default; DNS-rebinding reaches it from a browser. Fixed v0.14.1 |
| 2025-06 | Claude Code extension WS auth bypass | **CVE-2025-52882** | Any website could connect to the IDE extension's WS server |
| 2025-07-09 | **mcp-remote OS command injection → full client RCE** | **CVE-2025-6514, CVSS 9.6** | Crafted `authorization_endpoint` in untrusted server's OAuth metadata injects OS commands. v0.0.5–0.1.15 affected, fixed 0.1.16; 437k+ downloads. **First full client-OS RCE from merely connecting to a remote MCP server** |
| 2025-07 | Filesystem MCP directory-containment bypass | **CVE-2025-53110**, 7.3 | Allowed-dir *prefix* matching let `/allowed` also match `/allowed-evil`. Fixed 0.6.3 |
| 2025-08 | **"MCPoison" — Cursor trust bound to name, not command** | **CVE-2025-54136**, 7.2 | Approve benign config entry; attacker edits *that same entry* later — **approval persists**. Canonical rug-pull-by-config |
| 2025-09 | **`postmark-mcp` npm backdoor** | Koi Security | 15 clean releases, then **v1.0.16 added one line** BCC'ing every agent-sent email to the attacker |
| 2026-03 | Microsoft patches flaw in **its own** MCP servers | ◇ Patch Tuesday | Manipulation of assistant↔service interaction |
| **2026-04-15** | **OX Security "Mother of All AI Supply Chains"** ⚠ | **14 CVEs**, incl. **CVE-2026-30623** | Claim: **stdio interface in official Python/TS/Java/Rust SDKs executes OS commands from config params without validation** → RCE. ◇ ~150M downloads, ~200k exposed instances, 7,000+ public servers. ⚠ **Anthropic classified the behavior as expected and declined a protocol change.** **My read: this is "config is code" restated — a real deployment hazard and a weak CVE.** Mitigation is yours either way: never let untrusted input reach `command`/`args` |
| 2026-05 | **TanStack npm supply-chain worm** | UltraViolet TIDE | "TeamPCP" compromised **42 npm packages** via chained GH Actions exploits, **bypassed SLSA provenance verification**, spread to **172 packages in 5 hours** |
| 2026-06 | Microsoft warns poisoned MCP tool descriptions leak data | THN | Tool poisoning confirmed by a major vendor 14 months after PoC — **the class is unfixed at protocol level** |
| 2026 | **SmartLoader fake-ecosystem campaign** ◇ | — | 3 months building **5 fake GitHub accounts w/ AI-generated personas**, cross-forked for fake community activity, then submitted a trojanized Oura Ring MCP server to a legit marketplace. **Defeats "check the stars/activity" heuristics** |
| 2026 | MCP-38 threat taxonomy | arXiv 2603.18063, MCPXKIT 2508.12538 | 38-class taxonomy; useful as a threat-model checklist |

### Attack classes vs 2026-07-28 fixes
| Class | Fixed? |
|---|---|
| Tool poisoning | ❌ Only a MUST-treat-as-untrusted warning |
| **Rug pull** | ❌ No content-addressing, no integrity check, clients don't alert on definition change. Build hash-pinning yourself |
| Line jumping / cross-server shadowing | ⚠ Partial — name prefixing is collision handling, not defense |
| **Confused deputy (OAuth)** | ✅ **Materially improved** — SEP-2352, SEP-2468, CIMD replacing DCR |
| Prompt-injection → exfiltration | ❌ Architectural only |
| SSRF via agent browsing | ❌ Egress allowlist is yours to build |
| Secret leakage via tool output | ⚠ MUST sanitize; enforcement is yours |

### Defenses — OSS
| Defense | Implementation | License | Latest | Verdict |
|---|---|---|---|---|
| **MCP/skill scanning + rug-pull detection** | **snyk/agent-scan** (*formerly invariantlabs mcp-scan; Invariant acquired by Snyk*) | Apache-2.0 | **v0.6.1 · 2026-08-31**; 3,002 stars | **KEEP (pinned)** — definition-hash diffing is the thing you cannot easily rebuild. ⚠ now single commercial vendor; keep an offline copy |
| **Policy engine** | open-policy-agent/opa | Apache-2.0 | **v1.20.1 · 2026-08-28** | **KEEP** — CNCF graduated, multi-vendor. Rego is the cost |
| Policy (alt) | cedar-policy/cedar | Apache-2.0 | v4.12.0 · 2026-07-28 | AUGMENT — better ergonomics + formal verification; AWS-led |
| **OS sandbox (fs + net, no container)** | anthropics/sandbox-runtime | Apache-2.0 | **v0.0.75 · 2026-09-01**; 5,131 stars | AUGMENT — pre-1.0 but cheapest real **egress allowlist + fs jail** for tool subprocesses |
| Container sandbox | stacklok/toolhive, docker/mcp-gateway | Apache-2.0 / MIT | v0.46.0 | KEEP for third-party servers |
| Injection classifiers | NVIDIA-NeMo/Guardrails | NOASSERTION (Apache-2.0) | v0.24.0 · 2026-08-26 | AUGMENT — use only injection rails, not the dialog engine |
| Injection (alt) | protectai/llm-guard | MIT | ⛔ **ARCHIVED** 2026-07-08 | **DO NOT USE** — still recommended in 2026 blog posts; it is archived |
| Signed manifests | sigstore/cosign + in-toto | Apache-2.0 | v3.1.3 / v1.2.0 | AUGMENT — ⚠ the TanStack worm **bypassed SLSA verification**; signing proves *who built it*, not *that it's safe* |
| **Architectural injection resistance** | **arXiv 2506.08837 — Design Patterns for Securing LLM Agents against Prompt Injections** | paper | v2 | **KEEP — read before writing any gate code.** Six patterns w/ provable properties: **Action-Selector** (model picks from fixed allowlist, never composes), **Plan-Then-Execute**, **Dual LLM** (privileged LLM never touches untrusted data; quarantined LLM touches data but has no tools), Code-Then-Execute, Context-Minimization, Map-Reduce. Newer: arXiv 2606.26479 shows many published defenses fail under adaptive attack |

## Applying this to bdnick — ordered by value

1. **Make "tool not available" a value, not an absence.** Replace the boolean regex gate with a
   resolver returning a discriminated union:
   `{ALLOWED} | {DENIED, reason, policy_id} | {NOT_FOUND, nearest_matches[]} | {BUDGETED_OUT, rank, score}`.
   Persist every decision as a `tool_gate_decision` row. **A gate that cannot produce a denial row
   is a gate that fails silently.**
2. **Kill the hard per-turn budget; adopt retrieval.** 24-of-181 truncates without telling anyone.
   Move to tool-search + `alwaysLoad` pin list, log **recall@k** so under-retrieval is a metric.
3. **Never let the model announce capability state from the prompt.** The prompt must never contain
   "you do not have tool X". Emit `isError: true` with actionable text at *call* time — spec is
   explicit that clients SHOULD feed those to the model, and that `-32602` unknown-tool errors are
   the ones models can't recover from.
4. **Canary tools + health probes.** 3–5 synthetic tools that MUST resolve through the gate every
   deploy (mirror the existing knip plant-canary). Nightly `dryRun` probe → `tool_health` row.
   **181 tools with no probe means you cannot distinguish "unused" from "broken".**
5. **Zod-validate both directions**; log validation failures as first-class `tool_error` rows.
6. **Idempotency + timeout + breaker per tool**; breaker state on the `/brain` page.
7. **Instrument `execute_tool` spans (OTel GenAI semconv).** Langfuse + Sentry are already live —
   the gap is that tool *non-invocation* is unobservable.
8. **Security floor, cheapest first:** (a) **egress allowlist for any URL-fetching tool — this is
   your SSRF control and you have none**; (b) secret redaction before tool output enters model
   context *or logs*; (c) approval gate on your own server-side destructive classification, never on
   `destructiveHint`; (d) if third-party MCP servers ever enter: pin definition hash, diff on load,
   run snyk/agent-scan in CI.
9. **Don't buy a gateway.**
