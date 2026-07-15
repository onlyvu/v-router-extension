import { createUrlBuilder, type UrlBuilder } from "./urlBuilder";
import type { CookieManager } from "./cookieManager";
import { errorFromResponse } from "./errorMapper";
import { mergeToolCallDeltas, parseNonStreamingChatCompletion, parseOpenAiStreamData, SseParser } from "./sseParser";
import type {
  AuthSuccessResponse,
  ChatCompletionRequest,
  ChatToolCall,
  ClientMeResponse,
  ModelsResponse,
  RequestInspectorSnapshot,
  UsageResponse
} from "./types";
import { redactHeaders } from "../logging/redaction";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ChatStreamHandlers {
  onDelta(delta: string): void;
  onUsage?(usage: unknown): void;
  onActivity?(): void;
}

export interface ChatCompletionResult {
  content: string;
  toolCalls: ChatToolCall[];
  usage?: unknown;
}

export interface ClientLogger {
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
}

export class VRouterClient {
  private builder: UrlBuilder;
  private lastRequest: RequestInspectorSnapshot | null = null;

  public constructor(
    serverOrigin: string,
    private readonly cookieManager: CookieManager,
    private readonly getApiKey: () => Promise<string | null>,
    private readonly logger: ClientLogger,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    this.builder = createUrlBuilder(serverOrigin);
  }

  public updateServerOrigin(serverOrigin: string): void {
    this.builder = createUrlBuilder(serverOrigin);
    this.cookieManager.clear();
  }

  public clearSession(): void {
    this.cookieManager.clear();
  }

  public get serverOrigin(): string {
    return this.builder.serverOrigin;
  }

  public getLastRequest(): RequestInspectorSnapshot | null {
    return this.lastRequest;
  }

