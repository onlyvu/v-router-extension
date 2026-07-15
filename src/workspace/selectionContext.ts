import * as vscode from "vscode";
import type { ResolvedContextAttachment } from "../chat/types";
import { createResolvedContext } from "./fileGuards";

export function getSelectionContext(): ResolvedContextAttachment | null {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined || editor.selection.isEmpty) {
    return null;
  }
  const text = editor.document.getText(editor.selection);
  if (text.trim().length === 0) {
    return null;
  }
  const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false);
  const start = editor.selection.start.line + 1;
  const end = editor.selection.end.line + 1;
  return createResolvedContext({
    kind: "selection",
    path: relativePath,
    language: editor.document.languageId,
    content: text,
    lineRange: start === end ? `${start}` : `${start}-${end}`
  });
}
