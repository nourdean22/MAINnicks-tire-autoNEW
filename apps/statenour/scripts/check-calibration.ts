import { buildJudgeCalibration } from "../lib/services/judge-calibration";

async function main() {
  console.log("Checking judge calibration...");
  const report = await buildJudgeCalibration({ sinceDays: 90 });
  console.log("---------------------------------------");
  console.log("Total Scored (n):", report.totalScored);
  console.log("Agreement %:", report.agreementPct);
  console.log("Verdict:", report.verdict);
  console.log("Verdict Reason:", report.verdictReason);
  console.log("Ties:", report.ties);
  console.log("No operator reaction:", report.noOperatorReaction);
  console.log("No source message:", report.noSourceMessage);
  console.log("Matrix:", JSON.stringify(report.matrix));
  console.log("---------------------------------------");
}

main().catch(err => {
  console.error("Error running calibration check:", err);
});
