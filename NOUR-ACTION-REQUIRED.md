# Operator console actions — agent cannot and must not do these

1. **Revoke the GitHub PAT** — github.com → Settings → Developer settings → Personal access tokens.
   It was embedded in `.git/config` (now stripped; pushes verified working via the gh credential
   helper). Stripping does NOT revoke it — the token is live until you delete it.
2. **Delete the Deepgram key** — Deepgram console, project `efeb2d23…`. Prepaid $199.998 is parked,
   not draining; whether it's refundable is a Deepgram-support question. Zero code references
   remain; removal from Railway env (2026-08-05) revoked nothing.
3. **Rotate/delete the LiveKit key + secret** — cloud.livekit.io. Also check the **billing plan**
   there: unlike Deepgram, a paid tier bills despite zero usage, and the plan is only visible in
   your dashboard.
4. **VAPI dashboard — required BEFORE any Stage-3 vapi-route deletion**: list where these four tool
   URLs point today, and whether you want them repointed to nickstire:
   `check-used-tire-stock` · `lookup-customer` · `schedule-dropoff` · `submit-callback`
   (today they are statenour routes on bdnick.info and they are live call-handling).
5. **TCPA consent ledger decision**: marketing sends currently rely on quiet hours + suppression +
   compliance log. A timestamped written-consent record per recipient is the remaining gap —
   worth a counsel check before the next campaign send. No sends were made or altered.
6. **ChatGPT Custom GPT**: confirm whether it still calls `bdnick.info/api/nour-os/query` — it's on
   the Stage-3 delete list and the repo cannot see external consumers.
7. Optional hardening: enable branch protection / required checks on GitHub — today `gh pr merge`
   succeeds over a red CI by design.
