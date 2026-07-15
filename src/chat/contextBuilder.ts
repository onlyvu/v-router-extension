import type { ChatMessage } from "../api/types";
import type { ResolvedContextAttachment } from "./types";
import { estimateTokens } from "./tokenEstimate";

export interface ContextLimitResult {
  ok: boolean;
  totalBytes: number;
  totalTokens: number;
  error?: string;
}

export function formatContextAttachment(context: ResolvedContextAttachment): string {
  const label = context.kind === "selection" ? "CONTEXT SELECTION" : "CONTEXT FILE";
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

export function buildUserContent(userText: string, contexts: ResolvedContextAttachment[]): string {
  if (contexts.length === 0) {
    return userText;
  }
  const contextBlock = contexts.map(formatContextAttachment).join("\n\n");
  return `${contextBlock}\n\n[USER MESSAGE]\n${userText}\n[/USER MESSAGE]`;
}

export function evaluateContextLimits(
  contexts: ResolvedContextAttachment[],
  maxContextBytes: number,
  maxFileContextBytes: number
): ContextLimitResult {
  let totalBytes = 0;
  let totalTokens = 0;
  for (const context of contexts) {
    if (context.bytes > maxFileContextBytes) {
      return {
        ok: false,
        totalBytes,
        totalTokens,
        error: `${context.path} vượt giới hạn mỗi file.`
      };
    }
    totalBytes += context.bytes;
    totalTokens += context.tokenEstimate;
  }
  if (totalBytes > maxContextBytes) {
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
