import * as vscode from "vscode";
import type { ChatToolCall } from "../api/types";
import type { ChatAccessMode } from "../chat/types";
import type { VRouterSettings } from "../config/settings";
import type { Logger } from "../logging/logger";
import { isAgentWorkspaceTool } from "../chat/agentToolDefinitions";
import { isBlockedPath, isHardSecretPath, isLikelyBinary } from "./fileGuards";

interface ToolExecutionOptions {
  settings: VRouterSettings;
  accessMode: ChatAccessMode;
  signal: AbortSignal;
}

interface WorkspaceEntry {
  path: string;
  type: "file" | "directory";
  bytes?: number;
}

type ToolArgs = Record<string, unknown>;

const DEFAULT_LIST_LIMIT = 200;
const DEFAULT_SEARCH_LIMIT = 40;
const MAX_SEARCH_FILES = 1200;

export class WorkspaceAgentToolExecutor {
  public constructor(private readonly logger: Logger) {}

  public async execute(toolCall: ChatToolCall, options: ToolExecutionOptions): Promise<string> {
    const name = toolCall.function.name;
    if (!isAgentWorkspaceTool(name)) {
      return stringifyToolError(`Unknown tool: ${name}`);
    }
    const allowed = await this.confirmAccess(name, options.accessMode);
    if (!allowed) {
      return stringifyToolError("Workspace access was not approved by the user.");
    }
    if (options.accessMode === "limited") {
      return stringifyToolError("Workspace tools are disabled in Limited access. Attach files manually or switch to Full access.");
    }
    if (options.signal.aborted) {
      return stringifyToolError("Tool execution was cancelled.");
    }
    const args = parseToolArgs(toolCall.function.arguments);
    try {
      switch (name) {
        case "list_workspace":
          return JSON.stringify(await this.listWorkspace(args, options));
        case "read_file":
          return JSON.stringify(await this.readFile(args, options));
        case "search_workspace":
          return JSON.stringify(await this.searchWorkspace(args, options));
        default:
          return stringifyToolError(`Unhandled tool: ${name}`);
      }
    } catch (error) {
      this.logger.warn(`Workspace tool ${name} failed`, error);
      return stringifyToolError(error instanceof Error ? error.message : String(error));
    }
  }

  private async listWorkspace(args: ToolArgs, options: ToolExecutionOptions): Promise<unknown> {
    const base = await resolveWorkspaceUri(readOptionalString(args.path) ?? "");
    const recursive = readOptionalBoolean(args.recursive) ?? false;
    const maxEntries = clampInteger(args.max_entries, DEFAULT_LIST_LIMIT, 1, 500);
    const entries: WorkspaceEntry[] = [];
    let truncated = false;
    const visit = async (uri: vscode.Uri): Promise<void> => {
      if (entries.length >= maxEntries || options.signal.aborted) {
        truncated = true;
        return;
      }
      const children = await vscode.workspace.fs.readDirectory(uri);
      children.sort(([a], [b]) => a.localeCompare(b));
      for (const [name, type] of children) {
        if (entries.length >= maxEntries || options.signal.aborted) {
          truncated = true;
          return;
        }
        const child = vscode.Uri.joinPath(uri, name);
        const relativePath = normalizeWorkspacePath(vscode.workspace.asRelativePath(child, false));
        if (shouldSkipPath(relativePath)) {
          continue;
        }
        const entry: WorkspaceEntry = {
          path: relativePath,
          type: (type & vscode.FileType.Directory) !== 0 ? "directory" : "file"
        };
        if (entry.type === "file") {
          entry.bytes = (await vscode.workspace.fs.stat(child)).size;
        }
        entries.push(entry);
        if (recursive && entry.type === "directory") {
          await visit(child);
        }
      }
    };
    await visit(base.uri);
    return {
      ok: true,
      workspace: base.workspace.name,
      path: base.relativePath,
      recursive,
      entries,
      truncated
    };
  }

