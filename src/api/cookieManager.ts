export class CookieManager {
  private clientTokenPair: string | null = null;

  public updateFromHeaders(headers: Headers): void {
    const pair = extractClientTokenCookie(readSetCookie(headers));
    if (pair !== null) {
      this.clientTokenPair = pair;
    }
  }

  public getCookieHeader(): string | null {
    return this.clientTokenPair;
  }

  public clear(): void {
    this.clientTokenPair = null;
  }
}

export function readSetCookie(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === "function") {
    return withGetSetCookie.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single === null ? [] : [single];
}

export function extractClientTokenCookie(setCookieHeaders: string[]): string | null {
  for (const header of setCookieHeaders) {
    const match = /(?:^|,\s*)client_token=([^;,\s]+)/i.exec(header);
    if (match?.[1] !== undefined && match[1].length > 0) {
      return `client_token=${match[1]}`;
    }
  }
  return null;
}
