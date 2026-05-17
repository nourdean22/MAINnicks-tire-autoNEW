# VideoDB Session Capture · Operator Runbook · v10.0.525

> Capture your own operator sessions (chat + computer-use), index them
> with VideoDB, then search by what was said / shown later through Nick.

---

## What this is

You operate this stack from your phone via Claude Code + computer-use
MCP + Chrome MCP. None of that produces a persistent recording. You
have no way to ask Nick "what did I see on screen Tuesday afternoon"
because the bits are already gone.

This integration closes that gap. You record sessions yourself with a
tool you already use (OBS / Loom / built-in macOS or Windows screen
recorder), submit the file (or a URL to it) once, and VideoDB does:

1. Spoken-word indexing (every word you and Nick speak / type that
   surfaces as audio · STT transcript).
2. Scene indexing (every distinct visual frame · "what app is open",
   "what code is on screen", "what action am I taking").

After both indexes finish (typically 1-3min per minute of footage),
Nick can recall against them via chat.

---

## One-time setup

1. Sign up at <https://console.videodb.io>. Free tier is 50 uploads,
   no credit card required.
2. Copy your API key from the dashboard.
3. Add to Vercel / Railway env:
   ```
   VIDEO_DB_API_KEY=<your_key>
   ```
4. Redeploy. The tools auto-detect the key and stop returning
   `code='missing_api_key'`.

**Operator action item** · this is the single blocker. Until
`VIDEO_DB_API_KEY` is set in prod env, uploads return 503 and the
chat tools degrade to "key not set" responses.

---

## Capturing a session

Use any recorder you already have. Recommendations by surface:

| Surface | Recommended | Why |
|---|---|---|
| Desktop · full operator session | OBS Studio | Free, no subscription, system-audio capture works |
| Quick clip · 5min or less | macOS Cmd+Shift+5 / Win+G | Built-in, no install |
| Web-only flow (Chrome MCP work) | Loom | Easy share URL · skip the upload step |
| Phone-side review | Built-in iOS screen recording | Already in your control center |

**Audio matters.** If you want spoken-word recall, the recording MUST
include audio (your voice + Nick's TTS output, or just typed-input
where the transcript pipeline picks up keystrokes spoken aloud). A
silent screen recording is searchable by scene only.

Recommended encode settings:
- Container: MP4 or MOV
- Video: H.264 / 1080p / 30fps
- Audio: AAC stereo, ≥128kbps
- Max file size: 500MB per recording (route enforces this · split
  longer sessions)

---

## Submitting a recording

### Option A · URL (preferred · skip the upload step)

If you used Loom or uploaded the file somewhere Nick can reach
(Vercel Blob, Cloudflare R2, public Google Drive direct link), just
POST the URL:

```bash
curl -X POST https://your-host/api/system/videodb-sessions \
  -H "Cookie: <your_owner_session_cookie>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/session-2026-05-12.mp4",
    "scenePrompt": "Describe what is on screen, including app names, code, and key actions.",
    "notes": "Mid-day session · ALG recovery push",
    "capturedAt": "2026-05-12T14:30:00Z"
  }'
```

### Option B · multipart upload (for local files)

```bash
curl -X POST https://your-host/api/system/videodb-sessions \
  -H "Cookie: <your_owner_session_cookie>" \
  -F "file=@/path/to/session.mp4" \
  -F "notes=Mid-day session · ALG recovery push"
```

**Response** (both options):

```json
{
  "ok": true,
  "sessionId": "9f3...",
  "videoId": "vdb_...",
  "status": {
    "spokenIndex": "kicked_off",
    "sceneIndex": "kicked_off"
  },
  "streamUrl": "https://stream.videodb.io/..."
}
```

Indexes complete asynchronously inside VideoDB. Expect ~1-3min per
minute of footage for both indexes to be queryable.

---

## Querying via Nick

Just talk to Nick like you do for any other recall. The chat-mode
pruner surfaces the right tools when the question is shaped like a
session-recording question. Examples:

- "What did I see on screen yesterday around 2pm?"
- "Pull up that session where I was debugging the ALG cron."
- "Recall from video · the part where I was looking at the F25e gateway."
- "In last week's session, what query did I run against the bridge?"
- "Earlier on screen there was a stack trace · find it."

Under the hood Nick calls:
- `searchSessionRecordings(query)` · semantic search across all your
  captured sessions.
- `recallFromSession(query, sinceDate, untilDate)` · same but
  date-windowed (auto-selected when you say "yesterday", "last
  Tuesday", "this week", etc.).

Hits come back with `videoId`, `timestamp` (seconds from start),
`snippet`, and `similarity`. Nick will quote the snippet and cite
the timestamp. You can jump to the moment via the VideoDB
console (open `videoId` and seek to `timestamp`).

---

## Listing what's been captured

```bash
curl https://your-host/api/system/videodb-sessions \
  -H "Cookie: <owner_session>"
```

Returns up to 20 most recent sessions with metadata. Use this to
audit storage / confirm an upload landed.

---

## Limits + known limitations

| Item | Limit / Note |
|---|---|
| Max upload per recording | 500MB (route-enforced) |
| Free tier | 50 uploads on VideoDB · check your dashboard |
| Index latency | ~1-3 min/min of footage · async |
| Speaker diarization | Not exposed in v10.0.525 · transcript is single-stream. If you need "Nour said X, Nick said Y" separation, post-process with a diarization model (out of scope) |
| Live transcript | This is post-hoc only · we don't stream live capture. If you need live, use the existing Phase-1 chat audio surface (`lib/videodb/client.ts` · audio-only) |
| Privacy | Recordings live in VideoDB's cloud · don't capture material you wouldn't put in a third-party SaaS. Use a self-hosted alternative for sensitive content |
| Cost ceiling | Set a billing cap on your VideoDB account before you stop watching costs · the 50 free uploads cover most operator-recall use cases |

---

## Action items

- [ ] Set `VIDEO_DB_API_KEY` in Vercel + Railway env (one-time).
- [ ] Pick your recorder of choice (OBS recommended) and verify
      audio capture works end-to-end.
- [ ] Do one test capture · 1-2 min, screen + audio, mention a
      unique phrase like "test-recall-marker-525" once aloud.
- [ ] POST to `/api/system/videodb-sessions` and wait ~5min.
- [ ] In chat: "search session recordings for test-recall-marker-525".
      A successful hit confirms the pipeline end-to-end.
