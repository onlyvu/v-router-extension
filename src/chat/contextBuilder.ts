import type { ChatMessage } from "../api/types";
import type { ResolvedContextAttachment } from "./types";
import { estimateTokens } from "./tokenEstimate";

export interface ContextLimitResult {
  ok: boolean;
  totalBytes: number;
  totalTokens: number;
  error?: string;
}

const MAX_IMAGE_CONTEXT_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_CONTEXTS = 6;

export function formatContextAttachment(context: ResolvedContextAttachment): string {
  if (context.kind === "image") {
    return `[CONTEXT IMAGE]
Path: ${context.path}
MIME: ${context.mimeType ?? "image"}
Bytes: ${context.bytes}
[/CONTEXT IMAGE]`;
  }
  const label = context.kind === "selection" ? "CONTEXT SELECTION" : context.kind === "diagnostics" ? "CONTEXT DIAGNOSTICS" : "CONTEXT FILE";
  const line = context.lineRange === undefined ? "" : `Lines: ${context.lineRange}\n`;
  return `[${label}]
Path: ${context.path}
Language: ${context.language}
${line}
\`\`\`${context.language}
${context.content}
\`\`\`
[/${label}]`;
}

export function buildUserContent(userText: string, contexts: ResolvedContextAttachment[]): ChatMessage["content"] {
  if (contexts.length === 0) {
    return userText;
  }
  const imageContexts = contexts.filter((context) => context.kind === "image");
  const contextBlock = contexts.map(formatContextAttachment).join("\n\n");
  const text = `${contextBlock}\n\n[USER MESSAGE]\n${userText}\n[/USER MESSAGE]`;
  if (imageContexts.length === 0) {
    return text;
  }
  return [
    { type: "text", text },
    ...imageContexts.map((context) => ({
      type: "image_url" as const,
      image_url: { url: context.content, detail: "auto" as const }
    }))
  ];
}

export function evaluateContextLimits(
  contexts: ResolvedContextAttachment[],
  maxContextBytes: number,
  maxFileContextBytes: number
): ContextLimitResult {
  let totalBytes = 0;
  let totalTokens = 0;
  let imageCount = 0;
  let textBytes = 0;
  for (const context of contexts) {
    if (context.kind === "image") {
      imageCount += 1;
      if (imageCount > MAX_IMAGE_CONTEXTS) {
        return {
          ok: false,
          totalBytes,
          totalTokens,
          error: `Chỉ hỗ trợ tối đa ${MAX_IMAGE_CONTEXTS} ảnh mỗi request.`
        };
      }
      if (context.bytes > MAX_IMAGE_CONTEXT_BYTES) {
        return {
          ok: false,
          totalBytes,
          totalTokens,
          error: `${context.path} vượt giới hạn ảnh ${Math.round(MAX_IMAGE_CONTEXT_BYTES / 1024 / 1024)} MB.`
        };
      }
      totalBytes += context.bytes;
      totalTokens += context.tokenEstimate;
      continue;
    }
    if (context.bytes > maxFileContextBytes) {
      return {
        ok: false,
        totalBytes,
        totalTokens,
        error: `${context.path} vượt giới hạn mỗi file.`
      };
    }
    totalBytes += context.bytes;
    textBytes += context.bytes;
    totalTokens += context.tokenEstimate;
  }
  if (textBytes > maxContextBytes) {
    return {
      ok: false,
      totalBytes,
      totalTokens,
      error: "Tổng context vượt giới hạn."
    };
  }
  return { ok: true, totalBytes, totalTokens };
}

export function toHistoryMessages(messages: Array<{ role: "user" | "assistant"; content: string }>, maxMessages = 20): ChatMessage[] {
  return messages
    .slice(-maxMessages)
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({ role: message.role, content: message.content }));
}

export function createContextMetadata(path: string, content: string): { bytes: number; tokenEstimate: number } {
  const bytes = new TextEncoder().encode(content).byteLength;
  return { bytes, tokenEstimate: estimateTokens(content) };
}
