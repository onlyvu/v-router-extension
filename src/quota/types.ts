import type { QuotaSnapshot } from "../api/types";

export interface QuotaCache {
  snapshot: QuotaSnapshot;
  fetchedAt: number;
}

export interface QuotaDecision {
  allowed: boolean;
  message: string;
  status: string;
}
