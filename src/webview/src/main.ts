import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import "./styles/main.css";
import type { ChatAccessMode, ChatMode, Conversation, ConversationMessage, ContextAttachment } from "../../chat/types";
import type { ModelEntry, QuotaSnapshot } from "../../api/types";
import type { InboundMessage, OutboundMessage, WebviewInitState } from "../../protocol";
import { ACCESS_OPTIONS, MODE_OPTIONS, compactModelName, formatRelativeTime } from "./app/AppState";

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
let pastedImageCounter = 0;
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
    app.appendChild(renderOnboarding());
    app.appendChild(renderNotificationsRegion());
    return;
  }
  app.appendChild(renderChat());
  app.appendChild(renderComposer());
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

function renderOnboarding(): HTMLElement {
  const current = requireState();
  const wrap = el("main", "onboarding compact-onboarding");
  const hero = el("section", "onboarding-hero");
  hero.appendChild(renderVRouterMark("large-mark"));
  hero.appendChild(el("h1", undefined, "V-Router Smart"));
  hero.appendChild(el("p", undefined, "Kết nối coding agent với endpoint V-Router cố định."));
  wrap.appendChild(hero);

  const server = el("section", "panel");
  server.appendChild(el("label", "field-label", "V-Router endpoint cố định"));
  server.appendChild(el("code", "server-code", current.serverOrigin));
  wrap.appendChild(server);

  const form = el("section", "panel auth-panel");
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
  server.appendChild(el("label", "field-label", "V-Router endpoint cố định"));
  server.appendChild(el("code", "server-code", state?.serverOrigin ?? ""));
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
  const messages = el("section", conversation.messages.length === 0 ? "messages empty-messages" : "messages");
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
  const head = el("div", "task-list-head");
  head.appendChild(el("div", "task-list-label", "Tasks"));
  const actions = el("div", "task-list-actions");
  actions.appendChild(button("Clear", "task-action", () => post({ type: "chat:clear" }), "Clear current chat"));
  actions.appendChild(button("Clear all", "task-action", () => post({ type: "chat:clearAll" }), "Clear all chat history"));
  head.appendChild(actions);
  list.appendChild(head);
  for (const conversation of current.conversations.slice(0, 4)) {
    const row = button("", conversation.id === current.activeConversationId ? "task-row active" : "task-row", () => {
      post({ type: "chat:select", conversationId: conversation.id });
    });
    row.appendChild(el("span", "task-title", conversation.title));
    const meta = el("span", "task-meta");
    meta.appendChild(el("span", "task-time", formatRelativeTime(conversation.updatedAt)));
    const deleteButton = button("×", "task-delete", () => post({ type: "chat:delete", conversationId: conversation.id }), `Xóa ${conversation.title}`);
    deleteButton.addEventListener("click", (event) => event.stopPropagation());
    meta.appendChild(deleteButton);
    row.appendChild(meta);
    list.appendChild(row);
  }
  if (current.conversations.length > 4) {
    list.appendChild(button(`View all (${current.conversations.length})`, "task-list-more", () => post({ type: "history:open" })));
  }
  return list;
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

function renderEmptyState(): HTMLElement {
  const empty = el("section", "empty");
  empty.appendChild(renderVRouterMark("empty-mark"));
  return empty;
}

function renderVRouterMark(className: string): HTMLElement {
  const mark = el("div", className);
  mark.setAttribute("aria-hidden", "true");
  mark.appendChild(el("span", "mark-node", "V"));
  return mark;
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
  const box = el("section", "composer-box");
  box.appendChild(renderContextChips(state?.context ?? []));
  const textarea = el("textarea", "composer-input");
  textarea.placeholder = state?.chatMode === "agent" ? "Do anything" : state?.chatMode === "edit" ? "Edit selected code" : "Ask anything";
  textarea.value = draft;
  textarea.rows = 3;
  textarea.disabled = state?.isStreaming === true;
  autoGrowTextarea(textarea);
  textarea.addEventListener("input", () => {
    draft = textarea.value;
    autoGrowTextarea(textarea);
    persistDraft();
  });
  textarea.addEventListener("paste", handleComposerPaste);
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
  left.appendChild(button("+", "attach-button", () => post({ type: "context:openMenu" }), "Attach context"));
  left.appendChild(renderAccessSelect());
  left.appendChild(renderModeToggle());
  tools.appendChild(left);

  const right = el("div", "composer-right");
  right.appendChild(renderComposerModelSelect());
  const canSend = state !== null && state.selectedModel.length > 0 && !state.isStreaming && (draft.trim().length > 0 || state.context.length > 0);
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
  const current = state?.chatMode ?? "chat";
  const wrap = el("div", "mode-toggle");
  for (const [mode, label] of MODE_OPTIONS) {
    wrap.appendChild(button(label, current === mode ? "mode-option active" : "mode-option", () => setChatMode(mode)));
  }
  return wrap;
}

function renderAccessSelect(): HTMLElement {
  const select = el("select", "access-select");
  select.setAttribute("aria-label", "Access mode");
  for (const [value, label] of ACCESS_OPTIONS) {
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

function setChatMode(mode: ChatMode): void {
  if (state !== null) {
    state.chatMode = mode;
  }
  post({ type: "chat:setMode", mode });
  scheduleRender();
}

function cycleChatMode(): void {
  const current = state?.chatMode ?? "chat";
  setChatMode(current === "chat" ? "edit" : current === "edit" ? "agent" : "chat");
}

function autoGrowTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
}

function handleComposerPaste(event: ClipboardEvent): void {
  const items = event.clipboardData?.items;
  if (items === undefined) {
    return;
  }
  const imageItem = [...items].find((item) => item.kind === "file" && item.type.startsWith("image/"));
  const file = imageItem?.getAsFile();
  if (file === null || file === undefined) {
    return;
  }
  event.preventDefault();
  attachImageFile(file);
}

function attachImageFile(file: File): void {
  if (!file.type.startsWith("image/")) {
    showToast("Clipboard không chứa ảnh hợp lệ.", "warning");
    return;
  }
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    if (typeof reader.result !== "string") {
      showToast("Không thể đọc ảnh từ clipboard.", "error");
      return;
    }
    pastedImageCounter += 1;
    post({
      type: "context:attachImage",
      name: file.name.length > 0 ? file.name : `pasted-image-${pastedImageCounter}.png`,
      mimeType: file.type,
      dataUri: reader.result,
      bytes: file.size
    });
  });
  reader.addEventListener("error", () => showToast("Không thể đọc ảnh từ clipboard.", "error"));
  reader.readAsDataURL(file);
}

function renderContextChips(context: ContextAttachment[]): HTMLElement {
  const wrap = el("div", "context-chips");
  if (context.length === 0) {
    wrap.classList.add("empty-context");
    return wrap;
  }
  const totalBytes = context.reduce((sum, item) => sum + item.bytes, 0);
  const totalTokens = context.reduce((sum, item) => sum + item.tokenEstimate, 0);
  wrap.appendChild(el("span", "context-summary", `${context.length} attachment${context.length === 1 ? "" : "s"} · ${Math.round(totalBytes / 1024)} KB · ~${totalTokens} token`));
  for (const item of context) {
    const chip = el("span", item.kind === "image" ? "chip image-chip" : "chip");
    chip.title = `${item.path} (${item.bytes} bytes)`;
    if (item.kind === "image" && item.previewDataUri !== undefined) {
      const preview = document.createElement("img");
      preview.src = item.previewDataUri;
      preview.alt = "";
      chip.appendChild(preview);
    }
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
  if (state === null || state.selectedModel.length === 0 || (text.length === 0 && state.context.length === 0)) {
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
