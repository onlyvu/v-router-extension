import type { VRouterClient } from "../api/VRouterClient";
import type { QuotaSnapshot } from "../api/types";
import type { Logger } from "../logging/logger";
import type { QuotaService } from "./QuotaService";

function isQuotaSnapshot(value: unknown): value is QuotaSnapshot {
  return typeof value === "object" && value !== null &&
    typeof (value as Record<string, unknown>).effectiveStatus === "string" &&
    typeof (value as Record<string, unknown>).percentUsed === "number";
}

export class QuotaStream {
  private controller: AbortController | null = null;

  public constructor(
    private readonly client: VRouterClient,
    private readonly quotaService: QuotaService,
    private readonly logger: Logger,
    private readonly onQuota: (quota: QuotaSnapshot) => void
  ) {}

  public start(): void {
    if (this.controller !== null) {
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    void this.client.streamQuota(controller.signal, (_event, data) => {
      const record = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
      const key = typeof record.key === "object" && record.key !== null ? record.key as Record<string, unknown> : {};
      const quota = key.quota;
      if (isQuotaSnapshot(quota)) {
        this.quotaService.setQuota(quota);
        this.onQuota(quota);
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        this.logger.warn("Quota stream stopped", error);
      }
    }).finally(() => {
      if (this.controller === controller) {
        this.controller = null;
      }
    });
  }

  public stop(): void {
    this.controller?.abort();
    this.controller = null;
  }

  public dispose(): void {
    this.stop();
  }
}
