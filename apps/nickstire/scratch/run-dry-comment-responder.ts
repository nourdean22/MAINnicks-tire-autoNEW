import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });

async function main() {
  const { runReelCommentResponder } = await import("../server/services/commentResponder");

  console.log("Launching dry-run Reel Comment Responder (REEL_COMMENT_RESPONDER_LIVE = false)...");
  // Force dry-run
  process.env.REEL_COMMENT_RESPONDER_LIVE = "false";
  // We can also override the reels count if needed
  process.env.REEL_COMMENT_RESPONDER_REELS = "5";

  try {
    const result = await runReelCommentResponder();

    console.log("\n=== COMMENT RESPONDER RUN RESULT ===");
    console.log(JSON.stringify(result, null, 2));

  } catch (err) {
    console.error("Error during run:", err);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
});
