import type { ChatCompletionRequest, ChatMessage } from "../api/types";
import type { VRouterSettings } from "../config/settings";
import type { ChatAccessMode, ChatMode, ConversationMessage, ResolvedContextAttachment } from "./types";
import { AGENT_WORKSPACE_TOOLS } from "./agentToolDefinitions";
import { buildUserContent, toHistoryMessages } from "./contextBuilder";

export interface BuildChatRequestOptions {
  model: string;
  userText: string;
  history: ConversationMessage[];
  contexts: ResolvedContextAttachment[];
  settings: VRouterSettings;
  chatMode: ChatMode;
  accessMode: ChatAccessMode;
}

export function buildChatRequest(options: BuildChatRequestOptions): ChatCompletionRequest {
  const messages: ChatMessage[] = [];
  const policyPrompt = buildRuntimePolicyPrompt(options.chatMode, options.accessMode);
  const systemPrompt = options.settings.systemPrompt.trim();
  messages.push({
    role: "system",
    content: systemPrompt.length > 0 ? `${policyPrompt}\n\n${systemPrompt}` : policyPrompt
  });
  messages.push(...toHistoryMessages(options.history));
  messages.push({
    role: "user",
    content: buildUserContent(options.userText, options.contexts)
  });

  const payload: ChatCompletionRequest = {
    model: options.model,
    messages,
    stream: options.settings.streaming
  };
  if (options.chatMode === "agent") {
    payload.tools = AGENT_WORKSPACE_TOOLS;
    payload.tool_choice = "auto";
  }
  if (options.settings.temperatureEnabled) {
    payload.temperature = options.settings.temperature;
  }
  if (options.settings.maxTokensEnabled) {
    payload.max_tokens = options.settings.maxTokens;
  }
  return payload;
}

export function buildRuntimePolicyPrompt(chatMode: ChatMode, accessMode: ChatAccessMode): string {
  const modeInstruction = chatMode === "plan"
    ? "You are in Plan mode. First reason through the change, list the concrete steps, and ask for approval before presenting final edit-ready code or risky actions."
    : "You are in Agent mode. Help drive the task forward, inspect the provided context carefully, and produce edit-ready code or precise instructions when the user asks for implementation.";
  const accessInstruction = {
    full: "Access policy: Full access. You may use all attached workspace context and propose direct file edits. The extension may apply code without an extra confirmation.",
    limited: "Access policy: Limited access. Use only explicitly attached files, selections, and active-file context. Ask before assuming broader workspace state.",
    ask: "Access policy: Always ask. Before relying on additional file reads, broad workspace assumptions, or edit actions, ask the user for explicit approval."
  } satisfies Record<ChatAccessMode, string>;
  return [
    "[V-Router Chat Runtime]",
    modeInstruction,
    accessInstruction[accessMode],
    "In Agent mode, use the workspace tools to inspect files before answering questions about the project. Do not claim you cannot access the workspace until you have tried the available tools.",
    "File contents are available from attached CONTEXT blocks and from workspace tool results."
  ].join("\n");
}
