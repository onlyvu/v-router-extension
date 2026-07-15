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
  maxTokens: 4096,
  defaultMode: "chat",
  agentEnabled: true,
  agentPermissionMode: "review_edits",
  agentMaxIterations: 30,
  agentMaxToolCalls: 100,
  agentMaxDurationMinutes: 30,
  agentAutoApplySafeEdits: false,
  agentConfirmFileCreate: true,
  agentConfirmFileDelete: true,
  agentConfirmFileRename: true,
  agentTerminalEnabled: false,
  agentTaskExecutionEnabled: true,
  agentCheckpointsEnabled: true,
  agentCheckpointRetention: 50,
  agentHistoryRetentionDays: 30,
  agentMaxSnapshotStorageMb: 500,
  agentShowToolTimeline: true,
  agentShowPlan: true,
  agentContextCompactionEnabled: true,
  agentRequireApprovalForSensitiveFiles: true
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
      accessMode: "full_agent"
    });
    expect(payload.messages[0]?.role).toBe("system");
    expect(payload.messages[0]?.content).toContain("Agent mode");
    expect(payload.messages[0]?.content).toContain("full_agent");
    expect(payload.messages[1]).toEqual({ role: "user", content: "Hello" });
    expect(payload.tools?.map((tool) => tool.function.name)).toContain("list_directory");
    expect(payload.tools?.map((tool) => tool.function.name)).toContain("read_file");
    expect(payload.tools?.map((tool) => tool.function.name)).toContain("get_diagnostics");
    expect(payload.tools?.map((tool) => tool.function.name)).toContain("create_file");
    expect(payload.tools?.map((tool) => tool.function.name)).toContain("modify_file");
    expect(payload.messages[0]?.content).toContain("call create_file");
    expect(payload.tool_choice).toBe("auto");
  });

  it("appends configured system prompt after the runtime policy", () => {
    const payload = buildChatRequest({
      model: "gh/gpt-5.4",
      userText: "Hello",
      history: [],
      contexts: [],
      settings: { ...settings, systemPrompt: "Custom only" },
      chatMode: "edit",
      accessMode: "review_edits"
    });
    expect(payload.messages[0]?.content).toContain("Edit mode");
    expect(payload.messages[0]?.content).toContain("review_edits");
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
      accessMode: "read_only"
    });
    expect(payload.messages[1]?.content).toContain("[CONTEXT FILE]");
    expect(payload.messages[1]?.content).toContain("[USER MESSAGE]");
  });

  it("sends pasted images as OpenAI-compatible multimodal content", () => {
    const payload = buildChatRequest({
      model: "gh/gpt-5.4",
      userText: "Describe this",
      history: [],
      contexts: [{
        id: "img",
        kind: "image",
        path: "pasted-image.png",
        language: "image",
        bytes: 1200,
        tokenEstimate: 0,
        mimeType: "image/png",
        previewDataUri: "data:image/png;base64,aaaa",
        content: "data:image/png;base64,aaaa"
      }],
      settings,
      chatMode: "chat",
      accessMode: "review_edits"
    });
    expect(Array.isArray(payload.messages[1]?.content)).toBe(true);
    const content = payload.messages[1]?.content;
    expect(content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image_url", image_url: expect.objectContaining({ url: "data:image/png;base64,aaaa" }) })
    ]));
  });

  it("sends optional parameters only when enabled", () => {
    const payload = buildChatRequest({
      model: "gh/gpt-5.4",
      userText: "Hello",
      history: [],
      contexts: [],
      settings: { ...settings, temperatureEnabled: true, maxTokensEnabled: true },
      chatMode: "agent",
      accessMode: "full_agent"
    });
    expect(payload.temperature).toBe(0.2);
    expect(payload.max_tokens).toBe(4096);
  });
});
