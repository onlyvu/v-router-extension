const API_KEY_PATTERN = /\b(sk-[A-Za-z0-9._-]{6,}|vrouter-[A-Za-z0-9._-]{6,})\b/g;
const AUTH_PATTERN = /(authorization\s*:\s*bearer\s+)[^\s,}]+/gi;
const COOKIE_PATTERN = /(cookie\s*:\s*)[^,\n\r}]+/gi;
const CLIENT_TOKEN_PATTERN = /(client_token=)[^;\s,\n\r}]+/gi;
const JSON_SECRET_PATTERN = /("(?:apiKey|client_token|authorization|cookie)"\s*:\s*")[^"]+(")/gi;

export function redactSensitive(input: unknown): string {
  const value = typeof input === "string" ? input : JSON.stringify(input);
  return value
    .replace(JSON_SECRET_PATTERN, "$1[REDACTED]$2")
    .replace(AUTH_PATTERN, "$1[REDACTED]")
    .replace(COOKIE_PATTERN, "$1[REDACTED]")
    .replace(CLIENT_TOKEN_PATTERN, "$1[REDACTED]")
    .replace(API_KEY_PATTERN, "[REDACTED]");
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/^(authorization|cookie)$/i.test(key)) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = redactSensitive(value);
    }
  }
  return redacted;
}
