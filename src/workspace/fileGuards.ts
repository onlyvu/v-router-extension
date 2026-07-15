import type { ResolvedContextAttachment, ContextKind } from "../chat/types";
import { createContextMetadata } from "../chat/contextBuilder";

const HARD_BLOCK_NAMES = [
  /^\.env(?:\..*)?$/i,
  /^id_rsa$/i,
  /^id_ed25519$/i,
  /^.*private.*key.*$/i,
  /^.*\.pem$/i,
  /^.*\.p12$/i,
  /^.*\.pfx$/i
];

const WARN_NAMES = [
  /^credentials(?:\..*)?$/i,
  /^.*secret.*$/i,
  /^.*token.*$/i,
  /^.*apikey.*$/i,
  /^.*api-key.*$/i
];

const BLOCKED_SEGMENTS = new Set([".git", "node_modules", "dist", "out", "build", ".vscode-test"]);

export function isBlockedPath(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts.some((part) => BLOCKED_SEGMENTS.has(part));
}

export function isHardSecretPath(relativePath: string): boolean {
  const filename = relativePath.split(/[\\/]+/).pop() ?? relativePath;
  return HARD_BLOCK_NAMES.some((pattern) => pattern.test(filename));
}

export function isPotentialSecretPath(relativePath: string): boolean {
  const filename = relativePath.split(/[\\/]+/).pop() ?? relativePath;
  return WARN_NAMES.some((pattern) => pattern.test(filename));
}

export function isLikelyBinary(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, Math.min(bytes.length, 4096));
  if (sample.includes(0)) {
    return true;
  }
  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 14 && byte < 32)) {
      suspicious += 1;
    }
  }
  return sample.length > 0 && suspicious / sample.length > 0.12;
}

export function languageFromPath(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescriptreact",
    js: "javascript",
    jsx: "javascriptreact",
    json: "json",
    md: "markdown",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    cs: "csharp",
    css: "css",
    html: "html",
    yaml: "yaml",
    yml: "yaml",
    xml: "xml",
    sh: "shellscript",
    ps1: "powershell"
  };
  return map[ext] ?? "plaintext";
}

export function createResolvedContext(options: {
  kind: ContextKind;
  path: string;
  language?: string;
  content: string;
  lineRange?: string;
  warning?: string;
}): ResolvedContextAttachment {
  const metadata = createContextMetadata(options.path, options.content);
  const attachment: ResolvedContextAttachment = {
    id: crypto.randomUUID(),
    kind: options.kind,
    path: options.path,
    language: options.language ?? languageFromPath(options.path),
    bytes: metadata.bytes,
    tokenEstimate: metadata.tokenEstimate,
    content: options.content
  };
  if (options.lineRange !== undefined) {
    attachment.lineRange = options.lineRange;
  }
  if (options.warning !== undefined) {
    attachment.warning = options.warning;
  }
  return attachment;
}
