import * as vscode from "vscode";
import type { ResolvedContextAttachment } from "../chat/types";
import { createResolvedContext, isLikelyBinary } from "./fileGuards";

export async function getActiveFileContext(maxBytes: number): Promise<ResolvedContextAttachment | null> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    return null;
  }
  const text = editor.document.getText();
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > maxBytes || isLikelyBinary(bytes)) {
    return null;
  }
  return createResolvedContext({
    kind: "activeFile",
    path: vscode.workspace.asRelativePath(editor.document.uri, false),
    language: editor.document.languageId,
    content: text
  });
}
