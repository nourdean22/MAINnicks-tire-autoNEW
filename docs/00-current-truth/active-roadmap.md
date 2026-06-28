# Active Development Roadmap

This document maps high-priority active initiatives, completed milestones, and upcoming technical upgrades in the `NOURCITY` ecosystem.

---

## 🏁 Active Initiatives & Milestones

### 1. Integration Auth & Key Synchronization (Completed · June 27, 2026)
*   **Context**: The `statenour` dashboard was failing to pull live telemetry snapshots from `nickstire` due to mismatched API keys between their local `.env` files.
*   **Resolution**: Sync keys (`BRIDGE_API_KEY`, `STATENOUR_SYNC_KEY`) across both environments. Fast-path bridge queries `/api/bridge/shop-snapshot` are now fully validated and active.
*   **Branch**: `statenour/health-governor-sync`

### 2. Live Capacity & Health Governor Synchronization (Completed · June 27, 2026)
*   **Context**: The `DayState` database enum was locked to `OPEN` or `CLOSED`, making the dynamic capacity mapping logic (`LOCKED_IN` ➔ `peak`, `DRIFT` ➔ `drift`) dead.
*   **Resolution**: Refactored `readLiveState()` in `task-signals.ts` to call `getLatestGovernorDecision()` directly. Dynamically resolves capacity limits based on active biometrics (sleep, soreness, focus, drift).
*   **Branch**: `statenour/health-governor-sync`

### 3. Instagram Reel Publishing & Higgsfield Pipeline (In Progress)
*   **Context**: Automating the rendering and publishing of video assets to Meta/Instagram.
*   **Current State**:
    *   Vite Express server registers the rendering queue (`/api/sync/queue/render`).
    *   Remotion engine is successfully configured to compile MP4 drafts.
*   **Next Steps**: Connect the publication triggers with the Instagram Graph API and monitor posting latency.

---

## 📋 Ongoing Cleanups & Guardrails

1.  **Markdown Lint Warnings**: Format files under `docs/` and `/brain` directories to clear standard heading, spacing, and list-block warnings without altering technical content.
2.  **Google Places Detail Fallback Cache Lock**: Ensure backup stats inside the `shop_settings` DB table are kept fresh so that if Google reviews API access duns or locks out, the public frontend displays accurate fallback ratings.
