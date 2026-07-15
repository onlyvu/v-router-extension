import type { ChatRole } from "../api/types";

export type ConversationMessageStatus = "complete" | "streaming" | "error" | "cancelled";
export type ChatMode = "agent" | "plan";
export type ChatAccessMode = "full" | "limited" | "ask";

export interface ConversationMessage {
  id: string;
  role: Exclude<ChatRole, "system" | "tool">;
  content: string;
  createdAt: string;
  status: ConversationMessageStatus;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
}

export type ContextKind = "selection" | "activeFile" | "file" | "diagnostics";

export interface ContextAttachment {
  id: string;
  kind: ContextKind;
  path: string;
  language: string;
  bytes: number;
  tokenEstimate: number;
  lineRange?: string;
  warning?: string;
}

export interface ResolvedContextAttachment extends ContextAttachment {
  content: string;
}

export interface ConversationStoreData {
  schemaVersion: 1;
  activeConversationId: string;
  conversations: Conversation[];
}

export interface ChatSendResult {
  conversationId: string;
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
}
