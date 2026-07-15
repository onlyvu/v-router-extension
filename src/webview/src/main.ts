import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import "./styles/main.css";
import type { ChatAccessMode, ChatMode, Conversation, ConversationMessage, ContextAttachment } from "../../chat/types";
import type { ModelEntry, QuotaSnapshot } from "../../api/types";
import type { InboundMessage, OutboundMessage, WebviewInitState } from "../../protocol";

interface VsCodeApi {
  postMessage(message: InboundMessage): void;
  getState(): { draft?: string; modelFilter?: string } | undefined;
  setState(state: { draft: string; modelFilter: string }): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

let state: WebviewInitState | null = null;
let draft = vscode.getState()?.draft ?? "";
let modelFilter = vscode.getState()?.modelFilter ?? "";
let apiBusy = false;
let renderTimer: number | null = null;
const surface = document.body.dataset.surface === "chat" ? "chat" : "admin";

const appRoot = document.getElementById("app");
if (appRoot === null) {
  throw new Error("Missing app root");
}
const app: HTMLElement = appRoot;

function post(message: InboundMessage): void {
  vscode.postMessage(message);
}

function persistDraft(): void {
  vscode.setState({ draft, modelFilter });
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function button(label: string, className: string, onClick: () => void, title?: string): HTMLButtonElement {
  const node = el("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  if (title !== undefined) {
    node.title = title;
    node.setAttribute("aria-label", title);
  }
  return node;
}

function scheduleRender(): void {
  if (renderTimer !== null) {
    return;
  }
  renderTimer = window.setTimeout(() => {
    renderTimer = null;
    render();
  }, 40);
}

function render(): void {
  app.replaceChildren();
  app.className = surface === "chat" ? "surface-chat" : "surface-admin";
  if (state === null) {
    app.appendChild(el("div", "loading", "Đang tải V-Router Smart..."));
    return;
  }
  if (surface === "admin") {
    app.appendChild(renderHeader());
    if (!state.auth.hasKey) {
      app.appendChild(renderOnboarding());
    } else {
      app.appendChild(renderAdminDashboard());
    }
    app.appendChild(renderNotificationsRegion());
    return;
  }

  if (!state.auth.hasKey) {
    app.appendChild(renderChatHeader());
    app.appendChild(renderOnboarding());
    app.appendChild(renderNotificationsRegion());
    return;
  }
  app.appendChild(renderChatHeader());
  app.appendChild(renderChat());
  app.appendChild(renderComposer());
  app.appendChild(renderQuotaBar(state.quota));
  app.appendChild(renderNotificationsRegion());
}

function renderHeader(): HTMLElement {
  const header = el("header", "topbar");
  const brand = el("div", "brand");
  brand.appendChild(el("div", "brand-mark", "VR"));
  const copy = el("div", "brand-copy");
  copy.appendChild(el("strong", undefined, "V-Router Smart"));
  copy.appendChild(el("span", undefined, "Quản trị & cài đặt"));
  brand.appendChild(copy);
  header.appendChild(brand);

  const actions = el("div", "top-actions");
  actions.appendChild(button("Chat", "secondary", () => post({ type: "chat:open" }), "Mở tab chat V-Router"));
  actions.appendChild(button("⚙", "icon-button", () => post({ type: "settings:open" }), "Cài đặt"));
  actions.appendChild(button("{}", "icon-button", () => post({ type: "request:showLast" }), "Xem request gần nhất"));
  header.appendChild(actions);
  return header;
}

function renderChatHeader(): HTMLElement {
  const header = el("header", "chat-header workbench-header");
  const title = el("div", "chat-title");
  const activeTitle = state === null ? "Untitled" : getActiveConversation().title;
  title.appendChild(el("strong", undefined, activeTitle.length > 0 ? activeTitle : "Untitled"));
  header.appendChild(title);

  const controls = el("div", "chat-header-controls");
  controls.appendChild(button("+", "icon-button ghost", () => post({ type: "chat:new" }), "Chat mới"));
  controls.appendChild(button("↺", "icon-button ghost", () => post({ type: "chat:clear" }), "Clear chat"));
  controls.appendChild(button("{}", "icon-button ghost", () => post({ type: "request:showLast" }), "Xem request gần nhất"));
  controls.appendChild(button("...", "icon-button ghost", () => post({ type: "settings:open" }), "Cài đặt"));
  header.appendChild(controls);
  return header;
}

function renderOnboarding(): HTMLElement {
  const current = requireState();
  const wrap = el("main", "onboarding");
  const hero = el("section", "onboarding-hero");
  hero.appendChild(el("div", "large-mark", "VR"));
  hero.appendChild(el("h1", undefined, "V-Router Smart"));
  hero.appendChild(el("p", undefined, "Trợ lý lập trình AI kết nối trực tiếp với V-Router"));
  wrap.appendChild(hero);

  const server = el("section", "panel");
  server.appendChild(el("label", "field-label", "Server Origin"));
  server.appendChild(el("code", "server-code", current.serverOrigin));
  server.appendChild(button("Cài đặt nâng cao", "secondary full", () => post({ type: "settings:open" })));
  wrap.appendChild(server);

  const form = el("section", "panel");
  form.appendChild(el("label", "field-label", "API key"));
  const row = el("div", "password-row");
  const input = el("input", "input");
  input.type = "password";
  input.placeholder = "Dán API key của bạn";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "API key");
  const toggle = button("Hiện", "secondary compact", () => {
    input.type = input.type === "password" ? "text" : "password";
    toggle.textContent = input.type === "password" ? "Hiện" : "Ẩn";
  });
  row.appendChild(input);
  row.appendChild(toggle);
  form.appendChild(row);
  const status = el("p", "muted", current.auth.message);
  form.appendChild(status);
  const controls = el("div", "button-row");
  controls.appendChild(button("Kiểm tra kết nối", "secondary", () => {
    apiBusy = true;
    const apiKey = input.value.trim();
    if (apiKey.length > 0) {
      post({ type: "auth:validate", apiKey });
    }
  }));
  controls.appendChild(button(apiBusy ? "Đang kiểm tra..." : "Kiểm tra & lưu", "primary", () => {
    apiBusy = true;
    const apiKey = input.value.trim();
    if (apiKey.length > 0) {
      post({ type: "auth:save", apiKey });
      input.value = "";
    }
  }));
  form.appendChild(controls);
  wrap.appendChild(form);
  return wrap;
}

function renderAdminDashboard(): HTMLElement {
  const wrap = el("main", "admin-dashboard");

  const status = el("section", "admin-card account-card");
  const statusHead = el("div", "admin-card-head");
  statusHead.appendChild(el("strong", undefined, state?.auth.keyName ?? "API key"));
  statusHead.appendChild(el("span", "status-pill", state?.auth.status ?? "unknown"));
  status.appendChild(statusHead);
  status.appendChild(el("p", "muted", state?.auth.message ?? ""));
  if (state?.auth.keyPrefix !== null && state?.auth.keyPrefix !== undefined) {
    status.appendChild(el("code", "server-code", state.auth.keyPrefix));
  }
  const accountActions = el("div", "button-row wrap");
  accountActions.appendChild(button("Mở Chat", "primary", () => post({ type: "chat:open" })));
  accountActions.appendChild(button("Kiểm tra key", "secondary", () => post({ type: "auth:validate" })));
  accountActions.appendChild(button("Thay API key", "secondary", () => post({ type: "auth:remove" })));
  status.appendChild(accountActions);
  wrap.appendChild(status);

  const server = el("section", "admin-card");
  server.appendChild(el("label", "field-label", "Server Origin"));
  server.appendChild(el("code", "server-code", state?.serverOrigin ?? ""));
  server.appendChild(button("Cài đặt nâng cao", "secondary full", () => post({ type: "settings:open" })));
  wrap.appendChild(server);

  const model = el("section", "admin-card");
  const modelHead = el("div", "admin-card-head");
  modelHead.appendChild(el("strong", undefined, "Model"));
  modelHead.appendChild(button("Refresh", "tiny", () => post({ type: "model:refresh" })));
  model.appendChild(modelHead);
  model.appendChild(renderModelPicker());
  wrap.appendChild(model);

  const quota = el("section", "admin-card");
  const quotaHead = el("div", "admin-card-head");
  quotaHead.appendChild(el("strong", undefined, "Quota"));
  quotaHead.appendChild(button("Refresh", "tiny", () => post({ type: "quota:refresh" })));
  quota.appendChild(quotaHead);
  quota.appendChild(renderQuotaBadge(state?.quota ?? null));
  wrap.appendChild(quota);

  const tools = el("section", "admin-card");
  tools.appendChild(el("strong", undefined, "Công cụ"));
  const toolRow = el("div", "button-row wrap");
  toolRow.appendChild(button("Request sạch", "secondary", () => post({ type: "request:showLast" })));
  toolRow.appendChild(button("VS Code Settings", "secondary", () => post({ type: "settings:open" })));
  tools.appendChild(toolRow);
  wrap.appendChild(tools);

  return wrap;
}

function renderChat(): HTMLElement {
  const main = el("main", "chat");
  const conversation = getActiveConversation();
  const messages = el("section", "messages");
  messages.setAttribute("aria-live", "polite");
  if (conversation.messages.length === 0) {
    messages.appendChild(renderConversationList());
    messages.appendChild(renderEmptyState());
  } else {
    for (const message of conversation.messages) {
      messages.appendChild(renderMessage(message));
    }
  }
  main.appendChild(messages);
  return main;
}

function renderConversationList(): HTMLElement {
  const current = requireState();
  const list = el("section", "task-list");
  list.appendChild(el("div", "task-list-label", "Tasks"));
  for (const conversation of current.conversations.slice(0, 4)) {
    const row = button(conversation.title, conversation.id === current.activeConversationId ? "task-row active" : "task-row", () => {
      post({ type: "chat:select", conversationId: conversation.id });
    });
    row.appendChild(el("span", undefined, formatRelativeTime(conversation.updatedAt)));
    list.appendChild(row);
  }
  if (current.conversations.length > 4) {
    list.appendChild(el("div", "task-list-more", `View all (${current.conversations.length})`));
  }
  return list;
}

function formatRelativeTime(value: string): string {
  const deltaMs = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) {
    return "now";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

function renderContextSummaryInline(context: ContextAttachment[]): HTMLElement {
  const node = el("div", "inline-context");
  if (context.length === 0) {
    node.textContent = "Không có context";
    return node;
  }
  const totalBytes = context.reduce((sum, item) => sum + item.bytes, 0);
  const totalTokens = context.reduce((sum, item) => sum + item.tokenEstimate, 0);
  node.textContent = `${context.length} context · ${Math.round(totalBytes / 1024)} KB · ~${totalTokens} token`;
  return node;
}

function renderModelPicker(): HTMLElement {
  const wrap = el("section", "model-box");
  const top = el("div", "model-row");
  const search = el("input", "input compact-input");
  search.placeholder = "Tìm model";
  search.value = modelFilter;
  search.setAttribute("aria-label", "Tìm model");
  search.addEventListener("input", () => {
    modelFilter = search.value;
    persistDraft();
    scheduleRender();
  });
  top.appendChild(search);
  top.appendChild(button("↻", "icon-button", () => post({ type: "model:refresh" }), "Refresh models"));
  wrap.appendChild(top);

  const select = el("select", "input");
  select.setAttribute("aria-label", "Chọn model");
  select.disabled = filteredModels().length === 0;
  const groups = groupModels(filteredModels());
  for (const [provider, models] of groups) {
    const group = document.createElement("optgroup");
    group.label = provider;
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = `${model.id} (${model.owned_by})`;
      option.selected = model.id === state?.selectedModel;
      group.appendChild(option);
    }
    select.appendChild(group);
  }
  select.addEventListener("change", () => post({ type: "model:select", modelId: select.value }));
  wrap.appendChild(select);
  return wrap;
}

function filteredModels(): ModelEntry[] {
  if (state === null) {
    return [];
  }
  const filter = modelFilter.trim().toLowerCase();
  if (filter.length === 0) {
    return state.models;
  }
  return state.models.filter((model) => `${model.id} ${model.owned_by}`.toLowerCase().includes(filter));
}

function groupModels(models: ModelEntry[]): Array<[string, ModelEntry[]]> {
  const map = new Map<string, ModelEntry[]>();
  for (const model of models) {
    const provider = model.owned_by.length > 0 ? model.owned_by : "unknown";
    const group = map.get(provider) ?? [];
    group.push(model);
    map.set(provider, group);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function renderQuotaBadge(quota: QuotaSnapshot | null): HTMLElement {
  const badge = el("section", "quota");
  if (quota === null) {
    badge.appendChild(el("strong", undefined, "Quota"));
    badge.appendChild(el("span", undefined, "Chưa xác minh"));
    badge.appendChild(button("↻", "icon-button", () => post({ type: "quota:refresh" }), "Refresh quota"));
    return badge;
  }
  badge.title = `Trạng thái: ${quota.effectiveStatus}. Used: ${quota.used}. Remaining: ${quota.remaining ?? "unlimited"}.`;
  badge.appendChild(el("strong", undefined, `${Math.round(quota.percentUsed)}%`));
  badge.appendChild(el("span", undefined, quota.remaining === null ? "Không giới hạn" : `${quota.remaining.toLocaleString()} token còn lại`));
  if (quota.resetAt !== null) {
    badge.appendChild(el("small", undefined, `Reset: ${new Date(quota.resetAt).toLocaleString()}`));
  }
  return badge;
}

function renderQuotaBar(quota: QuotaSnapshot | null): HTMLElement {
  const bar = el("footer", "quota-bar");
  const percent = quota === null ? 0 : Math.max(0, Math.min(100, Math.round(quota.percentUsed)));
  const left = el("div", "quota-bar-main");
  left.appendChild(el("strong", undefined, quota === null ? "Quota chưa xác minh" : `${percent}% quota đã dùng`));
  left.appendChild(el("span", undefined, quota === null
    ? "Bấm refresh trong quản trị nếu cần kiểm tra lại"
    : quota.remaining === null
      ? "Không giới hạn token"
      : `${quota.remaining.toLocaleString()} token còn lại`));
  const track = el("div", "quota-track");
  const fill = el("div", `quota-fill ${percent >= 95 ? "danger" : percent >= 80 ? "warning" : "ok"}`);
  fill.style.width = `${percent}%`;
  track.appendChild(fill);
  left.appendChild(track);
  bar.appendChild(left);

  const side = el("div", "quota-bar-side");
  side.appendChild(el("span", "status-pill", quota?.effectiveStatus ?? "unknown"));
  if (quota?.resetAt !== null && quota?.resetAt !== undefined) {
    side.appendChild(el("small", undefined, `Reset ${new Date(quota.resetAt).toLocaleString()}`));
  }
  bar.appendChild(side);
  return bar;
}

function renderEmptyState(): HTMLElement {
  const empty = el("section", "empty");
  const brand = el("div", "empty-brand");
  brand.appendChild(el("span", "empty-spark", "V"));
  brand.appendChild(el("strong", undefined, "V-Router"));
  empty.appendChild(brand);
  empty.appendChild(el("div", "empty-bot", "VR"));
  empty.appendChild(el("p", undefined, "Use Plan mode to talk through big changes before a commit. Press Shift Tab to cycle between modes."));
  return empty;
}

function renderMessage(message: ConversationMessage): HTMLElement {
  const wrap = el("article", `message ${message.role} ${message.status}`);
  const head = el("div", "message-head");
  head.appendChild(el("strong", undefined, message.role === "user" ? "Bạn" : "V-Router"));
  head.appendChild(el("span", undefined, new Date(message.createdAt).toLocaleTimeString()));
  wrap.appendChild(head);
  const body = el("div", "message-body");
  if (message.role === "assistant") {
    const markdownSource = message.content.length > 0 ? message.content : (message.status === "streaming" ? "Đang trả lời..." : "");
    const html = markdown.render(markdownSource);
    body.innerHTML = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "iframe", "object", "embed", "style"],
      FORBID_ATTR: ["onerror", "onload", "onclick", "style"]
    });
    decorateCodeBlocks(body);
    decorateLinks(body);
  } else {
    body.textContent = message.content;
  }
  wrap.appendChild(body);
  if (message.status === "streaming") {
    wrap.appendChild(el("div", "stream-cursor", "Đang stream..."));
  }
  if (message.status === "cancelled") {
    wrap.appendChild(el("div", "status-note", "Đã dừng"));
  }
  if (message.status === "error" && message.error !== undefined) {
    wrap.appendChild(el("div", "error-note", message.error));
  }
  return wrap;
}

