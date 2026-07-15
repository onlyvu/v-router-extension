import * as vscode from "vscode";
import type { VRouterClient } from "../api/VRouterClient";
import type { ModelEntry, QuotaSnapshot, UsageResponse } from "../api/types";
import type { ApiKeyService } from "../auth/ApiKeyService";
import { maskApiKey } from "../auth/ApiKeyService";
import type { SessionService } from "../auth/SessionService";
import type { ChatService } from "../chat/ChatService";
import { buildRuntimePolicyPrompt } from "../chat/ChatRequestBuilder";
import { getAgentToolDefinitionsForDisplay } from "../chat/agentToolDefinitions";
import type { ConversationStore } from "../chat/conversationStore";
import { createContextMetadata, evaluateContextLimits } from "../chat/contextBuilder";
import type { ChatAccessMode, ChatMode, ContextAttachment, ResolvedContextAttachment } from "../chat/types";
import { CHAT_SECONDARY_VIEW_ID, CHAT_VIEW_ID, SECONDARY_VIEW_CONTAINER_ID, VIEW_CONTAINER_ID } from "../config/constants";
import { getSettings } from "../config/settings";
import type { Logger } from "../logging/logger";
import type { ModelService } from "../models/ModelService";
import { evaluateQuota } from "../quota/QuotaGate";
import type { QuotaStatusBar } from "../quota/QuotaStatusBar";
import type { QuotaStream } from "../quota/QuotaStream";
import type { QuotaService } from "../quota/QuotaService";
import { parseInboundMessage, type OutboundMessage, type WebviewInitState, type WebviewSurface } from "../protocol";
import { getActiveFileContext } from "../workspace/activeFileContext";
import { copyCode, insertAtCursor, openInNewEditor, replaceSelection } from "../workspace/applyCode";
import { chooseFilesAsContext } from "../workspace/filePicker";
import { getSelectionContext } from "../workspace/selectionContext";

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = CHAT_VIEW_ID;

  private adminView: vscode.WebviewView | null = null;
  private readonly disposables: vscode.Disposable[] = [];
  private contexts: ResolvedContextAttachment[] = [];
  private models: ModelEntry[] = [];
  private selectedModel = "";
  private usage: UsageResponse | null = null;
  private chatMode: ChatMode = "chat";
  private accessMode: ChatAccessMode = "review_edits";

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly apiKeyService: ApiKeyService,
    private readonly sessionService: SessionService,
    private readonly client: VRouterClient,
    private readonly modelService: ModelService,
    private readonly quotaService: QuotaService,
    private readonly quotaStatusBar: QuotaStatusBar,
    private readonly quotaStream: QuotaStream,
    private readonly chatService: ChatService,
    private readonly conversationStore: ConversationStore,
    private readonly logger: Logger
  ) {
    this.applyDefaultModeSettings();
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.adminView = webviewView;
    this.configureWebview(webviewView.webview, "chat");
    this.disposables.push(webviewView.onDidDispose(() => {
      this.adminView = null;
    }));
    this.registerWebviewMessageHandler(webviewView.webview);
  }

  public async openChatPanel(): Promise<void> {
    await this.revealChatView();
    await this.initializeFromSecret();
    if (this.adminView !== null) {
      await this.sendInitState(this.adminView.webview, "chat");
    }
  }

  public async initializeFromSecret(): Promise<void> {
    const apiKey = await this.apiKeyService.getApiKey();
    if (apiKey === null) {
      this.sessionService.clear();
      return;
    }
    try {
      const auth = await this.client.authenticate(apiKey);
      this.sessionService.setKeyInfo(auth.key);
      this.quotaService.setQuota(auth.key.quota);
      this.quotaStatusBar.update(auth.key.quota);
      await this.refreshModels(false);
      this.quotaStream.start();
    } catch (error) {
      this.logger.warn("Stored API key validation failed", error);
      this.sessionService.clear();
      this.quotaService.clear();
    }
  }

  public async saveApiKey(apiKey: string): Promise<void> {
    const trimmed = apiKey.trim();
    if (trimmed.length === 0) {
      this.send({ type: "notification", level: "error", message: "API key không được rỗng." });
      return;
    }
    const auth = await this.client.authenticate(trimmed);
    await this.apiKeyService.storeApiKey(trimmed);
    this.sessionService.setKeyInfo(auth.key);
    this.quotaService.setQuota(auth.key.quota);
    this.quotaStatusBar.update(auth.key.quota);
    this.send({
      type: "auth:status",
      auth: this.sessionService.toViewState(true),
      key: auth.key
    });
    await this.refreshModels(true);
    await this.refreshQuota(true);
    this.quotaStream.start();
    this.send({ type: "notification", level: "info", message: `Đã lưu ${maskApiKey(trimmed).masked}.` });
  }

  public async validateApiKey(apiKey?: string): Promise<void> {
    const candidate = apiKey?.trim() ?? await this.apiKeyService.getApiKey();
    if (candidate === null || candidate.length === 0) {
      this.send({ type: "notification", level: "error", message: "Chưa có API key để kiểm tra." });
      return;
    }
    const auth = await this.client.authenticate(candidate);
    this.sessionService.setKeyInfo(auth.key);
    this.quotaService.setQuota(auth.key.quota);
    this.quotaStatusBar.update(auth.key.quota);
    this.send({ type: "auth:status", auth: this.sessionService.toViewState(await this.apiKeyService.hasApiKey()), key: auth.key });
    this.send({ type: "notification", level: "info", message: "Kết nối hợp lệ." });
  }

  public async removeApiKey(): Promise<void> {
    const choice = await vscode.window.showWarningMessage("Xóa API key đã lưu khỏi SecretStorage?", { modal: true }, "Xóa API key");
    if (choice !== "Xóa API key") {
      return;
    }
    await this.apiKeyService.deleteApiKey();
    this.quotaStream.stop();
    this.client.clearSession();
    this.sessionService.clear();
    this.quotaService.clear();
    this.quotaStatusBar.clear();
    this.models = [];
    this.selectedModel = "";
    this.send({ type: "auth:status", auth: this.sessionService.toViewState(false) });
    this.send({ type: "model:list", models: [], selectedModel: "" });
    this.send({ type: "quota:update", quota: null });
  }

  public async refreshModels(force = true): Promise<void> {
    const apiKey = await this.apiKeyService.getApiKey();
    if (apiKey === null) {
      this.models = [];
      this.selectedModel = "";
      this.send({ type: "model:list", models: [], selectedModel: "" });
      return;
    }
    const { settings, warnings } = getSettings();
    this.logSettingsWarnings(warnings);
    this.models = await this.modelService.getModels(apiKey, settings, force);
    this.selectedModel = this.modelService.getSelectedModel(this.models, settings);
    if (this.selectedModel.length > 0) {
      await this.modelService.setSelectedModel(this.selectedModel, this.models);
    }
    this.send({ type: "model:list", models: this.models, selectedModel: this.selectedModel });
  }

  public async refreshQuota(force = true): Promise<QuotaSnapshot | null> {
    const { settings, warnings } = getSettings();
    this.logSettingsWarnings(warnings);
    const quota = await this.quotaService.getQuota(settings, force);
    if (quota !== null) {
      this.quotaStatusBar.update(quota);
    } else {
      this.quotaStatusBar.clear();
    }
    this.send({ type: "quota:update", quota });
    this.send({ type: "auth:status", auth: this.sessionService.toViewState(await this.apiKeyService.hasApiKey()) });
    return quota;
  }

  public async loadUsage(): Promise<void> {
    this.usage = await this.client.getUsage(7);
    this.send({ type: "usage:update", usage: this.usage });
  }

  public handleQuotaStreamUpdate(quota: QuotaSnapshot): void {
    this.logger.info("Quota stream update", { status: quota.effectiveStatus, percentUsed: quota.percentUsed });
    this.quotaStatusBar.update(quota);
    this.send({ type: "quota:update", quota });
  }

  public async newChat(): Promise<void> {
    const conversation = await this.conversationStore.newConversation();
    this.send({ type: "chat:conversation", conversation });
  }

  public async clearChat(): Promise<void> {
    const conversation = await this.conversationStore.clearActiveConversation();
    this.send({ type: "chat:conversation", conversation });
  }

  public async clearAllHistory(): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      "Xóa toàn bộ task và lịch sử chat V-Router Smart trong workspace này?",
      { modal: true },
      "Xóa tất cả"
    );
    if (choice !== "Xóa tất cả") {
      return;
    }
    const conversation = await this.conversationStore.clearAll();
    this.contexts = [];
    this.send({ type: "chat:conversation", conversation });
    await this.sendInitState();
  }

  public async deleteConversation(conversationId: string): Promise<void> {
    const conversation = this.conversationStore.getData().conversations.find((item) => item.id === conversationId);
    if (conversation === undefined) {
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `Xóa task "${conversation.title}"?`,
      { modal: true },
      "Xóa"
    );
    if (choice !== "Xóa") {
      return;
    }
    const active = await this.conversationStore.deleteConversation(conversationId);
    this.send({ type: "chat:conversation", conversation: active });
    await this.sendInitState();
  }

  public async refreshView(): Promise<void> {
    await this.initializeFromSecret();
    await this.refreshModels(false);
    await this.refreshQuota(false);
    await this.sendInitState();
  }

  public stopAgent(): void {
    this.chatService.stop();
  }

  public async attachSelection(): Promise<void> {
    if (!await this.confirmReadAccess("selection hiện tại")) {
      return;
    }
    const context = getSelectionContext();
    if (context === null) {
      this.send({ type: "notification", level: "warning", message: "Không có selection hợp lệ." });
      return;
    }
    this.addContexts([context]);
  }

  public async attachActiveFile(): Promise<void> {
    if (!await this.confirmReadAccess("file đang mở")) {
      return;
    }
    const { settings, warnings } = getSettings();
    this.logSettingsWarnings(warnings);
    const context = await getActiveFileContext(settings.maxFileContextBytes);
    if (context === null) {
      this.send({ type: "notification", level: "warning", message: "Không thể đính kèm file hiện tại." });
      return;
    }
    this.addContexts([context]);
  }

  public async chooseFiles(): Promise<void> {
    if (!await this.confirmReadAccess("các file bạn chọn")) {
      return;
    }
    const { settings, warnings } = getSettings();
    this.logSettingsWarnings(warnings);
    const contexts = await chooseFilesAsContext(settings.maxFileContextBytes);
    this.addContexts(contexts);
  }

  public async attachDiagnostics(): Promise<void> {
    if (!await this.confirmReadAccess("VS Code Problems")) {
      return;
    }
    const diagnostics = vscode.languages.getDiagnostics()
      .flatMap(([uri, items]) => items.map((item) => ({
        path: vscode.workspace.asRelativePath(uri, false),
        severity: vscode.DiagnosticSeverity[item.severity] ?? String(item.severity),
        line: item.range.start.line + 1,
        character: item.range.start.character + 1,
        message: item.message
      })))
      .slice(0, 120);
    if (diagnostics.length === 0) {
      this.send({ type: "notification", level: "info", message: "Không có diagnostics trong workspace." });
      return;
    }
    const content = diagnostics
      .map((item) => `${item.path}:${item.line}:${item.character} [${item.severity}] ${item.message}`)
      .join("\n");
    const metadata = createContextMetadata("VS Code Problems", content);
    this.addContexts([{
      id: `diag-${crypto.randomUUID()}`,
      kind: "diagnostics",
      path: "VS Code Problems",
      language: "text",
      ...metadata,
      content
    }]);
  }

  public async openAttachmentMenu(): Promise<void> {
    const picked = await vscode.window.showQuickPick([
      { label: "$(selection) Attach selection", id: "selection", description: "Đính kèm đoạn đang chọn" },
      { label: "$(file-code) Attach active file", id: "activeFile", description: "Đính kèm file đang mở" },
      { label: "$(files) Choose files", id: "files", description: "Chọn file từ workspace" },
      { label: "$(warning) Attach diagnostics", id: "diagnostics", description: "Đính kèm Problems hiện tại" },
      { label: "$(clear-all) Clear attachments", id: "clear", description: "Xóa context đang đính kèm" }
    ], {
      title: "Attach context",
      placeHolder: "Chọn nguồn context cho V-Router"
    });
    if (picked === undefined) {
      return;
    }
    switch (picked.id) {
      case "selection":
        await this.attachSelection();
        break;
      case "activeFile":
        await this.attachActiveFile();
        break;
      case "files":
        await this.chooseFiles();
        break;
      case "diagnostics":
        await this.attachDiagnostics();
        break;
      case "clear":
        this.contexts = [];
        this.sendContext();
        break;
      default:
        break;
    }
  }

  public addPastedImage(name: string, mimeType: string, dataUri: string, bytes: number): void {
    const safeName = name.trim().length > 0 ? name.trim().slice(0, 80) : `pasted-image-${this.contexts.length + 1}.png`;
    const context: ResolvedContextAttachment = {
      id: `img-${crypto.randomUUID()}`,
      kind: "image",
      path: safeName,
      language: "image",
      bytes,
      tokenEstimate: 0,
      mimeType,
      previewDataUri: dataUri,
      content: dataUri
    };
    this.addContexts([context]);
  }

  public async showHistoryQuickPick(): Promise<void> {
    const conversations = this.conversationStore.getData().conversations;
    const picked = await vscode.window.showQuickPick(conversations.map((conversation) => ({
      label: conversation.title,
      description: formatRelativeAge(conversation.updatedAt),
      detail: `${conversation.messages.length} message${conversation.messages.length === 1 ? "" : "s"}`,
      id: conversation.id
    })), {
      title: "V-Router task history",
      placeHolder: "Chọn task để mở"
    });
    if (picked === undefined) {
      return;
    }
    await this.conversationStore.selectConversation(picked.id);
    await this.sendInitState();
  }

  public fillPromptForSelection(kind: "explain" | "fix"): void {
    const prompt = kind === "explain" ? "Giải thích đoạn code đang chọn." : "Tìm lỗi và đề xuất bản sửa cho đoạn code đang chọn.";
    void this.attachSelection();
    void this.openChatPanel();
    this.send({ type: "composer:setText", text: prompt });
  }

  public async showLastRequest(): Promise<void> {
    const snapshot = this.client.getLastRequest();
    const content = snapshot === null
      ? JSON.stringify({ message: "Chưa có request chat nào." }, null, 2)
      : JSON.stringify(snapshot, null, 2);
    const document = await vscode.workspace.openTextDocument({ content, language: "json" });
    await vscode.window.showTextDocument(document, { preview: false });
  }

  public async showAgentInstructions(): Promise<void> {
    const content = buildRuntimePolicyPrompt("agent", this.accessMode);
    const document = await vscode.workspace.openTextDocument({ content, language: "markdown" });
    await vscode.window.showTextDocument(document, { preview: false });
  }

  public async showToolDefinitions(): Promise<void> {
    const content = JSON.stringify(getAgentToolDefinitionsForDisplay(), null, 2);
    const document = await vscode.workspace.openTextDocument({ content, language: "json" });
    await vscode.window.showTextDocument(document, { preview: false });
  }

  public dispose(): void {
    this.quotaStream.dispose();
    this.chatService.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async handleMessage(message: ReturnType<typeof parseInboundMessage> & {}): Promise<void> {
    switch (message.type) {
      case "webview:ready":
        await this.initializeFromSecret();
        await this.sendInitState();
        break;
      case "chat:open":
        await this.openChatPanel();
        break;
      case "auth:save":
        await this.saveApiKey(message.apiKey);
        break;
      case "auth:validate":
        await this.validateApiKey(message.apiKey);
        break;
      case "auth:remove":
        await this.removeApiKey();
        break;
      case "model:refresh":
        await this.refreshModels(true);
        break;
      case "model:select":
        this.selectedModel = await this.modelService.setSelectedModel(message.modelId, this.models);
        this.send({ type: "model:list", models: this.models, selectedModel: this.selectedModel });
        break;
      case "quota:refresh":
        await this.refreshQuota(true);
        break;
      case "usage:load":
        await this.loadUsage();
        break;
      case "chat:new":
        await this.newChat();
        break;
      case "chat:clear":
        await this.clearChat();
        break;
      case "chat:clearAll":
        await this.clearAllHistory();
        break;
      case "chat:delete":
        await this.deleteConversation(message.conversationId);
        break;
      case "chat:setMode":
        this.chatMode = message.mode;
        await this.sendInitState();
        break;
      case "chat:setAccess":
        this.accessMode = message.accessMode;
        await this.sendInitState();
        break;
      case "chat:select":
        await this.conversationStore.selectConversation(message.conversationId);
        await this.sendInitState();
        break;
      case "chat:send":
        await this.sendChat(message.text);
        break;
      case "chat:stop":
        this.stopAgent();
        break;
      case "context:attachSelection":
        await this.attachSelection();
        break;
      case "context:attachActiveFile":
        await this.attachActiveFile();
        break;
      case "context:chooseFiles":
        await this.chooseFiles();
        break;
      case "context:openMenu":
        await this.openAttachmentMenu();
        break;
      case "context:attachImage":
        this.addPastedImage(message.name, message.mimeType, message.dataUri, message.bytes);
        break;
      case "context:remove":
        this.contexts = this.contexts.filter((context) => context.id !== message.id);
        this.sendContext();
        break;
      case "context:clear":
        this.contexts = [];
        this.sendContext();
        break;
      case "code:copy":
        await copyCode(message.code);
        break;
      case "code:insert": {
        const { settings } = getSettings();
        await insertAtCursor(message.code, this.shouldConfirmBeforeApply(settings.confirmBeforeApply));
        break;
      }
      case "code:replace": {
        const { settings } = getSettings();
        await replaceSelection(message.code, this.shouldConfirmBeforeApply(settings.confirmBeforeApply));
        break;
      }
      case "code:open":
        await openInNewEditor(message.code, message.language);
        break;
      case "link:open":
        await vscode.env.openExternal(vscode.Uri.parse(message.href));
        break;
      case "settings:open":
        await vscode.commands.executeCommand("workbench.action.openSettings", "vRouterSmart");
        break;
      case "history:open":
        await this.showHistoryQuickPick();
        break;
      case "request:showLast":
        await this.showLastRequest();
        break;
      default:
        break;
    }
  }

  private async sendInitState(target?: vscode.Webview, surface?: WebviewSurface): Promise<void> {
    const { settings, warnings } = getSettings();
    this.logSettingsWarnings(warnings);
    const hasKey = await this.apiKeyService.hasApiKey();
    const state = (currentSurface: WebviewSurface): WebviewInitState => ({
      surface: currentSurface,
      serverOrigin: settings.serverOrigin,
      auth: this.sessionService.toViewState(hasKey),
      models: this.models,
      selectedModel: this.selectedModel,
      quota: this.quotaService.getCachedQuota(),
      usage: this.usage,
      conversations: this.conversationStore.getData().conversations,
      activeConversationId: this.conversationStore.getData().activeConversationId,
      context: this.contextView(),
      isStreaming: this.chatService.isStreaming,
      chatMode: this.chatMode,
      accessMode: this.accessMode
    });
    if (target !== undefined) {
      void target.postMessage({ type: "state:init", state: state(surface ?? "chat") } satisfies OutboundMessage);
      return;
    }
    this.send({ type: "state:init", state: state("chat") }, "chat");
  }

  private async sendChat(text: string): Promise<void> {
    const trimmed = text.trim();
    const fallbackText = this.contexts.length > 0 ? "Hãy phân tích nội dung đã đính kèm." : "";
    const userText = trimmed.length > 0 ? trimmed : fallbackText;
    if (userText.length === 0) {
      this.send({ type: "notification", level: "warning", message: "Nội dung chat không được rỗng." });
      return;
    }
    const { settings, warnings } = getSettings();
    this.logSettingsWarnings(warnings);
    if (this.chatMode === "agent" && !settings.agentEnabled) {
      this.send({ type: "notification", level: "error", message: "Agent Mode đang bị tắt trong settings." });
      return;
    }
    if (settings.autoAttachSelection) {
      const selection = getSelectionContext();
      if (selection !== null && !this.contexts.some((context) => context.path === selection.path && context.lineRange === selection.lineRange)) {
        this.contexts.push(selection);
      }
    }
    const limit = evaluateContextLimits(this.contexts, settings.maxContextBytes, settings.maxFileContextBytes);
    if (!limit.ok) {
      this.send({ type: "notification", level: "error", message: limit.error ?? "Context vượt giới hạn." });
      return;
    }
    const decision = evaluateQuota(this.quotaService.getCachedQuota());
    if (!decision.allowed) {
      await this.refreshQuota(true);
    }
    try {
      const conversation = this.conversationStore.getActiveConversation();
      await this.chatService.send(userText, this.selectedModel, this.contexts, settings, this.chatMode, this.accessMode, {
        onUserMessage: (message) => this.send({ type: "chat:message", conversationId: conversation.id, message }),
        onAssistantMessage: (message) => {
          this.send({ type: "chat:message", conversationId: conversation.id, message });
          this.send({ type: "chat:started", conversationId: conversation.id, assistantMessageId: message.id });
        },
        onDelta: (messageId, delta) => this.send({ type: "chat:delta", conversationId: conversation.id, messageId, delta }),
        onCompleted: (message, usage) => {
          this.contexts = [];
          this.send({ type: "chat:completed", conversationId: conversation.id, messageId: message.id, usage });
          this.sendContext();
          void this.refreshQuota(true).catch((error: unknown) => this.logger.warn("Quota refresh after chat failed", error));
        },
        onCancelled: (message) => this.send({ type: "chat:cancelled", conversationId: conversation.id, messageId: message.id }),
        onError: (message, error) => {
          const outbound: OutboundMessage = {
            type: "chat:error",
            conversationId: conversation.id,
            message: error.message
          };
          if (message?.id !== undefined) {
            outbound.messageId = message.id;
          }
          this.send(outbound);
        }
      });
    } catch (error) {
      this.notifyError(error);
    }
  }

  private addContexts(nextContexts: ResolvedContextAttachment[]): void {
    const unique = [...this.contexts];
    for (const context of nextContexts) {
      if (!unique.some((item) => item.path === context.path && item.lineRange === context.lineRange)) {
        unique.push(context);
      }
    }
    const { settings, warnings } = getSettings();
    this.logSettingsWarnings(warnings);
    const limit = evaluateContextLimits(unique, settings.maxContextBytes, settings.maxFileContextBytes);
    if (!limit.ok) {
      this.send({ type: "notification", level: "error", message: limit.error ?? "Context vượt giới hạn." });
      return;
    }
    this.contexts = unique;
    this.sendContext();
  }

  private sendContext(): void {
    this.send({ type: "context:update", context: this.contextView() });
  }

  private contextView(): ContextAttachment[] {
    return this.contexts.map((context) => {
      const metadata: ContextAttachment = {
        id: context.id,
        kind: context.kind,
        path: context.path,
        language: context.language,
        bytes: context.bytes,
        tokenEstimate: context.tokenEstimate
      };
      if (context.lineRange !== undefined) {
        metadata.lineRange = context.lineRange;
      }
      if (context.warning !== undefined) {
        metadata.warning = context.warning;
      }
      if (context.mimeType !== undefined) {
        metadata.mimeType = context.mimeType;
      }
      if (context.previewDataUri !== undefined) {
        metadata.previewDataUri = context.previewDataUri;
      }
      return metadata;
    });
  }

  private send(message: OutboundMessage, surface?: WebviewSurface): void {
    if ((surface === undefined || surface === "admin" || surface === "chat") && this.adminView !== null) {
      void this.adminView.webview.postMessage(message);
    }
  }

  private async revealChatView(): Promise<void> {
    const attempts = [
      { container: SECONDARY_VIEW_CONTAINER_ID, view: CHAT_SECONDARY_VIEW_ID },
      { container: VIEW_CONTAINER_ID, view: CHAT_VIEW_ID }
    ];
    for (const attempt of attempts) {
      try {
        await vscode.commands.executeCommand(`workbench.view.extension.${attempt.container}`);
        await vscode.commands.executeCommand(`${attempt.view}.focus`);
        return;
      } catch {
        // Try the fallback location when the current VS Code build does not expose this view.
      }
    }
    await vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
  }

  private async confirmReadAccess(target: string): Promise<boolean> {
    if (this.accessMode !== "review_edits") {
      return true;
    }
    const choice = await vscode.window.showWarningMessage(
      `V-Router muốn đọc ${target} để đưa vào context. Cho phép thao tác này?`,
      { modal: true },
      "Cho phép"
    );
    return choice === "Cho phép";
  }

  private shouldConfirmBeforeApply(configuredConfirm: boolean): boolean {
    if (this.accessMode === "full_agent" || this.accessMode === "auto_apply_safe") {
      return false;
    }
    if (this.accessMode === "read_only" || this.accessMode === "review_edits") {
      return true;
    }
    return configuredConfirm;
  }

  private applyDefaultModeSettings(): void {
    const { settings, warnings } = getSettings();
    this.logSettingsWarnings(warnings);
    if (this.chatMode === "chat" && settings.defaultMode !== "chat") {
      this.chatMode = settings.defaultMode;
    }
    if (this.accessMode === "review_edits" && settings.agentPermissionMode !== "review_edits") {
      this.accessMode = settings.agentPermissionMode;
    }
  }

  private notifyError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error("Operation failed", message);
    this.send({ type: "notification", level: "error", message });
  }

  private logSettingsWarnings(warnings: Array<{ key: string; message: string }>): void {
    for (const warning of warnings) {
      this.logger.warn(`Setting ${warning.key}: ${warning.message}`);
    }
  }

  private configureWebview(webview: vscode.Webview, surface: WebviewSurface): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
        vscode.Uri.joinPath(this.extensionUri, "media")
      ]
    };
    webview.html = this.getHtml(webview, surface);
  }

  private registerWebviewMessageHandler(webview: vscode.Webview): void {
    this.disposables.push(webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseInboundMessage(raw);
      if (message === null) {
        this.send({ type: "notification", level: "warning", message: "Webview message không hợp lệ." });
        return;
      }
      void this.handleMessage(message).catch((error: unknown) => this.notifyError(error));
    }));
  }

  private getHtml(webview: vscode.Webview, surface: WebviewSurface): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main.css"));
    const nonce = crypto.randomUUID().replace(/-/g, "");
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>${surface === "chat" ? "V-Router" : "V-Router Smart"}</title>
</head>
<body data-surface="${surface}">
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function formatRelativeAge(value: string): string {
  const deltaMs = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) {
    return "now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}
