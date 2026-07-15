import { describe, expect, it } from "vitest";
import { mapErrorAction, parseErrorBody, parseRetryAfterMs } from "../../src/api/errorMapper";

describe("errorMapper", () => {
  it("parses OpenAI-compatible error body", () => {
    const body = parseErrorBody({ error: { message: "No model", type: "invalid_request_error", code: "model_not_found" } });
    expect(body.error?.code).toBe("model_not_found");
  });

  it("maps model and retry actions", () => {
    expect(mapErrorAction(403, { error: { code: "model_not_allowed" } })).toBe("model_blocked");
    expect(mapErrorAction(404, { error: { code: "model_not_found" } })).toBe("model_refresh");
    expect(mapErrorAction(429, {})).toBe("rate_limited");
    expect(mapErrorAction(502, {})).toBe("server_error");
  });

  it("parses Retry-After seconds", () => {
    expect(parseRetryAfterMs("3")).toBe(3000);
  });
});
