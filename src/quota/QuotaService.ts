import type { VRouterClient } from "../api/VRouterClient";
import type { QuotaSnapshot } from "../api/types";
import type { VRouterSettings } from "../config/settings";
import type { Logger } from "../logging/logger";
import type { SessionService } from "../auth/SessionService";
import type { QuotaCache } from "./types";

export class QuotaService {
  private cache: QuotaCache | null = null;

  public constructor(
    private readonly client: VRouterClient,
    private readonly session: SessionService,
    private readonly logger: Logger
  ) {}

  public getCachedQuota(): QuotaSnapshot | null {
    return this.cache?.snapshot ?? null;
  }

  public setQuota(snapshot: QuotaSnapshot): void {
    this.cache = { snapshot, fetchedAt: Date.now() };
  }

  public async getQuota(settings: VRouterSettings, force = false, signal?: AbortSignal): Promise<QuotaSnapshot | null> {
    if (!force && this.cache !== null && Date.now() - this.cache.fetchedAt < settings.quotaCacheTtlMs) {
      return this.cache.snapshot;
    }
    const response = await this.client.getMe(signal);
    if (!response.authenticated || response.key === undefined) {
      this.cache = null;
      return null;
    }
    this.session.setKeyInfo(response.key);
    this.cache = { snapshot: response.key.quota, fetchedAt: Date.now() };
    this.logger.info("Quota refreshed", { status: response.key.quota.effectiveStatus, percentUsed: response.key.quota.percentUsed });
    return response.key.quota;
  }

  public clear(): void {
    this.cache = null;
  }
}
