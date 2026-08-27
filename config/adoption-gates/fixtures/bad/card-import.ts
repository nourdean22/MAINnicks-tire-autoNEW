// FIXTURE - intentionally violates no-deprecated-card. Never imported.
// Relative path on purpose: it must RESOLVE to the real deprecated file so
// the canary proves dependency-cruiser matches the resolved module path.
import { Card } from "../../../../apps/statenour/components/ui/card";

export const bad = Card;
