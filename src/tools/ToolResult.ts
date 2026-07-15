export interface ToolResult<TData = unknown> {
  success: boolean;
  toolCallId: string;
  summary: string;
  data?: TData;
  error?: string;
  metadata: {
    toolName: string;
    durationMs: number;
    riskLevel: ToolRiskLevel;
    permissionCategory: ToolPermissionCategory;
  };
}

export type ToolRiskLevel = "low" | "medium" | "high";
export type ToolPermissionCategory = "read_workspace" | "edit_workspace" | "run_command" | "agent_control";
