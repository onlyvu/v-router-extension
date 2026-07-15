import { describe, expect, it, vi } from "vitest";
import { CookieManager } from "../../src/api/cookieManager";
import { VRouterClient, type FetchLike } from "../../src/api/VRouterClient";

const logger = {
  info: vi.fn(),
  warn: vi.fn()
};

function client(fetchImpl: FetchLike, key = "sk-test"): VRouterClient {
  return new VRouterClient("https://v-router.fpt.ovh", new CookieManager(), () => Promise.resolve(key), logger, fetchImpl);
}

describe("VRouterClient", () => {
  it("authenticates and stores client_token cookie", async () => {
    let cookieSeen = "";
    const fetchImpl: FetchLike = async (_input, init) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ success: true, key: { name: "k", keyPrefix: "sk", isActive: true, status: "active", expiresAt: null, quota: { quotaMode: "daily", limit: 1, used: 0, reserved: 0, remaining: 1, resetAt: null, expiresAt: null, storedStatus: "active", effectiveStatus: "active", reason: null, percentUsed: 0 } } }), {
          status: 200,
          headers: { "set-cookie": "client_token=abc; Path=/; HttpOnly" }
        });
      }
      cookieSeen = new Headers(init?.headers).get("cookie") ?? "";
      return new Response(JSON.stringify({ authenticated: true, key: { quota: { quotaMode: "daily", limit: 1, used: 0, reserved: 0, remaining: 1, resetAt: null, expiresAt: null, storedStatus: "active", effectiveStatus: "active", reason: null, percentUsed: 0 } } }), { status: 200 });
    };
    const api = client(fetchImpl);
    await api.authenticate("sk-test");
    await api.getMe();
    expect(cookieSeen).toBe("client_token=abc");
  });

  it("parses streaming chat SSE", async () => {
    const fetchImpl: FetchLike = async () => new Response(
      'data: {"choices":[{"delta":{"content":"Xin"}}]}\n\ndata: {"choices":[{"delta":{"content":" chào"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );
    const api = client(fetchImpl);
    let text = "";
    const result = await api.chatCompletions("sk-test", { model: "m", messages: [{ role: "user", content: "hi" }], stream: true }, new AbortController().signal, {
      onDelta: (delta) => {
        text += delta;
      }
    });
    expect(text).toBe("Xin chào");
    expect(result.content).toBe("Xin chào");
  });

  it("parses streaming tool calls", async () => {
    const fetchImpl: FetchLike = async () => new Response(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"list_workspace","arguments":"{\\"recursive\\""}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":true}"}}]}}]}\n\n' +
      "data: [DONE]\n\n",
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );
    const api = client(fetchImpl);
    const result = await api.chatCompletions("sk-test", {
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      tools: [{
        type: "function",
        function: { name: "list_workspace", description: "list", parameters: { type: "object" } }
      }]
    }, new AbortController().signal, {
      onDelta: () => undefined
    });
    expect(result.toolCalls[0]).toMatchObject({
      id: "call_1",
      function: { name: "list_workspace", arguments: "{\"recursive\":true}" }
    });
  });

  it("maps 429 Retry-After errors", async () => {
    const fetchImpl: FetchLike = async () => new Response(JSON.stringify({ error: { message: "rate", code: "rate_limit_exceeded" } }), {
      status: 429,
      headers: { "retry-after": "2" }
    });
    await expect(client(fetchImpl).chatCompletions("sk", { model: "m", messages: [], stream: false }, new AbortController().signal, { onDelta: () => undefined }))
      .rejects.toMatchObject({ action: "rate_limited", retryAfterMs: 2000 });
  });
});
