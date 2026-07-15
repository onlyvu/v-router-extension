import * as vscode from "vscode";

export async function copyCode(code: string): Promise<void> {
  await vscode.env.clipboard.writeText(code);
  void vscode.window.showInformationMessage("Đã copy code.");
}

export async function insertAtCursor(code: string, confirm: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    void vscode.window.showWarningMessage("Không có editor đang mở.");
    return;
  }
  if (confirm) {
    const choice = await vscode.window.showWarningMessage("Chèn code tại cursor hiện tại?", { modal: true }, "Chèn");
    if (choice !== "Chèn") {
      return;
    }
  }
  await editor.edit((editBuilder) => {
    for (const selection of editor.selections) {
      editBuilder.insert(selection.active, code);
    }
  });
}

export async function replaceSelection(code: string, confirm: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined || editor.selection.isEmpty) {
    void vscode.window.showWarningMessage("Không có selection để thay thế.");
    return;
  }
  if (confirm) {
    const choice = await vscode.window.showWarningMessage("Thay thế selection hiện tại bằng code này?", { modal: true }, "Thay thế");
    if (choice !== "Thay thế") {
      return;
    }
  }
  await editor.edit((editBuilder) => {
    for (const selection of editor.selections) {
      if (!selection.isEmpty) {
        editBuilder.replace(selection, code);
      }
    }
  });
}

export async function openInNewEditor(code: string, language = "plaintext"): Promise<void> {
  const document = await vscode.workspace.openTextDocument({ content: code, language });
  await vscode.window.showTextDocument(document, { preview: false });
}
