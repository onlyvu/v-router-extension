import { DEFAULT_SERVER_ORIGIN, OPENAI_BASE_PATH } from "../config/constants";

export class InvalidServerOriginError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidServerOriginError";
  }
}

export function isLocalHttpHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function normalizeServerOrigin(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) {
    return DEFAULT_SERVER_ORIGIN;
  }
  const url = new URL(trimmed);
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new InvalidServerOriginError("Server Origin không được chứa path.");
  }
  if (url.protocol === "http:" && !isLocalHttpHost(url.hostname)) {
    throw new InvalidServerOriginError("HTTP chỉ được phép cho localhost.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InvalidServerOriginError("Server Origin phải dùng HTTP hoặc HTTPS.");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizePath(path: string): string {
  const clean = path.trim();
  if (clean.length === 0 || clean === "/") {
    return "/";
  }
  return `/${clean.replace(/^\/+/, "")}`;
}

export interface UrlBuilder {
  readonly serverOrigin: string;
  buildServerUrl(path: string): string;
  buildOpenAIUrl(path: string): string;
}

export function createUrlBuilder(serverOrigin: string): UrlBuilder {
  const origin = normalizeServerOrigin(serverOrigin);
  return {
    serverOrigin: origin,
    buildServerUrl(path: string): string {
      return new URL(normalizePath(path), `${origin}/`).toString();
    },
    buildOpenAIUrl(path: string): string {
      const openAiPath = `${OPENAI_BASE_PATH}${normalizePath(path)}`.replace(/\/{2,}/g, "/");
      return new URL(openAiPath, `${origin}/`).toString();
    }
  };
}
