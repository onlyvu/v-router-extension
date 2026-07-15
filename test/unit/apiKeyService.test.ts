import { describe, expect, it } from "vitest";
import { ApiKeyService, type SecretStore } from "../../src/auth/ApiKeyService";
import { SECRET_API_KEY } from "../../src/config/constants";

describe("ApiKeyService", () => {
  it("stores, reads and deletes only through SecretStorage-compatible API", async () => {
    const memory = new Map<string, string>();
    const store: SecretStore = {
      get: (key) => Promise.resolve(memory.get(key)),
      store: (key, value) => {
        memory.set(key, value);
        return Promise.resolve();
      },
      delete: (key) => {
        memory.delete(key);
        return Promise.resolve();
      }
    };
    const service = new ApiKeyService(store);
    await service.storeApiKey("  sk-vrouter-test  ");
    expect(memory.get(SECRET_API_KEY)).toBe("sk-vrouter-test");
    expect(await service.getApiKey()).toBe("sk-vrouter-test");
    await service.deleteApiKey();
    expect(await service.hasApiKey()).toBe(false);
  });
});
