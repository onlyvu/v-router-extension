import { describe, expect, it } from "vitest";
import { buildChatRequest } from "../../src/chat/ChatRequestBuilder";
import type { VRouterSettings } from "../../src/config/settings";

const settings: VRouterSettings = {
  serverOrigin: "https://v-router.fpt.ovh",
  defaultModel: "",
  systemPrompt: "",
  streaming: true,
  requestTimeoutMs: 120000,
  streamStallTimeoutMs: 60000,
  quotaCacheTtlMs: 20000,
  modelCacheTtlMs: 300000,
  autoAttachSelection: false,
  maxContextBytes: 512000,
  maxFileContextBytes: 204800,
  confirmBeforeApply: true,
  debugLogging: false,
  temperatureEnabled: false,
  temperature: 0.2,
  maxTokensEnabled: false,
  maxTokens: 4096
};

describe("ChatRequestBuilder", () => {
  it("adds the runtime policy prompt by default", () => {
    const payload = buildChatRequest({
      model: "gh/gpt-5.4",
      userText: "Hello",
      history: [],
      contexts: [],
      settings,
      chatMode: "agent",
      accessMode: "full"
    });
    expect(payload.messages[0]?.role).toBe("system");
    expect(payload.messages[0]?.content).toContain("Agent mode");
    expect(payload.messages[0]?.content).toContain("Full access");
    expect(payload.messages[1]).toEqual({ role: "user", content: "Hello" });
    expect(payload.tools?.map((tool) => tool.function.name)).toEqual(["list_workspace", "read_file", "search_workspace"]);
    expect(payload.tool_choice).toBe("auto");
  });

  it("appends configured system prompt after the runtime policy", () => {
    const payload = buildChatRequest({
      model: "gh/gpt-5.4",
      userText: "Hello",
      history: [],
      contexts: [],
      settings: { ...settings, systemPrompt: "Custom only" },
      chatMode: "plan",
      accessMode: "ask"
    });
    expect(payload.messages[0]?.content).toContain("Plan mode");
    expect(payload.messages[0]?.content).toContain("Always ask");
    expect(payload.messages[0]?.content).toContain("Custom only");
    expect(payload.tools).toBeUndefined();
  });

  it("puts context into the visible user message", () => {
    const payload = buildChatRequest({
      model: "gh/gpt-5.4",
      userText: "Explain",
      history: [],
      contexts: [{
        id: "ctx",
        kind: "file",
        path: "src/a.ts",
        language: "typescript",
        bytes: 9,
        tokenEstimate: 3,
        content: "const a=1"
      }],
      settings,
      chatMode: "agent",
      accessMode: "limited"
    });
    expect(payload.messages[1]?.content).toContain("[CONTEXT FILE]");
    expect(payload.messages[1]?.content).toContain("[USER MESSAGE]");
  });

  it("sends optional parameters only when enabled", () => {
    const payload = buildChatRequest({
      model: "gh/gpt-5.4",
      userText: "Hello",
      history: [],
      contexts: [],
      settings: { ...settings, temperatureEnabled: true, maxTokensEnabled: true },
      chatMode: "agent",
      accessMode: "full"
    });
    expect(payload.temperature).toBe(0.2);
    expect(payload.max_tokens).toBe(4096);
  });
});
