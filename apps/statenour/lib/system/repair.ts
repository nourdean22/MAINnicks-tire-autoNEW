export const repairActions = ["warm_ai", "refresh_ale", "restart_runner", "rescan_capture", "verify_system"] as const;

export type RepairAction = (typeof repairActions)[number];

export function getRepairActionLabel(action: RepairAction) {
  switch (action) {
    case "warm_ai":
      return "Warm AI";
    case "refresh_ale":
      return "Refresh ALE";
    case "restart_runner":
      return "Restart Runner";
    case "rescan_capture":
      return "Rescan Capture";
    case "verify_system":
      return "Verify System";
    default:
      return action;
  }
}

export function getRepairActionForService(service: string | null | undefined): RepairAction | null {
  switch (service) {
    case "gemini":
    case "openrouter":
    case "openai":
      return "warm_ai";
    case "ale":
    case "ale_session":
    case "ale_refresh":
      return "refresh_ale";
    case "capture":
    case "capture_sync":
      return "rescan_capture";
    case "runner":
    case "repair_supervisor":
      return "restart_runner";
    case "app":
    case "launcher":
    case "network":
      return "verify_system";
    default:
      return null;
  }
}

export type RepairActionResponse = {
  status: string;
  detail: string;
  affectedServices: string[];
  checkedAt: string;
  nextAction: string;
  autoTriggered: boolean;
  cooldownUntil: string;
  circuitOpenUntil?: string;
};
