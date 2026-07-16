import type { ActionItem } from "./types";

export interface QueueActionDefinition {
  primaryLabel: string;
  primaryConfirmTitle: string;
  primaryConfirmMessage: (name: string) => string;
  secondaryLabel: string;
  secondaryConfirmTitle: string;
  secondaryConfirmMessage: (name: string) => string;
  secondaryDestructive: boolean;
}

export function getQueueActionDefinition(type: ActionItem["type"]): QueueActionDefinition {
  switch (type) {
    case "booking":
      return {
        primaryLabel: "Confirm booking",
        primaryConfirmTitle: "Confirm booking?",
        primaryConfirmMessage: (name) => `Confirm the booking for ${name}.`,
        secondaryLabel: "Cancel booking",
        secondaryConfirmTitle: "Cancel booking?",
        secondaryConfirmMessage: (name) => `Cancel the booking for ${name}. The record remains in history.`,
        secondaryDestructive: true,
      };
    case "lead":
      return {
        primaryLabel: "Mark contacted",
        primaryConfirmTitle: "Mark lead contacted?",
        primaryConfirmMessage: (name) => `Record that ${name} was contacted.`,
        secondaryLabel: "Close lead",
        secondaryConfirmTitle: "Close lead?",
        secondaryConfirmMessage: (name) => `Close ${name}'s lead and remove it from the active queue.`,
        secondaryDestructive: false,
      };
    case "callback":
      return {
        primaryLabel: "Complete callback",
        primaryConfirmTitle: "Complete callback?",
        primaryConfirmMessage: (name) => `Record the callback to ${name} as completed.`,
        secondaryLabel: "Open callback",
        secondaryConfirmTitle: "Open callback details?",
        secondaryConfirmMessage: (name) => `Open ${name}'s callback record without changing its status.`,
        secondaryDestructive: false,
      };
    case "workOrder":
      return {
        primaryLabel: "Open work order",
        primaryConfirmTitle: "Open work order?",
        primaryConfirmMessage: (name) => `Open ${name}'s work order in Customers.`,
        secondaryLabel: "Open work order",
        secondaryConfirmTitle: "Open work order?",
        secondaryConfirmMessage: (name) => `Open ${name}'s work order in Customers.`,
        secondaryDestructive: false,
      };
  }
}
