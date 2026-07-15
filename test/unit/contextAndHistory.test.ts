import { describe, expect, it } from "vitest";
import { evaluateContextLimits } from "../../src/chat/contextBuilder";
import { validateConversationStoreData } from "../../src/chat/conversationStore";
import { isBlockedPath, isHardSecretPath, isLikelyBinary, isPotentialSecretPath } from "../../src/workspace/fileGuards";

describe("context and history guards", () => {
  it("enforces context size limits", () => {
    const result = evaluateContextLimits([
      { id: "1", kind: "file", path: "a.ts", language: "typescript", bytes: 300, tokenEstimate: 75, content: "x" }
    ], 200, 500);
    expect(result.ok).toBe(false);
  });

  it("detects blocked and secret filenames", () => {
    expect(isBlockedPath("node_modules/pkg/index.js")).toBe(true);
    expect(isHardSecretPath(".env.local")).toBe(true);
    expect(isHardSecretPath("id_rsa")).toBe(true);
    expect(isPotentialSecretPath("credentials.json")).toBe(true);
  });

  it("detects binary buffers", () => {
    expect(isLikelyBinary(new Uint8Array([1, 2, 0, 4]))).toBe(true);
  });

  it("recovers from broken conversation schema", () => {
    const data = validateConversationStoreData({ schemaVersion: 1, activeConversationId: "missing", conversations: "bad" });
    expect(data.conversations).toHaveLength(1);
    expect(data.activeConversationId).toBe(data.conversations[0]?.id);
  });
});
