import type { ClientKeyInfo, ModelEntry, QuotaSnapshot, UsageResponse } from "./api/types";
import type { ChatAccessMode, ChatMode, Conversation, ConversationMessage, ContextAttachment } from "./chat/types";

export interface WebviewInitState {
  surface: WebviewSurface;
  serverOrigin: string;
  auth: AuthViewState;
  models: ModelEntry[];
  selectedModel: string;
  quota: QuotaSnapshot | null;
  usage: UsageResponse | null;
  conversations: Conversation[];
  activeConversationId: string;
  context: ContextAttachment[];
  isStreaming: boolean;
  chatMode: ChatMode;
  accessMode: ChatAccessMode;
}

export type WebviewSurface = "admin" | "chat";

export interface AuthViewState {
  hasKey: boolean;
  keyPrefix: string | null;
  keyName: string | null;
  status: string;
  message: string;
}

export type InboundMessage =
  | { type: "webview:ready" }
  | { type: "auth:save"; apiKey: string }
  | { type: "auth:remove" }
  | { type: "auth:validate"; apiKey?: string }
  | { type: "chat:send"; text: string }
  | { type: "chat:stop" }
  | { type: "chat:new" }
  | { type: "chat:select"; conversationId: string }
  | { type: "chat:clear" }
  | { type: "chat:clearAll" }
  | { type: "chat:delete"; conversationId: string }
  | { type: "chat:setMode"; mode: ChatMode }
  | { type: "chat:setAccess"; accessMode: ChatAccessMode }
  | { type: "model:select"; modelId: string }
  | { type: "model:refresh" }
  | { type: "quota:refresh" }
  | { type: "usage:load" }
  | { type: "context:attachSelection" }
  | { type: "context:attachActiveFile" }
  | { type: "context:chooseFiles" }
  | { type: "context:openMenu" }
  | { type: "context:attachImage"; name: string; mimeType: string; dataUri: string; bytes: number }
  | { type: "context:remove"; id: string }
  | { type: "context:clear" }
  | { type: "code:copy"; code: string }
  | { type: "code:insert"; code: string }
  | { type: "code:replace"; code: string }
  | { type: "code:open"; code: string; language?: string }
  | { type: "link:open"; href: string }
  | { type: "chat:open" }
  | { type: "settings:open" }
  | { type: "history:open" }
  | { type: "request:showLast" };

export type OutboundMessage =
  | { type: "state:init"; state: WebviewInitState }
  | { type: "auth:status"; auth: AuthViewState; key?: ClientKeyInfo }
  | { type: "model:list"; models: ModelEntry[]; selectedModel: string }
  | { type: "quota:update"; quota: QuotaSnapshot | null }
  | { type: "usage:update"; usage: UsageResponse | null }
  | { type: "chat:conversation"; conversation: Conversation }
  | { type: "chat:message"; conversationId: string; message: ConversationMessage }
  | { type: "chat:started"; conversationId: string; assistantMessageId: string }
  | { type: "chat:delta"; conversationId: string; messageId: string; delta: string }
  | { type: "chat:completed"; conversationId: string; messageId: string; usage?: unknown }
  | { type: "chat:cancelled"; conversationId: string; messageId: string }
  | { type: "chat:error"; conversationId?: string; messageId?: string; message: string; code?: string }
  | { type: "context:update"; context: ContextAttachment[] }
  | { type: "composer:setText"; text: string }
  | { type: "notification"; level: "info" | "warning" | "error"; message: string }
  | { type: "settings:update"; serverOrigin: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isChatMode(value: unknown): value is ChatMode {
  return value === "chat" || value === "edit" || value === "agent";
}

function isChatAccessMode(value: unknown): value is ChatAccessMode {
  return value === "read_only" || value === "review_edits" || value === "auto_apply_safe" || value === "full_agent";
}

function isSafeImageDataUri(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\r\n]+$/i.test(value);
}

export function parseInboundMessage(value: unknown): InboundMessage | null {
  if (!isRecord(value) || !isString(value.type)) {
    return null;
  }
  switch (value.type) {
    case "webview:ready":
    case "auth:remove":
    case "chat:stop":
    case "chat:new":
    case "chat:clear":
    case "chat:clearAll":
    case "model:refresh":
    case "quota:refresh":
    case "usage:load":
    case "context:attachSelection":
    case "context:attachActiveFile":
    case "context:chooseFiles":
    case "context:openMenu":
    case "context:clear":
    case "chat:open":
    case "settings:open":
    case "history:open":
    case "request:showLast":
      return { type: value.type };
    case "auth:save":
      return isString(value.apiKey) ? { type: value.type, apiKey: value.apiKey } : null;
    case "auth:validate":
      if (value.apiKey === undefined) {
        return { type: value.type };
      }
      return isString(value.apiKey) ? { type: value.type, apiKey: value.apiKey } : null;
    case "chat:send":
      return isString(value.text) ? { type: value.type, text: value.text } : null;
    case "chat:setMode":
      return isChatMode(value.mode) ? { type: value.type, mode: value.mode } : null;
    case "chat:setAccess":
      return isChatAccessMode(value.accessMode) ? { type: value.type, accessMode: value.accessMode } : null;
    case "chat:select":
      return isString(value.conversationId) ? { type: value.type, conversationId: value.conversationId } : null;
    case "chat:delete":
      return isString(value.conversationId) ? { type: value.type, conversationId: value.conversationId } : null;
    case "model:select":
      return isString(value.modelId) ? { type: value.type, modelId: value.modelId } : null;
    case "context:attachImage":
      return isString(value.name) &&
        isString(value.mimeType) &&
        isSafeImageDataUri(value.dataUri) &&
        typeof value.bytes === "number" &&
        Number.isFinite(value.bytes) &&
        value.bytes > 0
        ? {
          type: value.type,
          name: value.name,
          mimeType: value.mimeType,
          dataUri: value.dataUri,
          bytes: Math.floor(value.bytes)
        }
        : null;
    case "context:remove":
      return isString(value.id) ? { type: value.type, id: value.id } : null;
    case "code:copy":
    case "code:insert":
    case "code:replace":
      return isString(value.code) ? { type: value.type, code: value.code } : null;
    case "code:open":
      if (!isString(value.code)) {
        return null;
      }
      if (value.language === undefined) {
        return { type: value.type, code: value.code };
      }
      return isString(value.language) ? { type: value.type, code: value.code, language: value.language } : null;
    case "link:open":
      return isString(value.href) ? { type: value.type, href: value.href } : null;
    default:
      return null;
  }
}
