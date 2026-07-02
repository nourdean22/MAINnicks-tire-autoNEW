import { router } from "../trpc";
import { devicesProcedures } from "./system/devices";
import { qualityProcedures } from "./system/quality";

// Extract brain-bus and anti-patterns/contradictions
const { brainBusEvents } = devicesProcedures;
const { 
  antiPatterns, 
  createAntiPattern, 
  revisitAntiPattern, 
  deleteAntiPattern,
  contradictions,
  resolveContradiction
} = qualityProcedures;

export const systemBrainRouter = router({
  brainBusEvents,
  antiPatterns,
  createAntiPattern,
  revisitAntiPattern,
  deleteAntiPattern,
  contradictions,
  resolveContradiction,
});
