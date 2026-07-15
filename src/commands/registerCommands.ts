import * as vscode from "vscode";
import type { ChatViewProvider } from "../providers/ChatViewProvider";
import type { Logger } from "../logging/logger";

async function revealAdmin(): Promise<void> {
  await vscode.commands.executeCommand("workbench.view.extension.vRouterSmart");
  await vscode.commands.executeCommand("vRouterSmart.chatView.focus");
}

export function registerCommands(provider: ChatViewProvider, logger: Logger): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("vRouterSmart.openChat", async () => {
      await provider.openChatPanel();
    }),
    vscode.commands.registerCommand("vRouterSmart.setApiKey", async () => {
      const apiKey = await vscode.window.showInputBox({
        title: "V-Router Smart API key",
        prompt: "Nhập API key. Key chỉ được lưu vào VS Code SecretStorage sau khi xác thực thành công.",
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => value.trim().length === 0 ? "API key không được rỗng." : undefined
      });
      if (apiKey !== undefined) {
        await provider.saveApiKey(apiKey);
        await revealAdmin();
      }
    }),
    vscode.commands.registerCommand("vRouterSmart.removeApiKey", async () => {
      await provider.removeApiKey();
    }),
    vscode.commands.registerCommand("vRouterSmart.validateApiKey", async () => {
      await provider.validateApiKey();
    }),
    vscode.commands.registerCommand("vRouterSmart.refreshModels", async () => {
      await provider.refreshModels(true);
    }),
    vscode.commands.registerCommand("vRouterSmart.refreshQuota", async () => {
      await provider.refreshQuota(true);
    }),
    vscode.commands.registerCommand("vRouterSmart.refreshView", async () => {
      await provider.refreshView();
    }),
    vscode.commands.registerCommand("vRouterSmart.openSettings", async () => {
      await vscode.commands.executeCommand("workbench.action.openSettings", "vRouterSmart");
    }),
    vscode.commands.registerCommand("vRouterSmart.newChat", async () => {
      await provider.newChat();
      await provider.openChatPanel();
    }),
    vscode.commands.registerCommand("vRouterSmart.clearAllHistory", async () => {
      await provider.clearAllHistory();
    }),
    vscode.commands.registerCommand("vRouterSmart.showTaskHistory", async () => {
      await provider.showHistoryQuickPick();
    }),
    vscode.commands.registerCommand("vRouterSmart.attachSelection", async () => {
      await provider.attachSelection();
      await provider.openChatPanel();
    }),
    vscode.commands.registerCommand("vRouterSmart.explainSelection", async () => {
      await provider.openChatPanel();
      provider.fillPromptForSelection("explain");
    }),
    vscode.commands.registerCommand("vRouterSmart.fixSelection", async () => {
      await provider.openChatPanel();
      provider.fillPromptForSelection("fix");
    }),
    vscode.commands.registerCommand("vRouterSmart.showLastRequest", async () => {
      await provider.showLastRequest();
    }),
    vscode.commands.registerCommand("vRouterSmart.showAgentInstructions", async () => {
      await provider.showAgentInstructions();
    }),
    vscode.commands.registerCommand("vRouterSmart.showToolDefinitions", async () => {
      await provider.showToolDefinitions();
    }),
    vscode.commands.registerCommand("vRouterSmart.startAgentTask", async () => {
      await provider.openChatPanel();
    }),
    vscode.commands.registerCommand("vRouterSmart.stopAgent", () => {
      provider.stopAgent();
    }),
    vscode.commands.registerCommand("vRouterSmart.reviewAgentChanges", () => {
      void vscode.window.showInformationMessage("ChangeSet review UI chưa có pending ChangeSet.");
    }),
    vscode.commands.registerCommand("vRouterSmart.applyAllChanges", () => {
      void vscode.window.showInformationMessage("Không có ChangeSet đang chờ apply.");
    }),
    vscode.commands.registerCommand("vRouterSmart.rejectAllChanges", () => {
      void vscode.window.showInformationMessage("Không có ChangeSet đang chờ reject.");
    }),
    vscode.commands.registerCommand("vRouterSmart.undoLastAgentTask", () => {
      void vscode.window.showInformationMessage("Undo task sẽ khả dụng sau khi ChangeSet/checkpoint được tạo.");
    }),
    vscode.commands.registerCommand("vRouterSmart.showAgentHistory", () => {
      void vscode.window.showInformationMessage("Agent history store sẽ được hiển thị trong phase ChangeSet/checkpoint.");
    }),
    vscode.commands.registerCommand("vRouterSmart.openLogs", () => {
      logger.show();
    })
  ];
}
