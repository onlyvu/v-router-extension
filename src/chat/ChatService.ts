import { VRouterApiError } from "../api/ApiError";
import type { VRouterClient } from "../api/VRouterClient";
import type { ChatCompletionRequest, ChatMessage, ChatToolCall, UsageResponse } from "../api/types";
import type { ApiKeyService } from "../auth/ApiKeyService";
import type { VRouterSettings } from "../config/settings";
import type { Logger } from "../logging/logger";
import type { ModelService } from "../models/ModelService";
import { evaluateQuota } from "../quota/QuotaGate";
import type { QuotaService } from "../quota/QuotaService";
import { buildChatRequest } from "./ChatRequestBuilder";
import type { ChatAccessMode, ChatMode, Conversation, ConversationMessage, ResolvedContextAttachment } from "./types";
import type { ConversationStore } from "./conversationStore";
import { createConversationMessage } from "./conversationStore";

export interface AgentToolExecutor {
  execute(
    toolCall: ChatToolCall,
    options: { settings: VRouterSettings; accessMode: ChatAccessMode; signal: AbortSignal }
  ): Promise<string>;
}

export interface ChatCallbacks {
  onUserMessage(message: ConversationMessage): void;
  onAssistantMessage(message: ConversationMessage): void;
  onDelta(messageId: string, delta: string): void;
  onCompleted(message: ConversationMessage, usage?: unknown): void;
  onCancelled(message: ConversationMessage): void;
  onError(message: ConversationMessage | null, error: Error): void;
}

export class ChatService {
  private activeController: AbortController | null = null;
  private activeAssistant: { conversationId: string; message: ConversationMessage } | null = null;

  public constructor(
    private readonly client: VRouterClient,
    private readonly apiKeyService: ApiKeyService,
    private readonly modelService: ModelService,
    private readonly quotaService: QuotaService,
    private readonly conversationStore: ConversationStore,
    private readonly logger: Logger,
    private readonly agentToolExecutor: AgentToolExecutor
  ) {}

  public get isStreaming(): boolean {
    return this.activeController !== null;
  }

  public async send(
    text: string,
    selectedModel: string,
    contexts: ResolvedContextAttachment[],
    settings: VRouterSettings,
    chatMode: ChatMode,
    accessMode: ChatAccessMode,
    callbacks: ChatCallbacks
  ): Promise<{ conversation: Conversation; usage?: UsageResponse }> {
    if (this.activeController !== null) {
      throw new Error("Đang có request khác. Hãy bấm Dừng trước khi gửi tiếp.");
    }
    const apiKey = await this.apiKeyService.getApiKey();
    if (apiKey === null || apiKey.trim().length === 0) {
      throw new Error("Vui lòng nhập API key trước khi gửi.");
    }
    if (selectedModel.length === 0) {
      throw new Error("Vui lòng chọn model hợp lệ.");
    }

    const quota = await this.quotaService.getQuota(settings);
    const decision = evaluateQuota(quota);
    if (!decision.allowed) {
      throw new Error(decision.message);
    }

    const conversation = this.conversationStore.getActiveConversation();
    const history = conversation.messages.filter((message) => message.status === "complete");
    const payload = buildChatRequest({
      model: selectedModel,
      userText: text,
      history,
      contexts,
      settings,
      chatMode,
      accessMode
    });
    const userMessage = createConversationMessage("user", text, "complete");
    const assistantMessage = createConversationMessage("assistant", "", "streaming");
    await this.conversationStore.appendMessage(conversation.id, userMessage);
    await this.conversationStore.appendMessage(conversation.id, assistantMessage);
    callbacks.onUserMessage(userMessage);
    callbacks.onAssistantMessage(assistantMessage);

    const controller = new AbortController();
    this.activeController = controller;
    this.activeAssistant = { conversationId: conversation.id, message: assistantMessage };
    let receivedContent = "";
    let usage: unknown;
    let requestTimer: ReturnType<typeof setTimeout> | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const abortForTimeout = (message: string): void => {
      if (!controller.signal.aborted) {
        controller.abort(new Error(message));
      }
    };
    const clearTimers = (): void => {
      if (requestTimer !== null) {
        clearTimeout(requestTimer);
      }
      if (stallTimer !== null) {
        clearTimeout(stallTimer);
      }
    };
    const resetStallTimer = (): void => {
      if (stallTimer !== null) {
        clearTimeout(stallTimer);
      }
      stallTimer = setTimeout(() => abortForTimeout("Stream không nhận dữ liệu mới quá lâu."), settings.streamStallTimeoutMs);
    };

    requestTimer = setTimeout(() => abortForTimeout("Request quá thời gian chờ."), settings.requestTimeoutMs);
    resetStallTimer();
    try {
      usage = await this.runAgentLoop(apiKey, payload, controller, settings, accessMode, assistantMessage, {
        onDelta: (delta) => {
          receivedContent += delta;
          callbacks.onDelta(assistantMessage.id, delta);
        },
        onUsage: (nextUsage) => {
          usage = nextUsage;
        },
        onActivity: resetStallTimer
      });
      const finalContent = receivedContent;
      assistantMessage.content = finalContent;
      assistantMessage.status = "complete";
      await this.conversationStore.updateMessage(conversation.id, assistantMessage.id, {
        content: finalContent,
        status: "complete"
      });
      callbacks.onCompleted(assistantMessage, usage);
      return { conversation };
    } catch (error) {
      const normalized = normalizeError(error);
      if (isAbortError(error)) {
        assistantMessage.content = receivedContent;
        assistantMessage.status = "cancelled";
        await this.conversationStore.updateMessage(conversation.id, assistantMessage.id, {
          content: receivedContent,
          status: "cancelled"
        });
        callbacks.onCancelled(assistantMessage);
        this.logger.info("Streaming cancelled", { model: selectedModel });
        return { conversation };
      }
      if (error instanceof VRouterApiError && (error.code === "model_not_allowed" || error.code === "model_not_found")) {
        this.modelService.invalidate();
      }
      assistantMessage.content = receivedContent;
      assistantMessage.status = "error";
      assistantMessage.error = normalized.message;
      await this.conversationStore.updateMessage(conversation.id, assistantMessage.id, {
        content: receivedContent,
        status: "error",
        error: normalized.message
      });
      callbacks.onError(assistantMessage, normalized);
      throw normalized;
    } finally {
      clearTimers();
      this.activeController = null;
      this.activeAssistant = null;
    }
  }