function decorateCodeBlocks(container: HTMLElement): void {
  const blocks = container.querySelectorAll("pre > code");
  blocks.forEach((codeNode, index) => {
    const code = codeNode.textContent ?? "";
    const pre = codeNode.parentElement;
    if (pre === null) {
      return;
    }
    const languageClass = [...codeNode.classList].find((item) => item.startsWith("language-"));
    const language = languageClass?.replace("language-", "") ?? "plaintext";
    const wrapper = el("div", "code-wrap");
    const toolbar = el("div", "code-toolbar");
    toolbar.appendChild(el("span", "code-label", language));
    toolbar.appendChild(button("Copy", "tiny", () => post({ type: "code:copy", code }), `Copy code block ${index + 1}`));
    toolbar.appendChild(button("Insert", "tiny", () => post({ type: "code:insert", code }), `Insert code block ${index + 1}`));
    toolbar.appendChild(button("Replace", "tiny", () => post({ type: "code:replace", code }), `Replace selection with code block ${index + 1}`));
    toolbar.appendChild(button("Open", "tiny", () => post({ type: "code:open", code, language }), `Open code block ${index + 1}`));
    pre.replaceWith(wrapper);
    wrapper.appendChild(toolbar);
    wrapper.appendChild(pre);
  });
}

function decorateLinks(container: HTMLElement): void {
  container.querySelectorAll("a").forEach((anchor) => {
    const href = anchor.getAttribute("href");
    if (href === null) {
      return;
    }
    anchor.setAttribute("rel", "noreferrer noopener");
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      post({ type: "link:open", href });
    });
  });
}

