import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SERVER_ORIGIN } from "../../src/config/constants";
import { validateSettingsValues } from "../../src/config/settings";

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: () => undefined
    })
  }
}));

describe("settings", () => {
  it("ignores custom serverOrigin values and keeps the V-Router endpoint fixed", () => {
    const result = validateSettingsValues({ serverOrigin: "http://localhost:1234" });

    expect(result.settings.serverOrigin).toBe(DEFAULT_SERVER_ORIGIN);
    expect(result.warnings.some((warning) => warning.key === "serverOrigin")).toBe(false);
  });
});
