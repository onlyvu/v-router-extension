export type ApiKeyStatus =
  | "active"
  | "invalid"
  | "expired"
  | "quota_exceeded"
  | "daily_quota_exceeded"
  | "suspended"
  | "inactive";

export interface QuotaSnapshot {
  quotaMode: "daily" | "total" | string;
  limit: number | null;
  used: number;
  reserved: number;
  remaining: number | null;
  resetAt: string | null;
  expiresAt: string | null;
  storedStatus: string;
  effectiveStatus: ApiKeyStatus | string;
  reason: string | null;
  percentUsed: number;
}

export interface ClientKeyInfo {
  id?: number;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  quotaMode?: string;
  status: ApiKeyStatus | string;
  expiresAt: string | null;
  modelAccessMode?: string;
  allowedModels?: string[];
  allowedCombos?: string[];
  quota: QuotaSnapshot;
}

export interface AuthSuccessResponse {
  success: true;
  key: ClientKeyInfo;
}

export interface ClientMeResponse {
  authenticated: boolean;
  inactive?: boolean;
  key?: ClientKeyInfo;
}

export interface UsageChartPoint {
  label: string;
  dateKey: string;
  tokens: number;
  requests: number;
}

export interface UsageHistoryItem {
  timestamp: string;
  provider: string;
  model: string;
  endpoint: string;
  promptTokens: number;
  completionTokens: number;
  status: string;
  totalTokens: number;
}

export interface UsageResponse {
  key?: Pick<ClientKeyInfo, "id" | "name" | "keyPrefix" | "quota">;
  chart: UsageChartPoint[];
  history: UsageHistoryItem[];
}

export interface ModelEntry {
  id: string;
  object: "model" | string;
  owned_by: string;
  kind?: string;
}

export interface ModelsResponse {
  object: "list" | string;
  count?: number;
  generatedAt?: string;
  data: ModelEntry[];
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  tools?: ChatTool[];
  tool_choice?: "auto" | "none";
  temperature?: number;
  max_tokens?: number;
}

export interface OpenAiErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
  status?: ApiKeyStatus | string;
  message?: string;
}

export interface RequestInspectorSnapshot {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: ChatCompletionRequest | Record<string, unknown>;
  createdAt: string;
}
