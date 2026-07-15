import type { ModelEntry } from "../api/types";

export interface ModelCache {
  models: ModelEntry[];
  fetchedAt: number;
}