  private async readFile(args: ToolArgs, options: ToolExecutionOptions): Promise<unknown> {
    const path = readRequiredString(args.path, "path");
    const resolved = await resolveWorkspaceUri(path);
    const relativePath = resolved.relativePath;
    assertReadablePath(relativePath);
    const stat = await vscode.workspace.fs.stat(resolved.uri);
    if ((stat.type & vscode.FileType.Directory) !== 0) {
      throw new Error(`${relativePath} is a directory. Use list_workspace instead.`);
    }
    if (stat.size > options.settings.maxFileContextBytes) {
      throw new Error(`${relativePath} exceeds the per-file limit (${Math.round(options.settings.maxFileContextBytes / 1024)} KB).`);
    }
    const bytes = await vscode.workspace.fs.readFile(resolved.uri);
    if (isLikelyBinary(bytes)) {
      throw new Error(`${relativePath} appears to be binary.`);
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const lines = text.split(/\r?\n/);
    const startLine = clampInteger(args.start_line, 1, 1, Math.max(lines.length, 1));
    const endLine = clampInteger(args.end_line, lines.length, startLine, lines.length);
    return {
      ok: true,
      path: relativePath,
      start_line: startLine,
      end_line: endLine,
      total_lines: lines.length,
      content: lines.slice(startLine - 1, endLine).join("\n")
    };
  }

  private async searchWorkspace(args: ToolArgs, options: ToolExecutionOptions): Promise<unknown> {
    const query = readRequiredString(args.query, "query");
    const include = readOptionalString(args.include_glob) ?? "**/*";
    const maxResults = clampInteger(args.max_results, DEFAULT_SEARCH_LIMIT, 1, 100);
    const files = await vscode.workspace.findFiles(include, "{**/.git/**,**/node_modules/**,**/dist/**,**/out/**,**/build/**,**/.vscode-test/**}", MAX_SEARCH_FILES);
    const needle = query.toLowerCase();
    const results: Array<{ path: string; line: number; preview: string }> = [];
    let scanned = 0;
    let skipped = 0;
    for (const uri of files) {
      if (results.length >= maxResults || options.signal.aborted) {
        break;
      }
      const relativePath = normalizeWorkspacePath(vscode.workspace.asRelativePath(uri, false));
      if (shouldSkipPath(relativePath)) {
        skipped += 1;
        continue;
      }
      const stat = await vscode.workspace.fs.stat(uri);
      if ((stat.type & vscode.FileType.Directory) !== 0 || stat.size > options.settings.maxFileContextBytes) {
        skipped += 1;
        continue;
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (isLikelyBinary(bytes)) {
        skipped += 1;
        continue;
      }
      scanned += 1;
      const lines = new TextDecoder("utf-8", { fatal: false }).decode(bytes).split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index]?.toLowerCase().includes(needle)) {
          results.push({
            path: relativePath,
            line: index + 1,
            preview: (lines[index] ?? "").trim().slice(0, 240)
          });
          if (results.length >= maxResults) {
            break;
          }
        }
      }
    }
    return {
      ok: true,
      query,
      include_glob: include,
      scanned_files: scanned,
      skipped_files: skipped,
      results,
      truncated: results.length >= maxResults
    };
  }

  private async confirmAccess(toolName: string, accessMode: ChatAccessMode): Promise<boolean> {
    if (accessMode !== "ask") {
      return true;
    }
    const choice = await vscode.window.showWarningMessage(
      `V-Router Agent muốn chạy ${toolName} để đọc workspace. Cho phép?`,
      { modal: true },
      "Cho phép"
    );
    return choice === "Cho phép";
  }
}

async function resolveWorkspaceUri(path: string): Promise<{ workspace: vscode.WorkspaceFolder; uri: vscode.Uri; relativePath: string }> {
  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (workspace === undefined) {
    throw new Error("No workspace folder is open.");
  }
  const relativePath = normalizeWorkspacePath(path);
  const parts = relativePath.length === 0 ? [] : relativePath.split("/");
  const uri = vscode.Uri.joinPath(workspace.uri, ...parts);
  if (relativePath.length === 0) {
    return { workspace, uri, relativePath };
  }
  const normalized = normalizeWorkspacePath(vscode.workspace.asRelativePath(uri, false));
  if (normalized !== relativePath && relativePath.length > 0) {
    throw new Error("Path must stay inside the current workspace.");
  }
  return { workspace, uri, relativePath };
}

function normalizeWorkspacePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  const parts = normalized.split("/").filter((part) => part.length > 0 && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw new Error("Parent path segments are not allowed.");
  }
  return parts.join("/");
}

function shouldSkipPath(relativePath: string): boolean {
  return isBlockedPath(relativePath) || isHardSecretPath(relativePath);
}

function assertReadablePath(relativePath: string): void {
  if (isBlockedPath(relativePath)) {
    throw new Error(`${relativePath} is in a blocked folder.`);
  }
  if (isHardSecretPath(relativePath)) {
    throw new Error(`${relativePath} is blocked because it may contain secrets.`);
  }
}

function parseToolArgs(rawArgs: string): ToolArgs {
  if (rawArgs.trim().length === 0) {
    return {};
  }
  const parsed = JSON.parse(rawArgs) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return parsed as ToolArgs;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readRequiredString(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function stringifyToolError(message: string): string {
  return JSON.stringify({ ok: false, error: message });
}
