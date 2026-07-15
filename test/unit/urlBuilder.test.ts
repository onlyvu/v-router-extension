import { describe, expect, it } from "vitest";
import { createUrlBuilder, normalizeServerOrigin } from "../../src/api/urlBuilder";

describe("urlBuilder", () => {
  it("normalizes server origin and strips trailing slashes", () => {
    expect(normalizeServerOrigin("https://v-router.fpt.ovh///")).toBe("https://v-router.fpt.ovh");
  });

  it("builds Client API endpoint without duplicating v1", () => {
    const builder = createUrlBuilder("https://v-router.fpt.ovh/");
    expect(builder.buildServerUrl("/api/client/me")).toBe("https://v-router.fpt.ovh/api/client/me");
  });

  it("builds OpenAI-compatible endpoint under /v1", () => {
    const builder = createUrlBuilder("https://v-router.fpt.ovh/");
    expect(builder.buildOpenAIUrl("/chat/completions")).toBe("https://v-router.fpt.ovh/v1/chat/completions");
  });

  it("allows HTTP only for local development hosts", () => {
    expect(normalizeServerOrigin("http://localhost:20128")).toBe("http://localhost:20128");
    expect(() => normalizeServerOrigin("http://example.com")).toThrow(/localhost/);
  });
});
