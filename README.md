# V-Router Smart

V-Router Smart là VS Code Extension cung cấp sidebar chat AI độc lập, kết nối trực tiếp tới V-Router qua OpenAI-compatible Chat Completions API. Extension không dùng GitHub Copilot Chat, không kế thừa system prompt của Copilot và mặc định không gửi system prompt.

## Tính năng

- Activity Bar và sidebar riêng: `vRouterSmart.chatView`.
- Sidebar bên trái dùng cho quản trị, API key, model, quota và settings.
- Chat chạy trong tab editor riêng tên `V-Router`, mở bằng command `V-Router Smart: Open Chat` hoặc nút `Chat` trong sidebar.
- Quota hiển thị ở cả thanh dưới của tab chat và VS Code Status Bar bên phải.
- Lưu API key bằng VS Code SecretStorage (`vRouterSmart.apiKey`).
- Xác thực qua `POST /api/client/auth`, giữ cookie `client_token` trong memory.
- Lấy model qua `GET /v1/models`, fallback `GET /api/client/models`.
- Chat streaming qua `POST /v1/chat/completions`.
- Quota/key status trước mỗi request.
- Đính kèm selection, file hiện tại hoặc file do bạn chọn.
- Context được đưa vào user message theo block hiển thị rõ, không giấu trong system prompt.
- Render Markdown/code block đã sanitize, có Copy, Insert, Replace và Open in New Editor.
- Lịch sử hội thoại lưu cục bộ theo workspace, không lưu API key/cookie.
- Command `V-Router Smart: Show Last Sanitized Request` để kiểm tra payload sạch.

## Cài đặt từ VSIX

```bash
code --install-extension v-router-smart-0.1.0.vsix
```

Sau khi cài, mở Activity Bar biểu tượng V-Router Smart để quản trị API key/model/quota. Bấm `Chat` hoặc chạy `V-Router Smart: Open Chat` để mở tab chat riêng ở vùng editor bên phải.

## Nhập API key

1. Mở sidebar V-Router Smart.
2. Dán API key vào ô password.
3. Bấm `Kiểm tra kết nối` nếu chỉ muốn thử.
4. Bấm `Kiểm tra & lưu` để xác thực và lưu bằng SecretStorage.

API key không được lưu vào settings, history, webview state, log hoặc request inspector. Khi đổi `vRouterSmart.serverOrigin`, extension yêu cầu xác thực lại API key.

## Chọn model và chat

Sau khi xác thực thành công, model picker tải danh sách model bạn được phép dùng. Có thể tìm kiếm, refresh và chọn model theo provider alias. Nút Send bị vô hiệu nếu chưa chọn model hợp lệ hoặc quota/key không active.

## Đính kèm context

- `Đính kèm selection`: gửi đoạn code đang chọn.
- `Đính kèm file hiện tại`: gửi nội dung file đang mở.
- `Chọn file`: chọn nhiều file từ workspace.

Extension không tự đọc toàn bộ workspace. Các file `.env`, private key, binary, `.git/`, `node_modules/` và file vượt giới hạn sẽ bị chặn hoặc cảnh báo.

## Quota

Sidebar hiển thị phần trăm sử dụng, token còn lại, trạng thái key và thời điểm reset nếu có. Trước mỗi request, extension gọi `/api/client/me` khi cache quota hết hạn và chặn request nếu `effectiveStatus !== "active"`.

## Kiểm tra request sạch

Chạy command:

```text
V-Router Smart: Show Last Sanitized Request
```

Document read-only sẽ hiển thị URL, method, model, messages và parameter không nhạy cảm. Authorization, API key, Cookie và session token được redact. Mặc định payload chỉ có user/assistant history do V-Router Smart quản lý; system prompt chỉ xuất hiện nếu bạn tự cấu hình `vRouterSmart.systemPrompt`.

## Đổi endpoint

Setting mặc định:

```json
"vRouterSmart.serverOrigin": "https://v-router.fpt.ovh"
```

HTTP chỉ được chấp nhận cho `localhost`, `127.0.0.1` hoặc `[::1]`. Extension không có tùy chọn bỏ qua TLS/certificate validation.

## Commands

- `V-Router Smart: Open Chat`
- `V-Router Smart: Set or Replace API Key`
- `V-Router Smart: Remove API Key`
- `V-Router Smart: Validate API Key`
- `V-Router Smart: Refresh Models`
- `V-Router Smart: Refresh Quota`
- `V-Router Smart: New Chat`
- `V-Router Smart: Attach Selection`
- `V-Router Smart: Explain Selected Code`
- `V-Router Smart: Fix Selected Code`
- `V-Router Smart: Show Last Sanitized Request`
- `V-Router Smart: Open Logs`

## Settings

Các setting chính: `serverOrigin`, `defaultModel`, `systemPrompt`, `streaming`, `requestTimeoutMs`, `streamStallTimeoutMs`, `quotaCacheTtlMs`, `modelCacheTtlMs`, `autoAttachSelection`, `maxContextBytes`, `maxFileContextBytes`, `confirmBeforeApply`, `debugLogging`, `temperatureEnabled`, `temperature`, `maxTokensEnabled`, `maxTokens`.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm run compile
npm test
npm run vsix
```

F5 trong VS Code sẽ mở Extension Development Host.

Trước khi publish Marketplace, hãy đổi `publisher` và `repository` trong `package.json` sang thông tin thật của bạn. Giá trị hiện tại (`vrouter-smart`) là publisher local hợp lệ để build VSIX.

## Troubleshooting

- API key invalid: kiểm tra lại key và server origin.
- API key expired: gia hạn key trên V-Router.
- Quota exceeded: chờ reset daily hoặc tăng hạn mức.
- Model not allowed: refresh model, chọn model khác được phép.
- Model not found: refresh danh sách model.
- Rate limited: thử lại sau thời gian `Retry-After`.
- Server unavailable: kiểm tra endpoint và kết nối mạng.
- Stream bị ngắt: phần output đã nhận được giữ lại; bấm gửi lại nếu cần.
- Không thấy model: bấm refresh model hoặc xác thực lại API key.
- Không thể attach file: kiểm tra kích thước, binary, secret filename hoặc workspace trust.
- VSIX không build được: chạy `npm install`, `npm run compile`, sau đó `npm run vsix`.

## Privacy

Extension gửi prompt và context bạn chọn tới server V-Router. Extension không có telemetry mặc định, không tự đọc toàn bộ workspace và lưu conversation history cục bộ. Xem thêm [PRIVACY.md](PRIVACY.md).

## Giới hạn hiện tại

Phiên bản MVP không tự chạy terminal command từ output AI, không có telemetry và chỉ hỗ trợ chat text/code qua Chat Completions.
