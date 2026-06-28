import { appRouter } from "../server/routers";
import { getDbTyped } from "../server/db";

async function main() {
  const db = await getDbTyped();
  if (!db) {
    console.error("Database not available");
    process.exit(1);
  }

  // Create a tRPC caller with mock context (admin privileges)
  const caller = appRouter.createCaller({
    req: {} as any,
    res: {} as any,
    user: { id: "admin", role: "admin", email: "admin@example.com", name: "Admin", isGuest: false } as any,
  });

  console.log("Triggering live test reel generation and publication...");
  try {
    const result = await caller.contentAdmin.generateAndPublishLiveTestReel({ dryRun: false });
    console.log("SUCCESS! Here is the result:");
    console.log(JSON.stringify(result, null, 2));
    
    if (result.instagramPermalink) {
      console.log("\n>>> INSTAGRAM PERMALINK: " + result.instagramPermalink + " <<<");
    }
  } catch (err) {
    console.error("FAILED TO GENERATE/PUBLISH REEL:", err);
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch(console.error);