function renderComposer(): HTMLElement {
  const composer = el("footer", "composer");
  composer.appendChild(renderContextChips(state?.context ?? []));
  const box = el("section", "composer-box");
  const textarea = el("textarea", "composer-input");
  textarea.placeholder = state?.chatMode === "plan" ? "Plan anything" : "Do anything";
  textarea.value = draft;
  textarea.rows = 3;
  textarea.disabled = state?.isStreaming === true;
  textarea.addEventListener("input", () => {
    draft = textarea.value;
    persistDraft();
  });
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      cycleChatMode();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendDraft();
    }
  });
  box.appendChild(textarea);
  const tools = el("div", "composer-tools");
  const left = el("div", "composer-left");
  left.appendChild(button("+", "icon-button ghost", () => post({ type: "context:chooseFiles" }), "Chọn file"));
  left.appendChild(button("/", "icon-button ghost", () => post({ type: "context:attachSelection" }), "Đính kèm selection"));
  left.appendChild(button("file", "compact-chip", () => post({ type: "context:attachActiveFile" }), "Đính kèm file hiện tại"));
  left.appendChild(renderModeToggle());
  tools.appendChild(left);

  const right = el("div", "composer-right");
  right.appendChild(renderAccessSelect());
  right.appendChild(renderComposerModelSelect());
  const canSend = state !== null && state.selectedModel.length > 0 && !state.isStreaming;
  right.appendChild(button(state?.isStreaming === true ? "■" : "↑", canSend || state?.isStreaming === true ? "send-button" : "send-button disabled", () => {
    if (state?.isStreaming === true) {
      post({ type: "chat:stop" });
    } else {
      sendDraft();
    }
  }, state?.isStreaming === true ? "Dừng" : "Gửi"));
  tools.appendChild(right);
  box.appendChild(tools);
  composer.appendChild(box);
  return composer;
}

