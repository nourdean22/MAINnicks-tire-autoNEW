import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { classifyCall } from "../server/services/vapiCallClassifier.js";
import {
  detectForbiddenClaims,
  detectOverdiagnosis,
  detectFearmongering,
  detectUnsupportedPriceOrFree,
  detectGenericMarketingLanguage,
} from "../client/src/lib/igCarouselStudio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_SET_PATH = path.resolve(__dirname, "../server/lib/ai/evals/prompt-evals/eval-set.json");

const c = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

interface EvalReport {
  suite: string;
  id: string;
  passed: boolean;
  expected: string;
  actual: string;
  reason?: string;
}

export async function runPromptEvals() {
  const evalSetRaw = fs.readFileSync(EVAL_SET_PATH, "utf-8");
  const evalSet = JSON.parse(evalSetRaw);

  const reports: EvalReport[] = [];

  // 1. Run VAPI Outcome Classifier Tests
  for (const test of evalSet.vapiClassifierTests) {
    try {
      const res = classifyCall(test.input);
      const passed = res.outcome === test.expectedOutcome;
      reports.push({
        suite: "VAPI Outcome Classifier",
        id: test.id,
        passed,
        expected: test.expectedOutcome,
        actual: res.outcome,
        reason: res.reasoning,
      });
    } catch (err: any) {
      reports.push({
        suite: "VAPI Outcome Classifier",
        id: test.id,
        passed: false,
        expected: test.expectedOutcome,
        actual: "THREW_ERROR",
        reason: err.message,
      });
    }
  }

  // 2. Run Content Prompt Safety Tests
  for (const test of evalSet.safetyClaimTests) {
    try {
      const text = test.text;
      const findings = [
        ...detectForbiddenClaims(text, "test"),
        ...detectOverdiagnosis(text, "test"),
        ...detectFearmongering(text, "test"),
        ...detectUnsupportedPriceOrFree(text, "test"),
        ...detectGenericMarketingLanguage(text, "test"),
      ];
      
      const hasBlock = findings.some(f => f.severity === "block");
      const passed = test.shouldPass ? !hasBlock : hasBlock;
      
      let actual = hasBlock ? "blocked" : "passed";
      let failedRules = findings.map(f => f.rule).join(", ");
      
      reports.push({
        suite: "Content Prompt Safety",
        id: test.id,
        passed,
        expected: test.shouldPass ? "passed" : "blocked",
        actual,
        reason: hasBlock ? `Failed rules: ${failedRules}` : "Clean",
      });
    } catch (err: any) {
      reports.push({
        suite: "Content Prompt Safety",
        id: test.id,
        passed: false,
        expected: test.shouldPass ? "passed" : "blocked",
        actual: "THREW_ERROR",
        reason: err.message,
      });
    }
  }

  // 3. Run Proprietary Evidence Handling Tests (PII & Live check)
  const piiPhoneRx = /(\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b)/;
  const piiNameRx = /\b(John Doe|Jane Smith|PII)\b/i;
  for (const test of evalSet.evidenceHandlingTests) {
    try {
      const text = test.text;
      const hasPII = piiPhoneRx.test(text) || piiNameRx.test(text);
      const passed = test.shouldPass ? !hasPII : hasPII;
      
      reports.push({
        suite: "Proprietary Evidence Handling",
        id: test.id,
        passed,
        expected: test.shouldPass ? "no_pii" : "pii_detected",
        actual: hasPII ? "pii_detected" : "no_pii",
        reason: hasPII ? "PII leak found (name/phone)" : "Clean",
      });
    } catch (err: any) {
      reports.push({
        suite: "Proprietary Evidence Handling",
        id: test.id,
        passed: false,
        expected: test.shouldPass ? "no_pii" : "pii_detected",
        actual: "THREW_ERROR",
        reason: err.message,
      });
    }
  }

  // 4. Run Follow-Up Template Tests
  const waitTimeRx = /\b(exactly|in|under)\s+\d+\s*(minutes|mins|hours)\b/i;
  for (const test of evalSet.followUpTemplateTests) {
    try {
      const text = test.text;
      const hasWaitPromise = waitTimeRx.test(text);
      const passed = test.shouldPass ? !hasWaitPromise : hasWaitPromise;
      
      reports.push({
        suite: "Follow-Up Template Safety",
        id: test.id,
        passed,
        expected: test.shouldPass ? "no_promises" : "promises_wait_times",
        actual: hasWaitPromise ? "promises_wait_times" : "no_promises",
        reason: hasWaitPromise ? "Exact wait time promised" : "Clean",
      });
    } catch (err: any) {
      reports.push({
        suite: "Follow-Up Template Safety",
        id: test.id,
        passed: false,
        expected: test.shouldPass ? "no_promises" : "promises_wait_times",
        actual: "THREW_ERROR",
        reason: err.message,
      });
    }
  }

  return reports;
}

async function runCli() {
  console.log(`${c.cyan}━━ Running Prompt & Outcome Evaluations ━━${c.reset}\n`);
  
  const reports = await runPromptEvals();
  
  let passedCount = 0;
  let failedCount = 0;
  
  for (const rep of reports) {
    if (rep.passed) {
      passedCount++;
      console.log(`  ${c.green}✓ [${rep.suite}] ${rep.id}${c.reset}`);
    } else {
      failedCount++;
      console.log(`  ${c.red}✗ [${rep.suite}] ${rep.id} — Expected: ${rep.expected}, Got: ${rep.actual}${c.reset}`);
      if (rep.reason) {
        console.log(`      ${c.dim}Reason: ${rep.reason}${c.reset}`);
      }
    }
  }
  
  console.log(`\n${c.cyan}━━ Summary: ${passedCount} passed, ${failedCount} failed ━━${c.reset}`);
  
  if (failedCount > 0) {
    process.exit(1);
  }
}

// Check if run directly
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  runCli().catch((err) => {
    console.error(`${c.red}Harness crashed:${c.reset}`, err);
    process.exit(2);
  });
}
