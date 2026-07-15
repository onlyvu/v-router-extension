import type * as vscode from "vscode";
import { CONVERSATION_STATE_KEY } from "../config/constants";
import type { Conversation, ConversationMessage, ConversationStoreData } from "./types";

const SCHEMA_VERSION = 1;
const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES_PER_CONVERSATION = 80;
const MAX_MESSAGE_CHARS = 80_000;

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function now(): string {
  return new Date().toISOString();
}

export function createConversation(title = "Chat mới"): Conversation {
  const timestamp = now();
  return {
    id: createId("conv"),
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: []
  };
}

export function createConversationMessage(role: "user" | "assistant", content: string, status: ConversationMessage["status"]): ConversationMessage {
  return {
    id: createId("msg"),
    role,
    content: content.slice(0, MAX_MESSAGE_CHARS),
    createdAt: now(),
    status
  };
}

function isConversationMessage(value: unknown): value is ConversationMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" &&
    (record.role === "user" || record.role === "assistant") &&
    typeof record.content === "string" &&
    typeof record.createdAt === "string" &&
    (record.status === "complete" || record.status === "streaming" || record.status === "error" || record.status === "cancelled");
}

function isConversation(value: unknown): value is Conversation {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    Array.isArray(record.messages) &&
    record.messages.every(isConversationMessage);
}

export function validateConversationStoreData(value: unknown): ConversationStoreData {
  if (typeof value !== "object" || value === null) {
    const conversation = createConversation();
    return { schemaVersion: SCHEMA_VERSION, activeConversationId: conversation.id, conversations: [conversation] };
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== SCHEMA_VERSION || typeof record.activeConversationId !== "string" || !Array.isArray(record.conversations)) {
    const conversation = createConversation();
    return { schemaVersion: SCHEMA_VERSION, activeConversationId: conversation.id, conversations: [conversation] };
  }
  const conversations = record.conversations
    .filter(isConversation)
    .slice(0, MAX_CONVERSATIONS)
    .map((conversation) => ({
      ...conversation,
      title: conversation.title.slice(0, 80),
      messages: conversation.messages
        .slice(-MAX_MESSAGES_PER_CONVERSATION)
        .map((message) => ({ ...message, content: message.content.slice(0, MAX_MESSAGE_CHARS) }))
    }));
  if (conversations.length === 0) {
    const conversation = createConversation();
    return { schemaVersion: SCHEMA_VERSION, activeConversationId: conversation.id, conversations: [conversation] };
  }
  const activeExists = conversations.some((conversation) => conversation.id === record.activeConversationId);
  return {
    schemaVersion: SCHEMA_VERSION,
    activeConversationId: activeExists ? record.activeConversationId : conversations[0]?.id ?? createConversation().id,
    conversations
  };
}

export class ConversationStore {
  private data: ConversationStoreData;

  public constructor(private readonly workspaceState: vscode.Memento) {
    this.data = validateConversationStoreData(this.workspaceState.get(CONVERSATION_STATE_KEY));
  }

  public getData(): ConversationStoreData {
    return this.data;
  }

  public getActiveConversation(): Conversation {
    const active = this.data.conversations.find((conversation) => conversation.id === this.data.activeConversationId);
    if (active !== undefined) {
      return active;
    }
    const conversation = createConversation();
    this.data = { schemaVersion: SCHEMA_VERSION, activeConversationId: conversation.id, conversations: [conversation] };
    return conversation;
  }

  public async save(): Promise<void> {
    this.data = validateConversationStoreData(this.data);
    await this.workspaceState.update(CONVERSATION_STATE_KEY, this.data);
  }

  public async newConversation(title?: string): Promise<Conversation> {
    const conversation = createConversation(title);
    this.data.conversations.unshift(conversation);
    this.data.conversations = this.data.conversations.slice(0, MAX_CONVERSATIONS);
    this.data.activeConversationId = conversation.id;
    await this.save();
    return conversation;
  }

  public async selectConversation(conversationId: string): Promise<Conversation | null> {
    const conversation = this.data.conversations.find((item) => item.id === conversationId);
    if (conversation === undefined) {
      return null;
    }
    this.data.activeConversationId = conversation.id;
    await this.save();
    return conversation;
  }

  public async appendMessage(conversationId: string, message: ConversationMessage): Promise<void> {
    const conversation = this.data.conversations.find((item) => item.id === conversationId);
    if (conversation === undefined) {
      return;
    }
    conversation.messages.push(message);
    conversation.messages = conversation.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
    conversation.updatedAt = now();
    if (conversation.title === "Chat mới" && message.role === "user") {
      const candidate = message.content.trim().slice(0, 48);
      conversation.title = candidate.length > 0 ? candidate : conversation.title;
    }
    await this.save();
  }

  public async updateMessage(conversationId: string, messageId: string, update: Partial<Pick<ConversationMessage, "content" | "status" | "error">>): Promise<void> {
    const conversation = this.data.conversations.find((item) => item.id === conversationId);
    const message = conversation?.messages.find((item) => item.id === messageId);
    if (conversation === undefined || message === undefined) {
      return;
    }
    if (update.content !== undefined) {
      message.content = update.content.slice(0, MAX_MESSAGE_CHARS);
    }
    if (update.status !== undefined) {
      message.status = update.status;
    }
    if (update.error !== undefined) {
      message.error = update.error;
    }
    conversation.updatedAt = now();
    await this.save();
  }

  public async clearActiveConversation(): Promise<Conversation> {
    const conversation = this.getActiveConversation();
    conversation.messages = [];
    conversation.updatedAt = now();
    await this.save();
    return conversation;
  }

  public async clearAll(): Promise<Conversation> {
    const conversation = createConversation();
    this.data = { schemaVersion: SCHEMA_VERSION, activeConversationId: conversation.id, conversations: [conversation] };
    await this.save();
    return conversation;
  }
}
