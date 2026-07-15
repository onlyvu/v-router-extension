import type { ClientKeyInfo } from "../api/types";
import { messageForApiKeyStatus } from "../api/errorMapper";
import type { AuthViewState } from "../protocol";

export class SessionService {
  private keyInfo: ClientKeyInfo | null = null;

  public setKeyInfo(keyInfo: ClientKeyInfo | null): void {
    this.keyInfo = keyInfo;
  }

  public getKeyInfo(): ClientKeyInfo | null {
    return this.keyInfo;
  }

  public toViewState(hasKey: boolean): AuthViewState {
    const status = this.keyInfo?.quota.effectiveStatus ?? this.keyInfo?.status ?? (hasKey ? "unknown" : "missing");
    return {
      hasKey,
      keyPrefix: this.keyInfo?.keyPrefix ?? null,
      keyName: this.keyInfo?.name ?? null,
      status,
      message: hasKey ? messageForApiKeyStatus(status) : "Chưa lưu API key."
    };
  }

  public clear(): void {
    this.keyInfo = null;
  }
}
