import { describe, expect, it } from "vitest";
import { CookieManager, extractClientTokenCookie } from "../../src/api/cookieManager";

describe("cookieManager", () => {
  it("extracts only the client_token cookie pair", () => {
    expect(extractClientTokenCookie([
      "client_token=jwt.value; Path=/; HttpOnly; Secure; SameSite=Lax"
    ])).toBe("client_token=jwt.value");
  });

  it("extracts client_token from combined fallback Set-Cookie header", () => {
    expect(extractClientTokenCookie([
      "other=1; Path=/, client_token=abc123; Path=/; HttpOnly"
    ])).toBe("client_token=abc123");
  });

  it("stores and clears cookie header in memory", () => {
    const manager = new CookieManager();
    manager.updateFromHeaders(new Headers({ "set-cookie": "client_token=abc; Path=/" }));
    expect(manager.getCookieHeader()).toBe("client_token=abc");
    manager.clear();
    expect(manager.getCookieHeader()).toBeNull();
  });
});
