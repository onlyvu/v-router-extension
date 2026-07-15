import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("security and packaging integration checks", () => {
  it("webview HTML builder uses CSP without unsafe script directives", () => {
    const provider = readFileSync(join(root, "src", "providers", "ChatViewProvider.ts"), "utf8");
    expect(provider).toContain("Content-Security-Policy");
    expect(provider).toContain("script-src 'nonce-");
    expect(provider).not.toContain("unsafe-eval");
    expect(provider).not.toContain("script-src 'unsafe-inline'");
  });

  it("extension registers ChatViewProvider and SecretStorage key constant", () => {
    const extension = readFileSync(join(root, "src", "extension.ts"), "utf8");
    const constants = readFileSync(join(root, "src", "config", "constants.ts"), "utf8");
    expect(extension).toContain("registerWebviewViewProvider");
    expect(extension).toContain("CHAT_VIEW_ID");
    expect(constants).toContain('SECRET_API_KEY = "vRouterSmart.apiKey"');
  });

  it("vscodeignore excludes secrets, tests and oversized development inputs", () => {
    const ignore = readFileSync(join(root, ".vscodeignore"), "utf8");
    expect(ignore).toContain(".env");
    expect(ignore).toContain("test/**");
    expect(ignore).toContain("V-RouterDoc.md");
  });
});
