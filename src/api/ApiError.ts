import type { OpenAiErrorBody } from "./types";

export type ErrorAction =
  | "show_invalid"
  | "show_expired"
  | "show_quota_exceeded"
  | "re_auth"
  | "model_blocked"
  | "model_refresh"
  | "rate_limited"
  | "server_error"
  | "bad_request"
  | "cancelled"
  | "unknown";

export class VRouterApiError extends Error {
  public readonly status: number;
  public readonly type?: string;
  public readonly code?: string;
  public readonly action: ErrorAction;
  public readonly retryAfterMs?: number;
  public readonly body?: OpenAiErrorBody;

  public constructor(options: {
    message: string;
    status: number;
    action: ErrorAction;
    type?: string;
    code?: string;
    retryAfterMs?: number;
    body?: OpenAiErrorBody;
  }) {
    super(options.message);
    this.name = "VRouterApiError";
    this.status = options.status;
    this.action = options.action;
    if (options.type !== undefined) {
      this.type = options.type;
    }
    if (options.code !== undefined) {
      this.code = options.code;
    }
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
    if (options.body !== undefined) {
      this.body = options.body;
    }
  }
}
