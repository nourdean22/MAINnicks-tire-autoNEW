# Gmail Integration Setup · v10.0.379

One-time setup for the `lib/integrations/gmail.ts` module so Nick can
read inbox / draft replies / send mail on the operator's behalf.

## Why a separate OAuth flow?

The app login uses NextAuth Google provider with **only basic profile
scopes**. Adding Gmail scopes there would force every login to re-prompt
for consent and would couple the auth blast radius to Gmail availability.

This module uses a **separate refresh token** stored as `GMAIL_REFRESH_TOKEN`
env var. The operator does the OAuth dance once · paste the refresh token ·
done. Module auto-refreshes access tokens per call.

## Required scopes

- `https://www.googleapis.com/auth/gmail.readonly` · list + read
- `https://www.googleapis.com/auth/gmail.send` · send drafts
- `https://www.googleapis.com/auth/gmail.modify` · create/update drafts

## Setup steps

### 1 · Verify Google Cloud OAuth client

You already have one (used by NextAuth login). Confirm:
- Project: NOUR OS
- OAuth 2.0 Client ID: same as `AUTH_GOOGLE_CLIENT_ID`
- Redirect URI must include: `https://developers.google.com/oauthplayground`
  (add it temporarily for the OAuth playground exchange · remove after)

### 2 · Mint a refresh token via OAuth Playground

1. Go to https://developers.google.com/oauthplayground
2. Click the gear icon (top right) → "OAuth 2.0 configuration"
   - Check "Use your own OAuth credentials"
   - Paste your `AUTH_GOOGLE_CLIENT_ID` + `AUTH_GOOGLE_CLIENT_SECRET`
3. Step 1 · "Select & authorize APIs":
   - Paste these scopes (one per line in the Input field):
     ```
     https://www.googleapis.com/auth/gmail.readonly
     https://www.googleapis.com/auth/gmail.send
     https://www.googleapis.com/auth/gmail.modify
     ```
   - Click "Authorize APIs"
   - Sign in as `nourdean22@gmail.com`
   - Grant the scopes
4. Step 2 · "Exchange authorization code for tokens":
   - Click "Exchange authorization code for tokens"
   - Copy the **Refresh token** (long string · starts with `1//...`)

### 3 · Store the refresh token

**Local dev** (`.env`):
```
GMAIL_REFRESH_TOKEN=1//...your-refresh-token-here
```

**Vercel production**:
```
vercel env add GMAIL_REFRESH_TOKEN production
# paste the token when prompted
```

### 4 · Remove the OAuth Playground redirect URI

Go back to your Google Cloud OAuth client settings and remove
`https://developers.google.com/oauthplayground` from the authorized
redirect URIs (it was only needed for the one-time exchange).

### 5 · Verify

Run a one-shot test:
```bash
pnpm tsx -e "
import { listInbox } from './lib/integrations/gmail.ts';
listInbox({ maxResults: 5 }).then(t => console.log(t.length, 'threads'));
"
```

Should print `5 threads` (or however many you have).

## Revocation

If the refresh token is ever leaked or you want to rotate:
1. Visit https://myaccount.google.com/permissions
2. Find the OAuth client (your NOUR OS app)
3. Click "Remove Access"
4. Repeat steps 2-3 above to mint a fresh refresh token

## Quotas

Gmail API free tier:
- 1 billion quota units per day (effectively unlimited)
- 250 quota units per user per second
- listInbox uses ~5 units · getThread ~5 units · draftReply ~10 units ·
  sendDraft ~100 units

For a single-operator usage pattern this is plenty.

## What's wired today

- `listInbox({ maxResults?, query? })` · list recent threads · supports
  Gmail search syntax (e.g. `is:unread newer_than:2d`)
- `getThread(threadId)` · full thread · all messages decoded
- `draftReply({ threadId, body })` · creates a draft
- `sendDraft(draftId)` · sends the draft

## What's NOT wired yet

- Chat tools · `arsenal.gmailInbox` etc · operator can ship in a
  follow-up after verifying the refresh-token setup works
- Auto-categorization (which emails matter, which to draft replies for)
- Inbox-zero workflow integration with /tasks

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
