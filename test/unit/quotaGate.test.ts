import { describe, expect, it } from "vitest";
import type { QuotaSnapshot } from "../../src/api/types";
import { evaluateQuota } from "../../src/quota/QuotaGate";

function quota(status: string, remaining: number | null = 100): QuotaSnapshot {
  return {
    quotaMode: "daily",
    limit: remaining === null ? null : 1000,
    used: 0,
    reserved: 0,
    remaining,
    resetAt: null,
    expiresAt: null,
    storedStatus: status,
    effectiveStatus: status,
    reason: null,
    percentUsed: 0
  };
}

describe("QuotaGate", () => {
  it("allows active quota including unlimited", () => {
    expect(evaluateQuota(quota("active")).allowed).toBe(true);
    expect(evaluateQuota(quota("active", null)).allowed).toBe(true);
  });

  it("blocks expired and daily quota exceeded states", () => {
    expect(evaluateQuota(quota("expired")).allowed).toBe(false);
    expect(evaluateQuota(quota("daily_quota_exceeded")).message).toContain("hôm nay");
  });
});
