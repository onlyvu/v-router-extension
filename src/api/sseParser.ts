import type { ChatToolCall } from "./types";

export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

export interface OpenAiStreamChunk {
  done: boolean;
  content: string;
  toolCallDeltas?: ChatToolCallDelta[];
  usage?: unknown;
}

export interface ChatToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  name?: string;
  arguments?: string;
}

export interface ParsedChatCompletion {
  content: string;
  toolCalls: ChatToolCall[];
  usage?: unknown;
}

export class SseParser {
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private eventName = "message";
  private dataLines: string[] = [];
  private id: string | undefined;

  public feed(chunk: Uint8Array): SseEvent[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.processBuffer(false);
  }

  public end(): SseEvent[] {
    this.buffer += this.decoder.decode();
    return this.processBuffer(true);
  }

  private processBuffer(flush: boolean): SseEvent[] {
    const events: SseEvent[] = [];
    for (;;) {
      const lineEnd = this.findLineEnd();
      if (lineEnd === -1) {
        break;
      }
      const rawLine = this.buffer.slice(0, lineEnd);
      const skip = this.buffer[lineEnd] === "\r" && this.buffer[lineEnd + 1] === "\n" ? 2 : 1;
      this.buffer = this.buffer.slice(lineEnd + skip);
      const event = this.processLine(rawLine.replace(/\r$/, ""));
      if (event !== null) {
        events.push(event);
      }
    }
    if (flush && this.buffer.length > 0) {
      const event = this.processLine(this.buffer.replace(/\r$/, ""));
      this.buffer = "";
      if (event !== null) {
        events.push(event);
      }
    }
    if (flush) {
      const pending = this.dispatch();
      if (pending !== null) {
        events.push(pending);
      }
    }
    return events;
  }

  private findLineEnd(): number {
    const lf = this.buffer.indexOf("\n");
    const cr = this.buffer.indexOf("\r");
    if (lf === -1) {
      return cr;
    }
    if (cr === -1) {
      return lf;
    }
    return Math.min(lf, cr);
  }

  private processLine(line: string): SseEvent | null {
    if (line.length === 0) {
      return this.dispatch();
    }
    if (line.startsWith(":")) {
      return null;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const rawValue = colon === -1 ? "" : line.slice(colon + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    switch (field) {
      case "event":
        this.eventName = value.length > 0 ? value : "message";
        break;
      case "data":
        this.dataLines.push(value);
        break;
      case "id":
        this.id = value;
        break;
      default:
        break;
    }
    return null;
  }

  private dispatch(): SseEvent | null {
    if (this.dataLines.length === 0) {
      this.eventName = "message";
      this.id = undefined;
      return null;
    }
    const event: SseEvent = {
      event: this.eventName,
      data: this.dataLines.join("\n")
    };
    if (this.id !== undefined) {
      event.id = this.id;
    }
    this.eventName = "message";
    this.dataLines = [];
    this.id = undefined;
    return event;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseOpenAiStreamData(data: string): OpenAiStreamChunk {
  if (data.trim() === "[DONE]") {
    return { done: true, content: "" };
  }
  const parsed: unknown = JSON.parse(data);
  if (!isRecord(parsed)) {
    return { done: false, content: "" };
  }
  const choices = parsed.choices;
  let content = "";
  const toolCallDeltas: ChatToolCallDelta[] = [];
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      if (!isRecord(choice)) {
        continue;
      }
      const delta = choice.delta;
      const message = choice.message;
      const deltaContent = isRecord(delta) && typeof delta.content === "string" ? delta.content : "";
      const messageContent = isRecord(message) && typeof message.content === "string" ? message.content : "";
      content += deltaContent + messageContent;
      const deltaToolCalls = isRecord(delta) && Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const toolCall of deltaToolCalls) {
        if (!isRecord(toolCall) || typeof toolCall.index !== "number") {
          continue;
        }
        const fn = isRecord(toolCall.function) ? toolCall.function : {};
        const parsedDelta: ChatToolCallDelta = { index: toolCall.index };
        const id = asString(toolCall.id);
        const type = toolCall.type === "function" ? "function" : undefined;
        const name = asString(fn.name);
        const args = asString(fn.arguments);
        if (id !== undefined) {
          parsedDelta.id = id;
        }
        if (type !== undefined) {
          parsedDelta.type = type;
        }
        if (name !== undefined) {
          parsedDelta.name = name;
        }
        if (args !== undefined) {
          parsedDelta.arguments = args;
        }
        toolCallDeltas.push(parsedDelta);
      }
    }
  }
  const usage = parsed.usage;
  const result: OpenAiStreamChunk = { done: false, content };
  if (toolCallDeltas.length > 0) {
    result.toolCallDeltas = toolCallDeltas;
  }
  if (usage !== undefined) {
    result.usage = usage;
  }
  return result;
}

export function parseNonStreamingChatCompletion(value: unknown): ParsedChatCompletion {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    return { content: "", toolCalls: [] };
  }
  const [first] = value.choices;
  if (!isRecord(first)) {
    return { content: "", toolCalls: [] };
  }
  const message = first.message;
  const usage = isRecord(value) ? value.usage : undefined;
  const toolCalls = isRecord(message) ? parseToolCalls(message.tool_calls) : [];
  let content = "";
  if (isRecord(message) && typeof message.content === "string") {
    content = message.content;
  } else if (typeof first.text === "string") {
    content = first.text;
  }
  return usage === undefined ? { content, toolCalls } : { content, toolCalls, usage };
}

export function mergeToolCallDeltas(existing: ChatToolCall[], deltas: ChatToolCallDelta[]): ChatToolCall[] {
  const next = existing.map((toolCall) => ({
    id: toolCall.id,
    type: toolCall.type,
    function: {
      name: toolCall.function.name,
      arguments: toolCall.function.arguments
    }
  }));
  for (const delta of deltas) {
    const current = next[delta.index] ?? {
      id: "",
      type: "function" as const,
      function: { name: "", arguments: "" }
    };
    if (delta.id !== undefined) {
      current.id = delta.id;
    }
    if (delta.type !== undefined) {
      current.type = delta.type;
    }
    if (delta.name !== undefined) {
      current.function.name += delta.name;
    }
    if (delta.arguments !== undefined) {
      current.function.arguments += delta.arguments;
    }
    next[delta.index] = current;
  }
  return next;
}

function parseToolCalls(value: unknown): ChatToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const calls: ChatToolCall[] = [];
  for (const item of value) {
    if (!isRecord(item) || item.type !== "function" || !isRecord(item.function)) {
      continue;
    }
    const id = asString(item.id);
    const name = asString(item.function.name);
    const args = asString(item.function.arguments);
    if (id === undefined || name === undefined) {
      continue;
    }
    calls.push({
      id,
      type: "function",
      function: {
        name,
        arguments: args ?? ""
      }
    });
  }
  return calls;
}
