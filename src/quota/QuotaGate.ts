import type { QuotaSnapshot } from "../api/types";
import { messageForApiKeyStatus } from "../api/errorMapper";
import type { QuotaDecision } from "./types";

export function evaluateQuota(snapshot: QuotaSnapshot | null): QuotaDecision {
  if (snapshot === null) {
    return {
      allowed: false,
      status: "unknown",
      message: "Không thể xác minh trạng thái API key."
    };
  }
  const status = snapshot.effectiveStatus;
  if (status === "active") {
    return {
      allowed: true,
      status,
      message: "API key đang hoạt động."
    };
  }
  return {
    allowed: false,
    status,
    message: messageForApiKeyStatus(status)
  };
}
