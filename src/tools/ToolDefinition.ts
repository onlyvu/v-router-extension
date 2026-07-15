import type { ChatTool } from "../api/types";
import type { ToolPermissionCategory, ToolRiskLevel, ToolResult } from "./ToolResult";

export interface ToolExecutionContext {
  toolCallId: string;
  signal: AbortSignal;
}

export interface ToolDefinition<TInput extends Record<string, unknown> = Record<string, unknown>, TData = unknown> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  permissionCategory: ToolPermissionCategory;
  riskLevel: ToolRiskLevel;
  timeoutMs: number;
  audit: boolean;
  validateInput(input: unknown): TInput;
  execute(input: TInput, context: ToolExecutionContext): Promise<ToolResult<TData>>;
}

export function toChatTool(definition: Pick<ToolDefinition, "name" | "description" | "parameters">): ChatTool {
  return {
    type: "function",
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters
    }
  };
}
