import "server-only";
import { getModel, getActiveProviderInfo, type ProviderName, type TaskType } from "../provider";
import { type LanguageModel } from "ai";

export interface RoutedModel {
  model: LanguageModel;
  provider: ProviderName;
  modelId: string;
  taskType: TaskType;
}

export function routeModelForMode(mode: "fast" | "operator" | "engineer"): RoutedModel {
  let taskType: TaskType = "reason";
  
  switch (mode) {
    case "fast":
      taskType = "fast";
      break;
    case "operator":
      taskType = "reason";
      break;
    case "engineer":
      taskType = "code";
      break;
    default:
      taskType = "reason";
  }

  const model = getModel(taskType);
  const info = getActiveProviderInfo(taskType);

  return {
    model,
    provider: info.provider,
    modelId: info.modelId,
    taskType,
  };
}
