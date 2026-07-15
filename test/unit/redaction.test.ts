import { describe, expect, it } from "vitest";
import { maskApiKey } from "../../src/auth/ApiKeyService";
import { redactHeaders, redactSensitive } from "../../src/logging/redaction";

describe("redaction", () => {
  it("masks API keys for UI without returning the raw value", () => {
    expect(maskApiKey("sk-vrouter-abcdef123456").masked).toBe("sk-vroute••••3456");
  });

  it("redacts authorization, cookie and API key values", () => {
    const text = 'Authorization: Bearer sk-secret123456 Cookie: client_token=abc apiKey":"sk-secret123456"';
    const redacted = redactSensitive(text);
    expect(redacted).not.toContain("sk-secret123456");
    expect(redacted).not.toContain("client_token=abc");
  });

  it("redacts sensitive headers", () => {
    expect(redactHeaders({ authorization: "Bearer test", cookie: "client_token=abc", accept: "json" })).toEqual({
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      accept: "json"
    });
  });
});
