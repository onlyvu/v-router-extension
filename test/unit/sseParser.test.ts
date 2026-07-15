import { describe, expect, it } from "vitest";
import { mergeToolCallDeltas, parseNonStreamingChatCompletion, parseOpenAiStreamData, SseParser } from "../../src/api/sseParser";

const encoder = new TextEncoder();

describe("SseParser", () => {
  it("handles split chunks", () => {
    const parser = new SseParser();
    expect(parser.feed(encoder.encode("data: {\"a\""))).toEqual([]);
    expect(parser.feed(encoder.encode(":1}\n\n"))).toEqual([{ event: "message", data: "{\"a\":1}" }]);
  });

  it("handles Unicode Vietnamese content split across chunks", () => {
    const bytes = encoder.encode('data: {"choices":[{"delta":{"content":"Xin chào"}}]}\n\n');
    const parser = new SseParser();
    const first = bytes.slice(0, 43);
    const second = bytes.slice(43);
    expect(parser.feed(first)).toEqual([]);
    const events = parser.feed(second);
    expect(parseOpenAiStreamData(events[0]?.data ?? "").content).toBe("Xin chào");
  });

  it("supports CRLF, comments, multi-line data and DONE", () => {
    const parser = new SseParser();
    const events = parser.feed(encoder.encode(": ping\r\nevent: quota\r\ndata: {\"a\":1}\r\ndata: {\"b\":2}\r\n\r\ndata: [DONE]\r\n\r\n"));
    expect(events[0]).toEqual({ event: "quota", data: "{\"a\":1}\n{\"b\":2}" });
    expect(parseOpenAiStreamData(events[1]?.data ?? "").done).toBe(true);
  });

  it("parses non-streaming fallback response", () => {
    expect(parseNonStreamingChatCompletion({ choices: [{ message: { content: "Fallback" } }] })).toMatchObject({
      content: "Fallback",
      toolCalls: []
    });
  });

  it("parses non-streaming tool calls", () => {
    const parsed = parseNonStreamingChatCompletion({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "list_workspace", arguments: "{\"recursive\":true}" }
          }]
        }
      }]
    });
    expect(parsed.toolCalls[0]).toMatchObject({
      id: "call_1",
      function: { name: "list_workspace", arguments: "{\"recursive\":true}" }
    });
  });

  it("merges streaming tool call deltas", () => {
    const first = parseOpenAiStreamData('{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_file","arguments":"{\\"path\\""}}]}}]}');
    const second = parseOpenAiStreamData('{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"package.json\\"}"}}]}}]}');
    const calls = mergeToolCallDeltas(mergeToolCallDeltas([], first.toolCallDeltas ?? []), second.toolCallDeltas ?? []);
    expect(calls[0]).toMatchObject({
      id: "call_1",
      function: { name: "read_file", arguments: "{\"path\":\"package.json\"}" }
    });
  });
});
