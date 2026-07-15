import * as vscode from "vscode";
import type { ResolvedContextAttachment } from "../chat/types";
import {
  createResolvedContext,
  isBlockedPath,
  isHardSecretPath,
  isLikelyBinary,
  isPotentialSecretPath,
  languageFromPath
} from "./fileGuards";

export async function readUriAsContext(uri: vscode.Uri, maxBytes: number): Promise<ResolvedContextAttachment | null> {
  const relativePath = vscode.workspace.asRelativePath(uri, false);
  if (isBlockedPath(relativePath) || isHardSecretPath(relativePath)) {
    void vscode.window.showWarningMessage(`Không thể đính kèm file nhạy cảm hoặc thư mục bị chặn: ${relativePath}`);
    return null;
  }
  if (isPotentialSecretPath(relativePath)) {
    const choice = await vscode.window.showWarningMessage(
      `File ${relativePath} có thể chứa secret. Bạn có chắc muốn đính kèm?`,
      { modal: true },
      "Đính kèm"
    );
    if (choice !== "Đính kèm") {
      return null;
    }
  }
  const bytes = await vscode.workspace.fs.readFile(uri);
  if (bytes.byteLength > maxBytes) {
    void vscode.window.showWarningMessage(`File vượt giới hạn ${Math.round(maxBytes / 1024)} KB: ${relativePath}`);
    return null;
  }
  if (isLikelyBinary(bytes)) {
    void vscode.window.showWarningMessage(`Không thể đính kèm file binary: ${relativePath}`);
    return null;
  }
  const content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return createResolvedContext({
    kind: "file",
    path: relativePath,
    language: languageFromPath(relativePath),
    content
  });
}

export async function chooseFilesAsContext(maxBytes: number): Promise<ResolvedContextAttachment[]> {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage("Workspace chưa trusted. Vui lòng xác nhận rõ khi đính kèm file.");
  }
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: true,
    title: "Chọn file context cho V-Router Smart"
  });
  if (uris === undefined) {
    return [];
  }
  const contexts: ResolvedContextAttachment[] = [];
  for (const uri of uris) {
    const context = await readUriAsContext(uri, maxBytes);
    if (context !== null) {
      contexts.push(context);
    }
  }
  return contexts;
}