function renderModeToggle(): HTMLElement {
  const current = state?.chatMode ?? "agent";
  const wrap = el("div", "mode-toggle");
  wrap.appendChild(button("Agent", current === "agent" ? "mode-option active" : "mode-option", () => setChatMode("agent")));
  wrap.appendChild(button("Plan", current === "plan" ? "mode-option active" : "mode-option", () => setChatMode("plan")));
  return wrap;
}

function renderAccessSelect(): HTMLElement {
  const select = el("select", "access-select");
  select.setAttribute("aria-label", "Access mode");
  const options: Array<[ChatAccessMode, string]> = [
    ["full", "Full access"],
    ["limited", "Limited"],
    ["ask", "Always ask"]
  ];
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === state?.accessMode;
    select.appendChild(option);
  }
  select.addEventListener("change", () => {
    const accessMode = select.value as ChatAccessMode;
    if (state !== null) {
      state.accessMode = accessMode;
    }
    post({ type: "chat:setAccess", accessMode });
    scheduleRender();
  });
  return select;
}

function renderComposerModelSelect(): HTMLElement {
  const select = el("select", "composer-model");
  select.setAttribute("aria-label", "Chọn model");
  select.disabled = state === null || state.models.length === 0 || state.isStreaming;
  if (state === null || state.models.length === 0) {
    const option = document.createElement("option");
    option.textContent = "No model";
    select.appendChild(option);
    return select;
  }
  for (const model of state.models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = compactModelName(model.id);
    option.selected = model.id === state.selectedModel;
    select.appendChild(option);
  }
  select.addEventListener("change", () => post({ type: "model:select", modelId: select.value }));
  return select;
}

