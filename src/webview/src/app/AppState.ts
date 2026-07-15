import type { ChatAccessMode, ChatMode } from "../../../chat/types";

export const MODE_OPTIONS: Array<[ChatMode, string]> = [
  ["chat", "Chat"],
  ["edit", "Edit"],
  ["agent", "Agent"]
];

export const ACCESS_OPTIONS: Array<[ChatAccessMode, string]> = [
  ["read_only", "Read only"],
  ["review_edits", "Review edits"],
  ["auto_apply_safe", "Auto safe"],
  ["full_agent", "Full agent"]
];

export function compactModelName(modelId: string): string {
  const clean = modelId.split("/").pop() ?? modelId;
  return clean.length > 18 ? `${clean.slice(0, 16)}...` : clean;
}

export function formatRelativeTime(value: string): string {
  const deltaMs = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) {
    return "now";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}
