/**
 * GET /api/system/env-check
 *
 * Owner-auth. Returns a boolean map of which critical env-var groups
 * are configured. Does NOT return any actual secret values — just
 * presence/absence so Nour can verify a Vercel env deploy landed
 * correctly without opening the Builder Sandbox UI.
 *
 * v11.1 · added to verify Browserbase + Vercel token env deploys
 * after Nour added them 2026-04-22.
 */
import { apiHandler } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = apiHandler(
  async () => {
    const has = (k: string): boolean => {
      const v = process.env[k];
      return typeof v === "string" && v.trim().length > 0;
    };

    const groups = {
      browserbase: {
        configured: has("BROWSERBASE_API_KEY") && has("BROWSERBASE_PROJECT_ID"),
        api_key: has("BROWSERBASE_API_KEY"),
        project_id: has("BROWSERBASE_PROJECT_ID"),
      },
      vercel: {
        // "configured" means "rollback endpoint can actually run" —
        // token alone isn't enough, the API calls need the project
        // id and (for team accounts) the team id.
        configured: has("VERCEL_TOKEN") && has("VERCEL_PROJECT_ID"),
        token: has("VERCEL_TOKEN"),
        team_id: has("VERCEL_TEAM_ID"),
        project_id: has("VERCEL_PROJECT_ID"),
      },
      ai: {
        openai: has("OPENAI_API_KEY"),
        anthropic: has("ANTHROPIC_API_KEY"),
        gemini: has("GEMINI_API_KEY") || has("GOOGLE_AI_API_KEY"),
      },
      push: {
        configured: has("VAPID_PUBLIC_KEY") && has("VAPID_PRIVATE_KEY"),
        public_key: has("VAPID_PUBLIC_KEY"),
        private_key: has("VAPID_PRIVATE_KEY"),
        subject: has("VAPID_SUBJECT"),
      },
      bridge: {
        statenour_sync_key: has("STATENOUR_SYNC_KEY"),
        nickstire_url: has("NICKSTIRE_URL") || has("NEXT_PUBLIC_NICKSTIRE_URL"),
      },
      db: {
        database_url: has("DATABASE_URL"),
        direct_url: has("DIRECT_URL"),
      },
      auth: {
        auth_secret: has("AUTH_SECRET"),
        google_client: has("AUTH_GOOGLE_CLIENT_ID") && has("AUTH_GOOGLE_CLIENT_SECRET"),
        allowed_email: has("AUTH_ALLOWED_EMAIL"),
      },
      // v11.2 · CRON_SECRET is required for every cron endpoint
      //   (requireCronAuth). Missing secret = every Vercel cron gets 401.
      //   Split from `auth` group because crons have their own auth path.
      cron: {
        configured: has("CRON_SECRET"),
        secret: has("CRON_SECRET"),
      },
      // v11.2 · Google Data OAuth — separate from the NextAuth sign-in
      //   OAuth client (which is in `auth.google_client`). This one
      //   grants Drive + Gmail + Calendar API access used by
      //   ingest-drive / ingest-gmail / ingest-calendar crons.
      //   If unconfigured, those crons silently skip without writing
      //   any audit event → the biggest source of "stale Cold Memory"
      //   symptoms.
      google_data: {
        // Tokens live in DB (BrainMemory with category=google_oauth),
        // not env. We only check whether the CLIENT credentials are
        // available to refresh tokens.
        client_id: has("AUTH_GOOGLE_CLIENT_ID") || has("GOOGLE_OAUTH_CLIENT_ID") || has("GOOGLE_CLIENT_ID"),
        client_secret: has("AUTH_GOOGLE_CLIENT_SECRET") || has("GOOGLE_OAUTH_CLIENT_SECRET") || has("GOOGLE_CLIENT_SECRET"),
        redirect_override: has("GOOGLE_OAUTH_REDIRECT_URI"),
      },
      // v11.2 · GitHub token (used by syncDriveMemory, githubReadFile,
      //   etc). Not critical but good to see at a glance.
      github: {
        token: has("GITHUB_TOKEN"),
      },
      // v11.2 · Telegram (bot webhook auth + notifications).
      telegram: {
        bot_token: has("TELEGRAM_BOT_TOKEN"),
        chat_id: has("TELEGRAM_CHAT_ID"),
      },
    };

    return {
      checkedAt: new Date().toISOString(),
      groups,
      // Rollup for quick scan — surfaces the "what's ready?" tl;dr
      summary: {
        ready: {
          browserbase: groups.browserbase.configured,
          vercel_rollback: groups.vercel.configured,
          push: groups.push.configured,
          crons: groups.cron.configured,
          google_data: groups.google_data.client_id && groups.google_data.client_secret,
        },
      },
    };
  },
  { auth: "owner" },
);