function compactModelName(modelId: string): string {
  const clean = modelId.split("/").pop() ?? modelId;
  return clean.length > 18 ? `${clean.slice(0, 16)}...` : clean;
}

function setChatMode(mode: ChatMode): void {
  if (state !== null) {
    state.chatMode = mode;
  }
  post({ type: "chat:setMode", mode });
  scheduleRender();
}

function cycleChatMode(): void {
  setChatMode(state?.chatMode === "plan" ? "agent" : "plan");
}

function renderContextChips(context: ContextAttachment[]): HTMLElement {
  const wrap = el("div", "context-chips");
  if (context.length === 0) {
    wrap.classList.add("empty-context");
    return wrap;
  }
  const totalBytes = context.reduce((sum, item) => sum + item.bytes, 0);
  const totalTokens = context.reduce((sum, item) => sum + item.tokenEstimate, 0);
  wrap.appendChild(el("span", "context-summary", `${context.length} file/selection · ${Math.round(totalBytes / 1024)} KB · ~${totalTokens} token`));
  for (const item of context) {
    const chip = el("span", "chip");
    chip.title = `${item.path} (${item.bytes} bytes)`;
    chip.appendChild(el("span", undefined, `${item.path}${item.lineRange === undefined ? "" : `:${item.lineRange}`}`));
    chip.appendChild(button("×", "chip-close", () => post({ type: "context:remove", id: item.id }), "Xóa context"));
    wrap.appendChild(chip);
  }
  wrap.appendChild(button("Xóa tất cả", "tiny", () => post({ type: "context:clear" })));
  return wrap;
}

