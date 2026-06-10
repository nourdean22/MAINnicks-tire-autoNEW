# Runbook — GA4 event repointing after the tracking canonicalization

_External GA4 UI actions only — the code already emits the right events (live-verified at the 4a12a6c2 deploy). ~10 minutes. (attribution completion wave 2026-06)_

## What changed in code (already live)
| Event (canonical, what GA4 receives NOW) | Fired when | Replaced |
|---|---|---|
| `phone_click` (param: `source`, `page`) | any call CTA tap, all pages | `phone_call_click` — **stopped accruing 2026-06-09**; its series is flat-zero after that date |
| `sms_click` / `directions_click` | text / directions CTAs | (new coverage on some surfaces) |
| `booking_cta_click` / `tire_quote_cta_click` | hero + funnel CTAs | (new) |
| GA4 default `page_view` etc. | unchanged | — |

## Owner actions in GA4 (analytics.google.com)
1. **Key events:** Admin -> Events -> if `phone_call_click` is marked as a key event, mark **`phone_click`** as a key event instead (keep the old one listed — its history stays readable).
2. **Reports/Explorations:** any custom report or exploration filtered on `phone_call_click` -> duplicate it and swap the filter to `phone_click`. Annotate the 2026-06-09 cutover so the series break is self-explanatory.
3. **Audiences/Ads links:** if any Google Ads conversion imports or audiences key on the old event, re-point them to `phone_click` (otherwise they silently go quiet).
4. **Verify:** Reports -> Realtime -> tap a call button on nickstire.org from a phone -> `phone_click` appears with `source` (e.g. `mobile-cta`, `hero`, `tire-finder`).

## What NOT to do
- Don't rename events in GA4 to match the old name — the code name is canonical now.
- Don't delete `phone_call_click` history — it's the pre-cutover record.
- No code changes are needed; if a report still seems empty after repointing, check the date range spans the cutover.