  public async authenticate(apiKey: string, signal?: AbortSignal): Promise<AuthSuccessResponse> {
    const url = this.builder.buildServerUrl("/api/client/auth");
    this.logger.info("Auth request", { path: "/api/client/auth" });
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: apiKey.trim() }),
      signal: signal ?? null
    });
    this.cookieManager.updateFromHeaders(response.headers);
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    const json = await response.json() as AuthSuccessResponse;
    return json;
  }

  public async getMe(signal?: AbortSignal): Promise<ClientMeResponse> {
    return this.clientJson<ClientMeResponse>("/api/client/me", { method: "GET", signal: signal ?? null }, true);
  }

  public async getUsage(days = 7, signal?: AbortSignal): Promise<UsageResponse> {
    const safeDays = Math.min(60, Math.max(1, Math.floor(days)));
    return this.clientJson<UsageResponse>(`/api/client/usage?days=${safeDays}`, { method: "GET", signal: signal ?? null }, true);
  }

  public async getModels(apiKey: string, signal?: AbortSignal): Promise<ModelsResponse> {
    try {
      const response = await this.fetchImpl(this.builder.buildOpenAIUrl("/models"), {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}` },
        signal: signal ?? null
      });
      if (!response.ok) {
        throw await errorFromResponse(response);
      }
      return await response.json() as ModelsResponse;
    } catch (error) {
      this.logger.warn("OpenAI models endpoint failed, fallback to client models", error);
      return this.getClientModels(signal);
    }
  }

  public async getClientModels(signal?: AbortSignal): Promise<ModelsResponse> {
    return this.clientJson<ModelsResponse>("/api/client/models", { method: "GET", signal: signal ?? null }, true);
  }

  public async streamQuota(
    signal: AbortSignal,
    onEvent: (event: string, data: unknown) => void
  ): Promise<void> {
    const response = await this.clientFetch("/api/client/stream", {
      method: "GET",
      headers: { accept: "text/event-stream" },
      signal
    }, true);
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    if (response.body === null) {
      return;
    }
    const reader = response.body.getReader();
    const parser = new SseParser();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        for (const event of parser.end()) {
          onEvent(event.event, JSON.parse(event.data) as unknown);
        }
        break;
      }
      for (const event of parser.feed(value)) {
        if (event.data.trim().length > 0) {
          onEvent(event.event, JSON.parse(event.data) as unknown);
        }
      }
    }
  }

  public async chatCompletions(
    apiKey: string,
    payload: ChatCompletionRequest,
    signal: AbortSignal,
    handlers: ChatStreamHandlers
  ): Promise<ChatCompletionResult> {
    const url = this.builder.buildOpenAIUrl("/chat/completions");
    const headers = {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: payload.stream ? "text/event-stream" : "application/json"
    };
    this.lastRequest = {
      url,
      method: "POST",
      headers: redactHeaders(headers),
      body: payload,
      createdAt: new Date().toISOString()
    };
    this.logger.info("Chat completions request", { path: "/v1/chat/completions", model: payload.model });
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal
    });
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!payload.stream || contentType.includes("application/json") || response.body === null) {
      const json = await response.json() as unknown;
      const result = parseNonStreamingChatCompletion(json);
      if (result.content.length > 0) {
        handlers.onDelta(result.content);
      }
      return result;
    }
    return this.readOpenAiStream(response.body, handlers);
  }

  private async readOpenAiStream(
    body: ReadableStream<Uint8Array>,
    handlers: ChatStreamHandlers
  ): Promise<ChatCompletionResult> {
    const reader = body.getReader();
    const parser = new SseParser();
    let content = "";
    let toolCalls: ChatToolCall[] = [];
    let usage: unknown;
    let doneSeen = false;
    const processData = (data: string): void => {
      const parsed = parseOpenAiStreamData(data);
      if (parsed.usage !== undefined) {
        usage = parsed.usage;
        handlers.onUsage?.(parsed.usage);
      }
      if (parsed.toolCallDeltas !== undefined) {
        toolCalls = mergeToolCallDeltas(toolCalls, parsed.toolCallDeltas);
      }
      if (parsed.done) {
        doneSeen = true;
        return;
      }
      if (parsed.content.length > 0) {
        content += parsed.content;
        handlers.onDelta(parsed.content);
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        for (const event of parser.end()) {
          processData(event.data);
        }
        break;
      }
      handlers.onActivity?.();
      for (const event of parser.feed(value)) {
        processData(event.data);
        if (doneSeen) {
          break;
        }
      }
      if (doneSeen) {
        break;
      }
    }
    return usage === undefined ? { content, toolCalls } : { content, toolCalls, usage };
  }

  private async clientJson<T>(path: string, init: RequestInit, retryAuth: boolean): Promise<T> {
    const response = await this.clientFetch(path, init, retryAuth);
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    return await response.json() as T;
  }

  private async clientFetch(path: string, init: RequestInit, retryAuth: boolean): Promise<Response> {
    const cookie = this.cookieManager.getCookieHeader();
    const headers = new Headers(init.headers);
    if (cookie !== null) {
      headers.set("cookie", cookie);
    }
    const response = await this.fetchImpl(this.builder.buildServerUrl(path), {
      ...init,
      headers
    });
    this.cookieManager.updateFromHeaders(response.headers);
    if (response.status !== 401 || !retryAuth) {
      return response;
    }
    const apiKey = await this.getApiKey();
    if (apiKey === null) {
      return response;
    }
    this.logger.info("Client API returned 401, re-authenticating once", { path });
    await this.authenticate(apiKey, init.signal ?? undefined);
    const retriedHeaders = new Headers(init.headers);
    const retriedCookie = this.cookieManager.getCookieHeader();
    if (retriedCookie !== null) {
      retriedHeaders.set("cookie", retriedCookie);
    }
    const retried = await this.fetchImpl(this.builder.buildServerUrl(path), {
      ...init,
      headers: retriedHeaders
    });
    this.cookieManager.updateFromHeaders(retried.headers);
    return retried;
  }
}
