import * as vscode from "vscode";
import { CookieManager } from "./api/cookieManager";
import { VRouterClient } from "./api/VRouterClient";
import { ApiKeyService } from "./auth/ApiKeyService";
import { SessionService } from "./auth/SessionService";
import { ChatService } from "./chat/ChatService";
import { ConversationStore } from "./chat/conversationStore";
import { registerCommands } from "./commands/registerCommands";
import { CHAT_SECONDARY_VIEW_ID, CHAT_VIEW_ID } from "./config/constants";
import { getSettings } from "./config/settings";
import { Logger } from "./logging/logger";
import { ModelService } from "./models/ModelService";
import { ChatViewProvider } from "./providers/ChatViewProvider";
import { QuotaService } from "./quota/QuotaService";
import { QuotaStatusBar } from "./quota/QuotaStatusBar";
import { QuotaStream } from "./quota/QuotaStream";
import { WorkspaceAgentToolExecutor } from "./workspace/agentTools";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new Logger();
  context.subscriptions.push(logger);
  logger.info("Extension activated");
  await vscode.commands.executeCommand("setContext", "vRouterSmart.doesNotSupportSecondarySidebar", !supportsSecondarySidebar());

  const apiKeyService = new ApiKeyService(context.secrets);
  const sessionService = new SessionService();
  const cookieManager = new CookieManager();
  const settingsResult = getSettings();
  for (const warning of settingsResult.warnings) {
    logger.warn(`Setting ${warning.key}: ${warning.message}`);
  }
  const client = new VRouterClient(
    settingsResult.settings.serverOrigin,
    cookieManager,
    () => apiKeyService.getApiKey(),
    logger
  );
  const conversationStore = new ConversationStore(context.workspaceState);
  const modelService = new ModelService(client, context.globalState, logger);
  const quotaService = new QuotaService(client, sessionService, logger);
  const quotaStatusBar = new QuotaStatusBar();
  const agentToolExecutor = new WorkspaceAgentToolExecutor(logger);
  context.subscriptions.push(quotaStatusBar);
  let provider: ChatViewProvider;
  const quotaStream = new QuotaStream(client, quotaService, logger, (quota) => {
    provider.handleQuotaStreamUpdate(quota);
  });
  const chatService = new ChatService(client, apiKeyService, modelService, quotaService, conversationStore, logger, agentToolExecutor);
  provider = new ChatViewProvider(
    context.extensionUri,
    apiKeyService,
    sessionService,
    client,
    modelService,
    quotaService,
    quotaStatusBar,
    quotaStream,
    chatService,
    conversationStore,
    logger
  );

  context.subscriptions.push(provider);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, provider, {
    webviewOptions: { retainContextWhenHidden: true }
  }));
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(CHAT_SECONDARY_VIEW_ID, provider, {
    webviewOptions: { retainContextWhenHidden: true }
  }));
  context.subscriptions.push(...registerCommands(provider, logger));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (event) => {
    if (!event.affectsConfiguration("vRouterSmart")) {
      return;
    }
    const { settings, warnings } = getSettings();
    for (const warning of warnings) {
      logger.warn(`Setting ${warning.key}: ${warning.message}`);
    }
    if (client.serverOrigin !== settings.serverOrigin) {
      quotaStream.stop();
      client.updateServerOrigin(settings.serverOrigin);
      await apiKeyService.deleteApiKey();
      sessionService.clear();
      quotaService.clear();
      quotaStatusBar.clear();
      logger.warn("Server Origin changed; API key was removed and must be re-authenticated.");
      void vscode.window.showWarningMessage("V-Router Server Origin đã thay đổi. Vui lòng nhập lại API key.");
    }
  }));

  void provider.initializeFromSecret().catch((error: unknown) => logger.warn("Initial auth failed", error));
}

export function deactivate(): void {
  // Disposables are owned by VS Code subscriptions.
}

function supportsSecondarySidebar(): boolean {
  const [major = 0, minor = 0] = vscode.version.split(".").map((part) => Number.parseInt(part, 10));
  return major > 1 || (major === 1 && minor >= 94);
}
