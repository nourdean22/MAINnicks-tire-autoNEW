import { AlertTriangle } from "lucide-react";

interface Props {
  stats?: { _degraded?: boolean; _errorId?: string } | null;
  unavailable?: boolean;
  unavailableMessage?: string;
}

/**
 * Prevents missing or failed admin data from being presented as verified zeros.
 * The banner supports both server-degraded fallback shapes and transport/query
 * failures where no stats object was returned at all.
 */