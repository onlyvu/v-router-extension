import * as vscode from "vscode";
import type { ChatToolCall } from "../api/types";
import type { ChatAccessMode } from "../chat/types";
import type { VRouterSettings } from "../config/settings";
import type { Logger } from "../logging/logger";
import { isAgentWorkspaceTool } from "../chat/agentToolDefinitions";
import { isBlockedPath, isHardSecretPath, isLikelyBinary } from "./fileGuards";
import { getSelectionContext } from "./selectionContext";

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
const EDIT_TOOL_NAMES = new Set(["create_file", "modify_file", "append_file", "delete_file", "rename_file"]);
const SAFE_EDIT_TOOL_NAMES = new Set(["create_file", "modify_file", "append_file"]);

export class WorkspaceAgentToolExecutor {
  public constructor(private readonly logger: Logger) {}

  public async execute(toolCall: ChatToolCall, options: ToolExecutionOptions): Promise<string> {
    const name = toolCall.function.name;
    if (!isAgentWorkspaceTool(name)) {
      return stringifyToolError(`Unknown tool: ${name}`);
    }
    try {
      const args = parseToolArgs(toolCall.function.arguments);
      const allowed = await this.confirmAccess(name, args, options);
      if (!allowed) {
        return stringifyToolError("Workspace access was not approved by the user.");
      }
      if (options.signal.aborted) {
        return stringifyToolError("Tool execution was cancelled.");
      }
      switch (name) {
        case "list_directory":
        case "list_workspace":
        case "get_workspace_structure":
          return JSON.stringify(await this.listWorkspace(args, options));
        case "find_files":
          return JSON.stringify(await this.findFiles(args));
        case "read_file":
        case "read_file_range":
          return JSON.stringify(await this.readFile(args, options));
        case "read_files":
          return JSON.stringify(await this.readFiles(args, options));
        case "get_file_metadata":
          return JSON.stringify(await this.getFileMetadata(args));
        case "search_text":
        case "search_workspace":
          return JSON.stringify(await this.searchWorkspace(args, options));
        case "get_open_editors":
          return JSON.stringify(this.getOpenEditors());
        case "get_selection":
          return JSON.stringify(this.getSelection());
        case "get_diagnostics":
        case "get_problems":
          return JSON.stringify(await this.getDiagnostics(args));
        case "update_plan":
        case "report_progress":
        case "complete_task":
          return JSON.stringify({ ok: true, tool: name, summary: readOptionalString(args.summary) ?? "Progress updated.", data: args });
        case "create_file":
          return JSON.stringify(await this.createFile(args));
        case "modify_file":
          return JSON.stringify(await this.modifyFile(args));
        case "append_file":
          return JSON.stringify(await this.appendFile(args));
        case "delete_file":
          return JSON.stringify(await this.deleteFile(args));
        case "rename_file":
          return JSON.stringify(await this.renameFile(args));
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

  private async readFiles(args: ToolArgs, options: ToolExecutionOptions): Promise<unknown> {
    const pathsValue = args.paths;
    if (!Array.isArray(pathsValue)) {
      throw new Error("paths is required.");
    }
    const paths = pathsValue.filter((item): item is string => typeof item === "string").slice(0, 20);
    const files: unknown[] = [];
    for (const path of paths) {
      files.push(await this.readFile({ path }, options));
    }
    return { ok: true, files };
  }

  private async findFiles(args: ToolArgs): Promise<unknown> {
    const pattern = readOptionalString(args.pattern) ?? "**/*";
    const maxResults = clampInteger(args.max_results, DEFAULT_LIST_LIMIT, 1, 500);
    const uris = await vscode.workspace.findFiles(pattern, "{**/.git/**,**/node_modules/**,**/dist/**,**/out/**,**/build/**,**/.vscode-test/**}", maxResults);
    return {
      ok: true,
      pattern,
      files: uris
        .map((uri) => normalizeWorkspacePath(vscode.workspace.asRelativePath(uri, false)))
        .filter((path) => !shouldSkipPath(path))
    };
  }

  private async getFileMetadata(args: ToolArgs): Promise<unknown> {
    const path = readRequiredString(args.path, "path");
    const resolved = await resolveWorkspaceUri(path);
    assertReadablePath(resolved.relativePath);
    const stat = await vscode.workspace.fs.stat(resolved.uri);
    return {
      ok: true,
      path: resolved.relativePath,
      type: (stat.type & vscode.FileType.Directory) !== 0 ? "directory" : "file",
      size: stat.size,
      mtime: new Date(stat.mtime).toISOString(),
      ctime: new Date(stat.ctime).toISOString()
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
        const line = lines[index] ?? "";
        if (line.toLowerCase().includes(needle)) {
          results.push({
            path: relativePath,
            line: index + 1,
            preview: line.trim().slice(0, 240)
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

  private getOpenEditors(): unknown {
    return {
      ok: true,
      editors: vscode.window.visibleTextEditors.map((editor) => ({
        path: normalizeWorkspacePath(vscode.workspace.asRelativePath(editor.document.uri, false)),
        language: editor.document.languageId,
        isDirty: editor.document.isDirty,
        lineCount: editor.document.lineCount,
        version: editor.document.version
      }))
    };
  }

  private getSelection(): unknown {
    const context = getSelectionContext();
    if (context === null) {
      return { ok: true, selection: null };
    }
    return {
      ok: true,
      selection: {
        path: context.path,
        language: context.language,
        lineRange: context.lineRange,
        bytes: context.bytes,
        tokenEstimate: context.tokenEstimate,
        content: context.content
      }
    };
  }

  private async getDiagnostics(args: ToolArgs): Promise<unknown> {
    const maxResults = clampInteger(args.max_results, 100, 1, 200);
    const targetPath = readOptionalString(args.path);
    const diagnostics = targetPath === undefined
      ? vscode.languages.getDiagnostics()
      : [[(await resolveWorkspaceUri(targetPath)).uri, vscode.languages.getDiagnostics((await resolveWorkspaceUri(targetPath)).uri)] as [vscode.Uri, vscode.Diagnostic[]]];
    const results: Array<{ path: string; severity: string; message: string; line: number; character: number; source?: string; code?: string }> = [];
    for (const [uri, items] of diagnostics) {
      const path = normalizeWorkspacePath(vscode.workspace.asRelativePath(uri, false));
      if (shouldSkipPath(path)) {
        continue;
      }
      for (const item of items) {
        if (results.length >= maxResults) {
          break;
        }
        const entry: { path: string; severity: string; message: string; line: number; character: number; source?: string; code?: string } = {
          path,
          severity: vscode.DiagnosticSeverity[item.severity] ?? String(item.severity),
          message: item.message,
          line: item.range.start.line + 1,
          character: item.range.start.character + 1
        };
        if (item.source !== undefined) {
          entry.source = item.source;
        }
        if (item.code !== undefined) {
          entry.code = String(typeof item.code === "object" && "value" in item.code ? item.code.value : item.code);
        }
        results.push(entry);
      }
    }
    return { ok: true, diagnostics: results, truncated: results.length >= maxResults };
  }

  private async createFile(args: ToolArgs): Promise<unknown> {
    const path = readRequiredString(args.path, "path");
    const content = readRequiredText(args.content, "content");
    const overwrite = readOptionalBoolean(args.overwrite) ?? false;
    const resolved = await resolveWorkspaceUri(path);
    assertWritablePath(resolved.relativePath);
    const existing = await statIfExists(resolved.uri);
    if (existing !== null && (existing.type & vscode.FileType.Directory) !== 0) {
      throw new Error(`${resolved.relativePath} is a directory.`);
    }
    if (existing !== null && !overwrite) {
      throw new Error(`${resolved.relativePath} already exists. Pass overwrite=true only when replacing it is intended.`);
    }
    await ensureParentDirectory(resolved);
    await writeTextFile(resolved.uri, content);
    return {
      ok: true,
      operation: "create_file",
      path: resolved.relativePath,
      overwritten: existing !== null,
      bytes: utf8ByteLength(content)
    };
  }

  private async modifyFile(args: ToolArgs): Promise<unknown> {
    const path = readRequiredString(args.path, "path");
    const content = readRequiredText(args.content, "content");
    const resolved = await resolveWorkspaceUri(path);
    assertWritablePath(resolved.relativePath);
    const stat = await requireExistingFile(resolved);
    if (stat.size > 0) {
      const existingBytes = await vscode.workspace.fs.readFile(resolved.uri);
      if (isLikelyBinary(existingBytes)) {
        throw new Error(`${resolved.relativePath} appears to be binary.`);
      }
    }
    await writeTextFile(resolved.uri, content);
    return {
      ok: true,
      operation: "modify_file",
      path: resolved.relativePath,
      previous_bytes: stat.size,
      bytes: utf8ByteLength(content)
    };
  }

  private async appendFile(args: ToolArgs): Promise<unknown> {
    const path = readRequiredString(args.path, "path");
    const content = readRequiredText(args.content, "content");
    const createIfMissing = readOptionalBoolean(args.create_if_missing) ?? true;
    const resolved = await resolveWorkspaceUri(path);
    assertWritablePath(resolved.relativePath);
    const stat = await statIfExists(resolved.uri);
    if (stat === null && !createIfMissing) {
      throw new Error(`${resolved.relativePath} does not exist.`);
    }
    if (stat !== null && (stat.type & vscode.FileType.Directory) !== 0) {
      throw new Error(`${resolved.relativePath} is a directory.`);
    }
    let previous = "";
    if (stat !== null) {
      const bytes = await vscode.workspace.fs.readFile(resolved.uri);
      if (isLikelyBinary(bytes)) {
        throw new Error(`${resolved.relativePath} appears to be binary.`);
      }
      previous = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }
    await ensureParentDirectory(resolved);
    await writeTextFile(resolved.uri, `${previous}${content}`);
    return {
      ok: true,
      operation: "append_file",
      path: resolved.relativePath,
      created: stat === null,
      appended_bytes: utf8ByteLength(content),
      bytes: utf8ByteLength(`${previous}${content}`)
    };
  }

  private async deleteFile(args: ToolArgs): Promise<unknown> {
    const path = readRequiredString(args.path, "path");
    const useTrash = readOptionalBoolean(args.use_trash) ?? true;
    const resolved = await resolveWorkspaceUri(path);
    assertWritablePath(resolved.relativePath);
    const stat = await requireExistingFile(resolved);
    await vscode.workspace.fs.delete(resolved.uri, { recursive: false, useTrash });
    return {
      ok: true,
      operation: "delete_file",
      path: resolved.relativePath,
      previous_bytes: stat.size,
      use_trash: useTrash
    };
  }

  private async renameFile(args: ToolArgs): Promise<unknown> {
    const oldPath = readRequiredString(args.old_path, "old_path");
    const newPath = readRequiredString(args.new_path, "new_path");
    const overwrite = readOptionalBoolean(args.overwrite) ?? false;
    const source = await resolveWorkspaceUri(oldPath);
    const target = await resolveWorkspaceUri(newPath);
    assertWritablePath(source.relativePath);
    assertWritablePath(target.relativePath);
    const stat = await requireExistingFile(source);
    const destination = await statIfExists(target.uri);
    if (destination !== null && (destination.type & vscode.FileType.Directory) !== 0) {
      throw new Error(`${target.relativePath} is a directory.`);
    }
    if (destination !== null && !overwrite) {
      throw new Error(`${target.relativePath} already exists. Pass overwrite=true only when replacing it is intended.`);
    }
    await ensureParentDirectory(target);
    await vscode.workspace.fs.rename(source.uri, target.uri, { overwrite });
    return {
      ok: true,
      operation: "rename_file",
      old_path: source.relativePath,
      new_path: target.relativePath,
      previous_bytes: stat.size,
      overwritten: destination !== null
    };
  }

  private async confirmAccess(toolName: string, args: ToolArgs, options: ToolExecutionOptions): Promise<boolean> {
    if (!isEditTool(toolName)) {
      return true;
    }
    if (options.accessMode === "read_only") {
      return false;
    }
    if (options.accessMode === "full_agent") {
      return true;
    }
    if (options.accessMode === "auto_apply_safe" && SAFE_EDIT_TOOL_NAMES.has(toolName)) {
      return true;
    }
    if (options.accessMode === "review_edits" || options.accessMode === "auto_apply_safe") {
      const target = describeToolTarget(toolName, args);
      const choice = await vscode.window.showWarningMessage(
        `V-Router muốn chạy ${toolName}${target.length > 0 ? ` trên ${target}` : ""}. Cho phép áp dụng thay đổi này?`,
        { modal: true },
        "Cho phép"
      );
      return choice === "Cho phép";
    }
    return false;
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

function assertWritablePath(relativePath: string): void {
  if (relativePath.length === 0) {
    throw new Error("A file path is required.");
  }
  assertReadablePath(relativePath);
}

async function statIfExists(uri: vscode.Uri): Promise<vscode.FileStat | null> {
  try {
    return await vscode.workspace.fs.stat(uri);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function requireExistingFile(resolved: { uri: vscode.Uri; relativePath: string }): Promise<vscode.FileStat> {
  const stat = await statIfExists(resolved.uri);
  if (stat === null) {
    throw new Error(`${resolved.relativePath} does not exist.`);
  }
  if ((stat.type & vscode.FileType.Directory) !== 0) {
    throw new Error(`${resolved.relativePath} is a directory.`);
  }
  return stat;
}

async function ensureParentDirectory(resolved: { workspace: vscode.WorkspaceFolder; relativePath: string }): Promise<void> {
  const parts = resolved.relativePath.split("/");
  if (parts.length <= 1) {
    return;
  }
  const parentUri = vscode.Uri.joinPath(resolved.workspace.uri, ...parts.slice(0, -1));
  await vscode.workspace.fs.createDirectory(parentUri);
}

async function writeTextFile(uri: vscode.Uri, content: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
}

function isFileNotFoundError(error: unknown): boolean {
  if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
    return true;
  }
  return error instanceof Error && /file.*not.*found|enoent/i.test(error.message);
}

function isEditTool(toolName: string): boolean {
  return EDIT_TOOL_NAMES.has(toolName);
}

function describeToolTarget(toolName: string, args: ToolArgs): string {
  if (toolName === "rename_file") {
    const oldPath = readOptionalString(args.old_path) ?? "";
    const newPath = readOptionalString(args.new_path) ?? "";
    return oldPath.length > 0 || newPath.length > 0 ? `${oldPath} -> ${newPath}` : "";
  }
  return readOptionalString(args.path) ?? "";
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

function readRequiredText(value: unknown, key: string): string {
  if (typeof value !== "string") {
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

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function stringifyToolError(message: string): string {
  return JSON.stringify({ ok: false, error: message });
}
