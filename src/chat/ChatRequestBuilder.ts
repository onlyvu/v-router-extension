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
  const modeInstruction = {
    chat: "You are in Chat mode. Answer conversationally using only the user's message and explicitly attached context. Do not call workspace tools and do not propose direct file edits unless the user switches mode.",
    edit: "You are in Edit mode. Help prepare focused code changes for user-selected files or attached context. Prefer reviewable diffs and do not run terminal commands.",
    agent: "You are in Agent mode. Drive the task forward with structured tool calls, inspect workspace state before making claims about code, create or edit files with workspace edit tools when requested, and summarize verifiable actions."
  } satisfies Record<ChatMode, string>;
  const accessInstruction = {
    read_only: "Permission policy: read_only. You may inspect non-sensitive workspace information through tools, but must not request file edits, deletes, renames, or terminal execution.",
    review_edits: "Permission policy: review_edits. You may request workspace edits through tools, but the extension must ask for approval before applying them.",
    auto_apply_safe: "Permission policy: auto_apply_safe. Safe file create/modify/append edits may be applied by tools; deletes, renames, and terminal commands still require approval.",
    full_agent: "Permission policy: full_agent. You may use all enabled tools within workspace boundaries, while still respecting sensitive-file and dangerous-command guards."
  } satisfies Record<ChatAccessMode, string>;
  return [
    "[V-Router Chat Runtime]",
    modeInstruction[chatMode],
    accessInstruction[accessMode],
    "Use only the structured tools supplied by V-Router Smart. Wait for tool results before claiming a tool succeeded.",
    "Do not impersonate Codex, Claude, Copilot, or any other product.",
    "Read a file and verify its current content before proposing changes to that file.",
    "Do not request dangerous commands. Do not access paths outside the workspace.",
    "In Agent mode, use workspace tools to inspect files before answering questions about the project. Do not claim you cannot access the workspace until you have tried the available tools.",
    "In Agent mode, when the user asks to create, modify, append, delete, or rename files, call create_file, modify_file, append_file, delete_file, or rename_file instead of telling the user to run shell commands.",
    "Never claim you cannot write files while a workspace edit tool is available. If a tool fails, report the actual tool error and choose the next safest tool-based step.",
    "File contents are available from attached CONTEXT blocks and from workspace tool results."
  ].join("\n");
}