  public stop(): void {
    this.activeController?.abort(new Error("Người dùng đã dừng request."));
  }

  public dispose(): void {
    this.stop();
  }

  private async runAgentLoop(
    apiKey: string,
    payload: ChatCompletionRequest,
    controller: AbortController,
    settings: VRouterSettings,
    accessMode: ChatAccessMode,
    assistantMessage: ConversationMessage,
    handlers: {
      onDelta(delta: string): void;
      onUsage(usage: unknown): void;
      onActivity(): void;
    }
  ): Promise<unknown> {
    let usage: unknown;
    const messages: ChatMessage[] = [...payload.messages];
    const maxToolRounds = payload.tools === undefined ? 0 : settings.agentMaxIterations;
    const maxToolCalls = settings.agentMaxToolCalls;
    const deadline = Date.now() + settings.agentMaxDurationMinutes * 60_000;
    const seenToolCalls = new Map<string, number>();
    let totalToolCalls = 0;
    for (let round = 0; round <= maxToolRounds; round += 1) {
      if (Date.now() > deadline) {
        throw new Error("Agent exceeded the configured maximum duration.");
      }
      const result = await this.client.chatCompletions(apiKey, { ...payload, messages }, controller.signal, {
        onDelta: handlers.onDelta,
        onUsage: (nextUsage) => {
          usage = nextUsage;
          handlers.onUsage(nextUsage);
        },
        onActivity: handlers.onActivity
      });
      if (result.usage !== undefined) {
        usage = result.usage;
      }
      const toolCalls = result.toolCalls.filter((toolCall) => toolCall.id.length > 0 && toolCall.function.name.length > 0);
      if (toolCalls.length === 0) {
        return usage;
      }
      if (round === maxToolRounds) {
        throw new Error("Agent tool loop exceeded the maximum number of rounds.");
      }
      totalToolCalls += toolCalls.length;
      if (totalToolCalls > maxToolCalls) {
        throw new Error("Agent exceeded the configured maximum number of tool calls.");
      }
      messages.push({
        role: "assistant",
        content: result.content.length > 0 ? result.content : null,
        tool_calls: toolCalls
      });
      for (const toolCall of toolCalls) {
        const signature = `${toolCall.function.name}:${toolCall.function.arguments}`;
        const seenCount = seenToolCalls.get(signature) ?? 0;
        if (seenCount >= 2) {
          throw new Error(`Agent repeated the same tool call too many times: ${toolCall.function.name}`);
        }
        seenToolCalls.set(signature, seenCount + 1);
        handlers.onActivity();
        this.logger.info("Executing workspace tool", { name: toolCall.function.name });
        const toolResult = await this.agentToolExecutor.execute(toolCall, {
          settings,
          accessMode,
          signal: controller.signal
        });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResult
        });
      }
    }
    return usage;
  }
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  return false;
}
