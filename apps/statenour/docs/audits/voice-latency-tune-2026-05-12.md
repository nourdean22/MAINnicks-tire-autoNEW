# Voice latency tune · v10.0.524 · #5

**Target:** sub-500ms end-to-end speech-to-speech (currently estimated ~800ms based on `voice-agents` skill benchmarks).

**Current setup (per memory):**
- **VAPI** assistant "Nick" at +1 216 424 9249
- **LLM:** Gemini 2.5 Flash
- **Knowledge Base:** attached
- **3 tools:** scheduleDropoff / lookupCustomer / submitCallback

**Skill stance applied:** `voice-agents` (sub-800ms target, jitter < 100ms, semantic VAD for natural turn-taking) + ELON first-principles (delete what doesn't pay for itself).

---

## 5 latency layers to audit

### 1. Voice Activity Detection (VAD) · target ≤ 100ms

| Option | TTFB | Quality | Recommendation |
|---|---|---|---|
| **Silero VAD** (default in many VAPI setups) | ~150ms model-based | Good baseline | If currently using this · upgrade to next row |
| **OpenAI Semantic VAD** (in Realtime API) | 100-150ms but smarter | Best · understands "umm" vs end-of-turn | **Switch if VAPI exposes it** |
| **Pipecat SmartTurn** | similar to Semantic VAD | Best for natural pauses | If on Pipecat, default to this |

**Action:** In VAPI dashboard → Assistant → Transcriber settings, check if "Semantic VAD" or "SmartTurn" is available. If yes, switch from `silence_duration_ms: 500` to semantic-based detection. Expected win: **30-100ms** + far fewer interruption bugs.

### 2. Speech-to-Text (STT) · target ≤ 200ms TTFT

| Provider | TTFT | Notes |
|---|---|---|
| Whisper (OpenAI) | 500ms+ | **Slow · do not use for realtime** |
| **Deepgram Nova-3** | 150-184ms · 54% lower WER vs Whisper | **Recommended** |
| AssemblyAI | 200-250ms | Reasonable backup |

**Action:** Check VAPI's transcriber setting. If on Whisper/Whisper-v3, switch to **Deepgram Nova-3** (`deepgram` provider, `model: "nova-3"` or `nova-3-general`). Expected win: **~300ms**.

### 3. LLM time-to-first-token (TTFT) · target ≤ 300ms

Current model: **Gemini 2.5 Flash**. TTFT typically 150-300ms · acceptable.

**Optimization options:**
- **gpt-4o-mini** TTFT ~120-200ms · faster but loses some reasoning depth
- **claude-3.5-haiku** TTFT ~150-250ms · best instruction-following for the same cost tier
- **Groq llama-3.1-70b** TTFT ~100ms · fastest available · open-source quality

**Action:** A/B test Gemini 2.5 Flash vs gpt-4o-mini for 50 voice turns. If Gemini's TTFT is already ≤200ms, keep it. If >250ms, switch to gpt-4o-mini. Expected win: **0-150ms**.

### 4. Text-to-Speech (TTS) · target ≤ 150ms TTFA

| Provider/Model | TTFA | Quality | Cost |
|---|---|---|---|
| OpenAI TTS (gpt-4o-mini-tts) | 250-400ms | Good · 13 voices | Cheap |
| **ElevenLabs Flash v2.5** | **75ms** | **Best · emotional** | ~$0.30/1k chars |
| Deepgram Aura-2 | 184ms | Decent | 40% cheaper than ElevenLabs |
| Cartesia Sonic | 90ms | Good | Cheap · newer |

**Action:** This is THE biggest single win. If VAPI is on OpenAI TTS or older ElevenLabs models, switch to **ElevenLabs Flash v2.5** (model_id: `eleven_flash_v2_5`). Expected win: **150-300ms**.

### 5. Audio pipeline buffering · target ≤ 100ms aggregate

- Pre-roll buffer: 50-100ms is fine (smooths playback). >100ms = perceptible lag.
- Bitrate: keep at ≥16kbps for clarity but don't go above 32kbps for chat (no gain).
- Format: PCM16 mono · widely supported, minimal encode/decode overhead.

**Action:** In VAPI Audio Settings, confirm `output_audio_format: pcm16` and no extra resampling. Expected baseline savings: 50ms cumulative.

---

## Suggested optimization order (highest ROI first)

| Step | Change | Estimated win | Risk |
|---|---|---|---|
| 1 | Switch TTS → ElevenLabs Flash v2.5 | 150-300ms | Low · same API, faster |
| 2 | Switch STT → Deepgram Nova-3 (if not already) | 100-300ms | Low |
| 3 | Switch VAD → Semantic/SmartTurn | 30-100ms | Low · also fixes turn-taking bugs |
| 4 | Audit LLM TTFT · maybe swap Gemini → gpt-4o-mini | 0-150ms | Medium · reasoning may shift |
| 5 | Audio buffer/format check | 50ms | Low |

**Total achievable:** 330-900ms reduction. Target sub-500ms is in reach without any code changes — it's all VAPI configuration.

---

## Verification plan

After applying steps 1-3 (no LLM change), run 10 calls and have Nick acknowledge with a 2-word reply. Measure:
- Time-to-first-audio after end-of-user-speech
- Total user-perceived round-trip
- Subjective: does it feel like talking to a fast person or a slow one?

**Hard target:** p50 ≤ 500ms, p95 ≤ 800ms, jitter (p95 - p50) ≤ 200ms.

---

## What I can't do without operator action

- Access VAPI dashboard to apply changes
- Run live latency measurements
- Switch the LLM model on the assistant

**Operator's 5-minute action:** open VAPI dashboard → Nick assistant → check current TTS provider. If ANYTHING other than ElevenLabs Flash v2.5, swap to it. That single change is the biggest win.
