import { VRouterApiError, type ErrorAction } from "./ApiError";
import type { ApiKeyStatus, OpenAiErrorBody } from "./types";
import { vi } from "../i18n/vi";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseErrorBody(value: unknown): OpenAiErrorBody {
  if (!isRecord(value)) {
    return {};
  }
  const result: OpenAiErrorBody = {};
  const error = value.error;
  if (isRecord(error)) {
    const parsedError: NonNullable<OpenAiErrorBody["error"]> = {};
    if (typeof error.message === "string") {
      parsedError.message = error.message;
    }
    if (typeof error.type === "string") {
      parsedError.type = error.type;
    }
    if (typeof error.code === "string") {
      parsedError.code = error.code;
    }
    result.error = parsedError;
  } else if (typeof error === "string") {
    result.message = error;
  }
  if (typeof value.status === "string") {
    result.status = value.status;
  }
  if (typeof value.message === "string") {
    result.message = value.message;
  }
  return result;
}

export function messageForApiKeyStatus(status: ApiKeyStatus | string | undefined): string {
  switch (status) {
    case "invalid":
      return vi.authMessages.invalid;
    case "expired":
      return vi.authMessages.expired;
    case "quota_exceeded":
      return vi.authMessages.quota_exceeded;
    case "daily_quota_exceeded":
      return vi.authMessages.daily_quota_exceeded;
    case "suspended":
      return vi.authMessages.suspended;
    case "inactive":
      return vi.authMessages.inactive;
    case "active":
      return vi.authMessages.active;
    default:
      return "Không thể xác thực API key.";
  }
}

export function mapErrorAction(status: number, body: OpenAiErrorBody): ErrorAction {
  const code = body.error?.code;
  const keyStatus = body.status;
  if (status === 401 && keyStatus !== undefined) {
    if (keyStatus === "expired") {
      return "show_expired";
    }
    if (keyStatus === "quota_exceeded" || keyStatus === "daily_quota_exceeded") {
      return "show_quota_exceeded";
    }
    if (keyStatus === "invalid" || keyStatus === "inactive" || keyStatus === "suspended") {
      return "show_invalid";
    }
  }
  if (status === 401) {
    return "re_auth";
  }
  if (status === 403 && code === "model_not_allowed") {
    return "model_blocked";
  }
  if (status === 404 && code === "model_not_found") {
    return "model_refresh";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status >= 500) {
    return "server_error";
  }
  if (status === 400) {
    return "bad_request";
  }
  return "unknown";
}

export function parseRetryAfterMs(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}

export async function errorFromResponse(response: Response): Promise<VRouterApiError> {
  let parsed: unknown = {};
  try {
    parsed = await response.json();
  } catch {
    parsed = {};
  }
  const body = parseErrorBody(parsed);
  const action = mapErrorAction(response.status, body);
  const statusMessage = body.status !== undefined ? messageForApiKeyStatus(body.status) : undefined;
  const message =
    statusMessage ??
    body.error?.message ??
    body.message ??
    `V-Router trả về lỗi HTTP ${response.status}`;
  const options: ConstructorParameters<typeof VRouterApiError>[0] = {
    message,
    status: response.status,
    action,
    body
  };
  if (body.error?.type !== undefined) {
    options.type = body.error.type;
  }
  if (body.error?.code !== undefined) {
    options.code = body.error.code;
  }
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
  if (retryAfterMs !== undefined) {
    options.retryAfterMs = retryAfterMs;
  }
  return new VRouterApiError(options);
}