function renderNotificationsRegion(): HTMLElement {
  const region = el("div", "sr-only");
  region.setAttribute("aria-live", "assertive");
  return region;
}

function sendDraft(): void {
  if (state?.isStreaming === true) {
    post({ type: "chat:stop" });
    return;
  }
  const text = draft.trim();
  if (text.length === 0 || state === null || state.selectedModel.length === 0) {
    return;
  }
  post({ type: "chat:send", text });
  draft = "";
  persistDraft();
  scheduleRender();
}

function getActiveConversation(): Conversation {
  const current = requireState();
  const existing = current.conversations.find((conversation) => conversation.id === current.activeConversationId);
  if (existing !== undefined) {
    return existing;
  }
  const first = current.conversations[0];
  if (first === undefined) {
    throw new Error("No conversation available");
  }
  return first;
}

function requireState(): WebviewInitState {
  if (state === null) {
    throw new Error("state missing");
  }
  return state;
}

function upsertMessage(conversationId: string, message: ConversationMessage): void {
  if (state === null) {
    return;
  }
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (conversation === undefined) {
    return;
  }
  const existing = conversation.messages.findIndex((item) => item.id === message.id);
  if (existing >= 0) {
    conversation.messages[existing] = message;
  } else {
    conversation.messages.push(message);
  }
}

