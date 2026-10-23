import { router } from "../trpc";
import { devicesProcedures } from "./system/devices";
import { qualityProcedures } from "./system/quality";

// Extract brain-bus and anti-patterns
const { brainBusEvents } = devicesProcedures;
const { 
  antiPatterns, 
  createAntiPattern, 
  revisitAntiPattern, 
  deleteAntiPattern,
} = qualityProcedures;

export const systemBrainRouter = router({
  brainBusEvents,
  antiPatterns,
  createAntiPattern,
  revisitAntiPattern,
  deleteAntiPattern,
});