function appendDelta(conversationId: string, messageId: string, delta: string): void {
  if (state === null) {
    return;
  }
  const message = state.conversations
    .find((conversation) => conversation.id === conversationId)
    ?.messages.find((item) => item.id === messageId);
  if (message !== undefined) {
    message.content += delta;
    message.status = "streaming";
  }
}

window.addEventListener("message", (event: MessageEvent<OutboundMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "state:init":
      state = message.state;
      apiBusy = false;
      render();
      break;
    case "auth:status":
      if (state !== null) {
        state.auth = message.auth;
      }
      apiBusy = false;
      render();
      break;
    case "model:list":
      if (state !== null) {
        state.models = message.models;
        state.selectedModel = message.selectedModel;
      }
      render();
      break;
    case "quota:update":
      if (state !== null) {
        state.quota = message.quota;
      }
      render();
      break;
    case "usage:update":
      if (state !== null) {
        state.usage = message.usage;
      }
      break;
    case "chat:conversation":
      if (state !== null) {
        const index = state.conversations.findIndex((conversation) => conversation.id === message.conversation.id);
        if (index >= 0) {
          state.conversations[index] = message.conversation;
        } else {
          state.conversations.unshift(message.conversation);
        }
        state.activeConversationId = message.conversation.id;
      }
      render();
      break;
    case "chat:message":
      upsertMessage(message.conversationId, message.message);
      scheduleRender();
      break;
    case "chat:started":
      if (state !== null) {
        state.isStreaming = true;
      }
      scheduleRender();
      break;
    case "chat:delta":
      appendDelta(message.conversationId, message.messageId, message.delta);
      scheduleRender();
      break;
    case "chat:completed":
      if (state !== null) {
        state.isStreaming = false;
      }
      scheduleRender();
      break;
    case "chat:cancelled":
      if (state !== null) {
        state.isStreaming = false;
      }
      scheduleRender();
      break;
    case "chat:error":
      if (state !== null) {
        state.isStreaming = false;
      }
      showToast(message.message, "error");
      scheduleRender();
      break;
    case "context:update":
      if (state !== null) {
        state.context = message.context;
      }
      render();
      break;
    case "composer:setText":
      draft = message.text;
      persistDraft();
      render();
      break;
    case "notification":
      showToast(message.message, message.level);
      break;
    case "settings:update":
      if (state !== null) {
        state.serverOrigin = message.serverOrigin;
      }
      render();
      break;
    default:
      break;
  }
});

function showToast(message: string, level: "info" | "warning" | "error"): void {
  const toast = el("div", `toast ${level}`, message);
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

post({ type: "webview:ready" });
render();
