# V-Router Quota Check — Hướng dẫn tích hợp cho Extension/Client

Tài liệu này mô tả cách tích hợp tính năng kiểm tra quota API key từ V-Router vào extension hoặc client của bạn. Tất cả endpoint đều là **REST/SSE**, không cần SDK đặc biệt.

> **Base URL mặc định**: `https://v-router.fpt.ovh/` (thay đổi theo cấu hình V-Router của bạn)

---

## 1. Luồng tổng quan

```
Client/Extension          V-Router Server
     │                         │
     ├─ POST /api/client/auth ─┤  (1) Xác thực API key, nhận cookie JWT
     │◄──── cookie + quota ────┤
     │                         │
     ├─ GET /api/client/me ────┤  (2) Lấy thông tin key + quota hiện tại
     │◄──── key info + quota ──┤
     │                         │
     ├─ GET /api/client/usage ─┤  (3) Lấy biểu đồ + lịch sử dùng
     │◄──── chart + history ───┤
     │                         │
     ├─ GET /api/client/models ┤  (4) Lấy danh sách model khả dụng
     │◄──── models list ───────┤
     │                         │
     ├─ GET /api/client/stream ┤  (5) SSE real-time quota updates
     │◄══ event: quota ════════┤
     │◄══ event: notification ═┤
```

---

## 2. Bước 1: Xác thực — `POST /api/client/auth`

Xác thực API key để lấy session cookie. Cookie này sẽ tự động được gửi kèm trong các request sau.

### Request

```http
POST /api/client/auth
Content-Type: application/json

{
  "apiKey": "sk-vrouter-xxxxxxxxxxxxx"
}
```

### Response (200 OK)

```json
{
  "success": true,
  "key": {
    "id": 1,
    "name": "My Key",
    "keyPrefix": "sk-vroute...xxxx",
    "isActive": true,
    "quotaMode": "daily",
    "status": "active",
    "expiresAt": null,
    "modelAccessMode": "all",
    "allowedModels": [],
    "allowedCombos": [],
    "quota": {
      "quotaMode": "daily",
      "limit": 100000,
      "used": 45200,
      "reserved": 0,
      "remaining": 54800,
      "resetAt": "2026-07-16T00:00:00.000Z",
      "expiresAt": null,
      "storedStatus": "active",
      "effectiveStatus": "active",
      "reason": null,
      "percentUsed": 45
    }
  }
}
```

### Response lỗi (401)

```json
{
  "error": "Invalid API key",
  "status": "invalid"
}
```

Các `status` có thể gặp: `"invalid"`, `"expired"`, `"quota_exceeded"`, `"daily_quota_exceeded"`, `"suspended"`, `"inactive"`.

### Lưu ý về cookie

Server set cookie `client_token` (HttpOnly, Secure nếu HTTPS, SameSite=Lax). Các request sau cần gửi kèm cookie này. Nếu dùng `fetch`:

```js
// Browser — cookie tự động gửi
const res = await fetch("https://v-router.fpt.ovh/api/client/auth", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ apiKey: "sk-vrouter-xxx" }),
  credentials: "include"  // ← quan trọng!
});
```

```js
// Node.js / extension background — lưu cookie thủ công
const res = await fetch("https://v-router.fpt.ovh/api/client/auth", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ apiKey: "sk-vrouter-xxx" }),
});
const setCookie = res.headers.get("set-cookie");
// Lưu setCookie và gửi lại ở request sau:
// headers: { Cookie: setCookie }
```

---

## 3. Bước 2: Lấy thông tin key + quota — `GET /api/client/me`

Trả về thông tin API key hiện tại, bao gồm snapshot quota.

### Request

```http
GET /api/client/me
Cookie: client_token=<jwt-token>
```

### Response (200 OK)

```json
{
  "authenticated": true,
  "inactive": false,
  "key": {
    "id": 1,
    "name": "My Key",
    "keyPrefix": "sk-vroute...xxxx",
    "isActive": true,
    "quotaMode": "daily",
    "status": "active",
    "expiresAt": null,
    "modelAccessMode": "all",
    "allowedModels": [],
    "allowedCombos": [],
    "quota": {
      "quotaMode": "daily",
      "limit": 100000,
      "used": 45200,
      "reserved": 0,
      "remaining": 54800,
      "resetAt": "2026-07-16T00:00:00.000Z",
      "expiresAt": null,
      "storedStatus": "active",
      "effectiveStatus": "active",
      "reason": null,
      "percentUsed": 45
    }
  }
}
```

### `effectiveStatus` — các giá trị có thể

| Status | Ý nghĩa | Hành động khuyến nghị |
|--------|---------|----------------------|
| `active` | Key hoạt động bình thường | Tiếp tục sử dụng |
| `expired` | Key đã hết hạn | Yêu cầu user gia hạn |
| `quota_exceeded` | Vượt tổng token limit (total mode) | Chờ admin nâng limit hoặc reset |
| `daily_quota_exceeded` | Vượt daily token limit | Chờ đến `resetAt` (thường là 00:00 giờ địa phương) |
| `suspended` | Key bị admin tạm khóa | Liên hệ admin |
| `inactive` | Key bị vô hiệu hóa | Liên hệ admin |

### Khi `inactive: true` hoặc `effectiveStatus !== "active"`

Extension nên **chặn mọi request** và hiển thị thông báo phù hợp cho user dựa trên `reason` và `effectiveStatus`.

---

## 4. Bước 3: Lấy biểu đồ + lịch sử — `GET /api/client/usage`

Trả về dữ liệu biểu đồ sử dụng theo ngày và lịch sử request gần đây.

### Request

```http
GET /api/client/usage?days=7
Cookie: client_token=<jwt-token>
```

Tham số:
- `days` (number, mặc định `7`, tối đa `60`): Số ngày lấy dữ liệu biểu đồ.

### Response (200 OK)

```json
{
  "key": {
    "id": 1,
    "name": "My Key",
    "keyPrefix": "sk-vroute...xxxx",
    "quota": { "...same as /api/client/me..." }
  },
  "chart": [
    { "label": "Jul 9",  "dateKey": "2026-07-09", "tokens": 12400, "requests": 15 },
    { "label": "Jul 10", "dateKey": "2026-07-10", "tokens": 8900,  "requests": 10 },
    { "label": "Jul 11", "dateKey": "2026-07-11", "tokens": 15200, "requests": 22 },
    { "label": "Jul 12", "dateKey": "2026-07-12", "tokens": 0,     "requests": 0  },
    { "label": "Jul 13", "dateKey": "2026-07-13", "tokens": 21000, "requests": 18 },
    { "label": "Jul 14", "dateKey": "2026-07-14", "tokens": 0,     "requests": 0  },
    { "label": "Jul 15", "dateKey": "2026-07-15", "tokens": 45200, "requests": 35 }
  ],
  "history": [
    {
      "timestamp": "2026-07-15T10:30:00.000Z",
      "provider": "github",
      "model": "gpt-4o",
      "endpoint": "/chat/completions",
      "promptTokens": 1200,
      "completionTokens": 800,
      "status": "ok",
      "totalTokens": 2000
    }
  ]
}
```

---

## 5. Bước 4: Lấy danh sách model khả dụng — `GET /api/client/models`

Trả về danh sách model LLM mà API key hiện tại được phép sử dụng. Tự động lọc theo `modelAccessMode` của key (nếu key bị giới hạn ở chế độ `restricted`, chỉ trả về model trong whitelist).

### Request

```http
GET /api/client/models
Cookie: client_token=<jwt-token>
```

### Response (200 OK)

```json
{
  "object": "list",
  "count": 42,
  "generatedAt": "2026-07-15T10:30:00.000Z",
  "data": [
    { "id": "gh/gpt-5.4", "object": "model", "owned_by": "gh" },
    { "id": "cc/claude-opus-4-6", "object": "model", "owned_by": "cc" },
    { "id": "gc/gemini-3-flash", "object": "model", "owned_by": "gc" },
    { "id": "cx/gpt-5.3-codex", "object": "model", "owned_by": "cx" },
    { "id": "openai/gpt-5.4", "object": "model", "owned_by": "openai" },
    { "id": "anthropic/claude-sonnet-4-6", "object": "model", "owned_by": "anthropic" }
  ]
}
```

### Cấu trúc từng model entry

```typescript
interface ModelEntry {
  id: string;          // Định danh model: "{providerAlias}/{modelId}" — dùng giá trị này trong request LLM
  object: "model";     // Luôn là "model"
  owned_by: string;    // Provider alias (e.g., "gh", "cc", "openai", "anthropic")
  kind?: string;       // (Optional) Loại model: "llm", "image", "tts", "stt", "embedding", "webSearch", "webFetch"
}
```

### Response khi không authenticated (401)

```json
{ "error": "Unauthorized" }
```

### Lưu ý quan trọng

- Model `id` trong response chính là giá trị bạn cần gửi trong trường `model` của request LLM (e.g., `POST /v1/chat/completions` với `"model": "gh/gpt-5.4"`).
- Danh sách đã được lọc theo quyền của API key — nếu key ở chế độ `restricted`, chỉ những model/admin combo được whitelist mới xuất hiện.
- `owned_by` là provider alias nội bộ của V-Router, không phải tên provider gốc.
- Nếu muốn lấy model theo loại cụ thể (image, tts, stt, embedding, web), dùng endpoint `/v1/models/{kind}` với API key (xem phụ lục).

### API thay thế: `/v1/models` (OpenAI-compatible, dùng API key trực tiếp)

Nếu không muốn dùng session cookie, có thể gọi trực tiếp với API key:

```http
GET /v1/models
Authorization: Bearer sk-vrouter-xxx
```

```http
GET /v1/models/image
Authorization: Bearer sk-vrouter-xxx
```

Response format giống hệt, nhưng không có `count` và `generatedAt`.

**Các kind được hỗ trợ**: `image`, `tts`, `stt`, `embedding`, `image-to-text`, `web` (gộp webSearch + webFetch).

> **Lưu ý CORS**: `/v1/models` có header `Access-Control-Allow-Origin: *` nên gọi được từ browser extension không cần proxy.

### Lấy model cho các loại khác ngoài LLM

Endpoint `/api/client/models` mặc định chỉ trả về LLM models. Để lấy models cho image, TTS, STT, embedding, web — dùng `/v1/models/{kind}` với API key:

```js
// Lấy danh sách image generation models
const res = await fetch("https://v-router.fpt.ovh/v1/models/image", {
  headers: { Authorization: "Bearer sk-vrouter-xxx" }
});
const { data } = await res.json();
// data: [{ id: "openai/dall-e-3", object: "model", owned_by: "openai" }, ...]
```

---

## 6. Bước 5 (Khuyến nghị): Real-time updates — `GET /api/client/stream`

SSE endpoint đẩy quota và notification theo thời gian thực.

### Request

```http
GET /api/client/stream
Cookie: client_token=<jwt-token>
Accept: text/event-stream
```

### Events

```
event: quota
data: {"key":{...quota...},"chart":[...],"history":[...]}

event: notification
data: {"id":42,"type":"quota_warning","title":"Còn 10% quota",...}

event: unread
data: {"count":3}
```

### Ví dụ code listener

```js
const es = new EventSource("https://v-router.fpt.ovh/api/client/stream", {
  withCredentials: true  // gửi cookie
});

es.addEventListener("quota", (e) => {
  const data = JSON.parse(e.data);
  updateQuotaUI(data.key.quota);
  updateChart(data.chart);
});

es.addEventListener("notification", (e) => {
  const notif = JSON.parse(e.data);
  showNotification(notif);
});

es.addEventListener("unread", (e) => {
  const { count } = JSON.parse(e.data);
  updateBadge(count);
});

es.onerror = () => {
  // Tự reconnect sau 5s
  setTimeout(() => { /* khởi tạo lại EventSource */ }, 5000);
};
```

> **Lưu ý**: Server gửi keep-alive ping mỗi 25 giây (comment `: ping`). EventSource tự xử lý việc này.

---

## 7. Cấu trúc dữ liệu `quota` object (đầy đủ)

Đây là object `quota` xuất hiện trong tất cả các response ở trên:

```typescript
interface QuotaSnapshot {
  quotaMode: "daily" | "total";       // Chế độ quota
  limit: number | null;               // Token limit (null = unlimited)
  used: number;                       // Token đã dùng
  reserved: number;                   // Token đang reserved
  remaining: number | null;           // Token còn lại (null = unlimited)
  resetAt: string | null;             // ISO timestamp reset (chỉ daily mode)
  expiresAt: string | null;           // ISO timestamp hết hạn key
  storedStatus: string;               // Status trong DB gốc
  effectiveStatus: string;            // Status thực tế sau khi tính toán
  reason: string | null;              // Lý do nếu không active
  percentUsed: number;                // % đã dùng (0-100)
}
```

---

## 8. Code mẫu tích hợp hoàn chỉnh

### JavaScript/TypeScript (Browser Extension)

```js
const BASE = "http://localhost:20128";

class VRouterClient {
  constructor() {
    this.cookie = null;
  }

  // Bước 1: Login
  async login(apiKey) {
    const res = await fetch(`${BASE}/api/client/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Auth failed");
    }
    this.cookie = res.headers.get("set-cookie");
    const data = await res.json();
    return data.key;
  }

  // Bước 2: Lấy quota
  async getQuota() {
    const res = await this._fetch(`${BASE}/api/client/me`);
    const data = await res.json();
    if (!data.authenticated) throw new Error("Not authenticated");
    return data.key.quota;
  }

  // Bước 3: Lấy usage chart
  async getUsage(days = 7) {
    const res = await this._fetch(`${BASE}/api/client/usage?days=${days}`);
    return await res.json();
  }

  // Bước 4: Lấy danh sách model khả dụng
  async getModels() {
    const res = await this._fetch(`${BASE}/api/client/models`);
    return await res.json();
  }

  // Bước 5: SSE stream (trả về EventSource để caller quản lý)
  createStream() {
    // Dùng fetch + ReadableStream thay vì EventSource để custom headers
    // (EventSource không hỗ trợ custom headers natively)
    return this._createSSE(`${BASE}/api/client/stream`);
  }

  // --- helpers ---
  async _fetch(url, opts = {}) {
    const headers = { ...opts.headers };
    if (this.cookie) headers["Cookie"] = this.cookie;
    const res = await fetch(url, { ...opts, headers });
    // Cập nhật cookie nếu server set mới
    const newCookie = res.headers.get("set-cookie");
    if (newCookie) this.cookie = newCookie;
    return res;
  }

  async _createSSE(url) {
    const res = await this._fetch(url);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const events = {
      quota: null,
      notification: null,
      unread: null,
    };

    const processChunk = (chunk) => {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // giữ lại dòng chưa hoàn chỉnh

      let currentEvent = "message";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const data = JSON.parse(line.slice(6));
          if (events[currentEvent]) events[currentEvent](data);
        }
      }
    };

    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        processChunk(value);
      }
    };

    pump().catch(console.error);

    return {
      on(event, callback) { events[event] = callback; },
      close() { reader.cancel(); },
    };
  }
}

// --- Sử dụng ---
const client = new VRouterClient();

// Login
const keyInfo = await client.login("sk-vrouter-xxx");
console.log("Quota:", keyInfo.quota);

// Check quota định kỳ (mỗi 30s)
setInterval(async () => {
  const quota = await client.getQuota();
  if (quota.effectiveStatus !== "active") {
    console.warn("Key không active:", quota.reason);
    // Chặn request, hiện UI warning
  }
  console.log(`Remaining: ${quota.remaining} / ${quota.limit} (${quota.percentUsed}%)`);
}, 30000);

// Lấy danh sách model
const modelsData = await client.getModels();
console.log(`${modelsData.count} models available`);
const modelIds = modelsData.data.map(m => m.id);
console.log("Models:", modelIds);

// Hoặc dùng SSE cho real-time
const stream = client.createStream();
stream.on("quota", (data) => {
  console.log("Quota update:", data.key.quota);
});
stream.on("notification", (notif) => {
  console.log("Notification:", notif);
});
```

### Python

```python
import requests
import json
import time
from typing import Optional

class VRouterClient:
    def __init__(self, base_url: str = "http://localhost:20128"):
        self.base_url = base_url
        self.cookie: Optional[str] = None
        self.session = requests.Session()

    def login(self, api_key: str) -> dict:
        """Xác thực API key."""
        resp = self.session.post(
            f"{self.base_url}/api/client/auth",
            json={"apiKey": api_key},
        )
        resp.raise_for_status()
        data = resp.json()
        if not data.get("success"):
            raise Exception(data.get("error", "Auth failed"))
        return data["key"]

    def get_quota(self) -> dict:
        """Lấy quota snapshot của key hiện tại."""
        resp = self.session.get(f"{self.base_url}/api/client/me")
        resp.raise_for_status()
        data = resp.json()
        if not data.get("authenticated"):
            raise Exception("Not authenticated")
        return data["key"]["quota"]

    def get_usage(self, days: int = 7) -> dict:
        """Lấy biểu đồ + lịch sử sử dụng."""
        resp = self.session.get(
            f"{self.base_url}/api/client/usage",
            params={"days": days},
        )
        resp.raise_for_status()
        return resp.json()

    def get_models(self) -> dict:
        """Lấy danh sách model LLM khả dụng."""
        resp = self.session.get(f"{self.base_url}/api/client/models")
        resp.raise_for_status()
        return resp.json()

    def stream_quota(self, on_quota=None, on_notification=None):
        """SSE stream để nhận quota real-time."""
        import sseclient  # pip install sseclient-py

        resp = self.session.get(
            f"{self.base_url}/api/client/stream",
            stream=True,
        )
        client = sseclient.SSEClient(resp)
        for event in client.events():
            if event.event == "quota" and on_quota:
                on_quota(json.loads(event.data))
            elif event.event == "notification" and on_notification:
                on_notification(json.loads(event.data))


# --- Sử dụng ---
client = VRouterClient()

# Login
key_info = client.login("sk-vrouter-xxx")
print(f"Quota initial: {key_info['quota']}")

# Check quota
quota = client.get_quota()
print(f"Status: {quota['effectiveStatus']}")
print(f"Remaining: {quota['remaining']}/{quota['limit']} ({quota['percentUsed']}%)")
if quota["effectiveStatus"] != "active":
    print(f"WARNING: {quota['reason']}")

# Usage history
usage = client.get_usage(days=7)
for day in usage["chart"]:
    print(f"  {day['label']}: {day['tokens']} tokens, {day['requests']} requests")

# Models
models_data = client.get_models()
print(f"{models_data['count']} models available")
for m in models_data["data"]:
    print(f"  {m['id']} (via {m['owned_by']})")
```

### cURL (test nhanh)

```bash
# 1. Auth
curl -c cookies.txt -X POST https://v-router.fpt.ovh/api/client/auth \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"sk-vrouter-xxx"}'

# 2. Get quota
curl -b cookies.txt https://v-router.fpt.ovh/api/client/me | jq .key.quota

# 3. Get usage chart
curl -b cookies.txt "https://v-router.fpt.ovh/api/client/usage?days=7" | jq .

# 4. Get models list
curl -b cookies.txt https://v-router.fpt.ovh/api/client/models | jq .

# 5. SSE stream
curl -b cookies.txt -N https://v-router.fpt.ovh/api/client/stream
```

---

## 9. Best Practices cho Extension

1. **Kiểm tra quota trước mỗi request**: Gọi `GET /api/client/me` và kiểm tra `effectiveStatus === "active"` trước khi gửi request LLM.

2. **Cache quota ngắn hạn**: Cache kết quả quota trong 10-30 giây để giảm tải server, nhưng dùng SSE để nhận update real-time thay vì poll liên tục.

3. **Hiển thị % rõ ràng**: Dùng `percentUsed` và `remaining` để hiển thị thanh tiến trình quota cho user.

4. **Xử lý `resetAt`**: Với daily mode, hiển thị countdown đến `resetAt` để user biết khi nào quota reset.

5. **Thông báo khi sắp hết**: Khi `percentUsed >= 80`, hiển thị warning. Khi `percentUsed >= 95`, hiển thị critical alert.

6. **Xử lý reconnect SSE**: Nếu SSE stream đứt, tự reconnect sau 5-10 giây với exponential backoff.

7. **Fallback poll**: Nếu SSE không khả dụng (một số môi trường extension), fallback về poll `GET /api/client/me` mỗi 30 giây.

8. **Không hardcode base URL**: Cho phép user cấu hình V-Router server URL trong settings của extension.

9. **Cache danh sách model**: Gọi `GET /api/client/models` một lần khi khởi động extension và cache trong 5-10 phút. Danh sách model ít thay đổi.

10. **Xử lý lỗi model_not_allowed**: Nếu user chọn model từ cache cũ và sau đó bị 403 `model_not_allowed`, tự động refresh lại danh sách model từ server.

11. **Luôn kiểm tra error response format**: Tất cả error đều có format `{ "error": { "message", "type", "code" } }`. Dùng `code` để xử lý logic, `message` để hiển thị cho user.

---

## 10. Mã lỗi hệ thống (đầy đủ)

### 10.1 Error Response Format chung (OpenAI-compatible)

Tất cả error từ V-Router LLM API (`/v1/*`, `/v1beta/*`, `/api/v1/*`) tuân theo format:

```json
{
  "error": {
    "message": "Human-readable error message",
    "type": "invalid_request_error|authentication_error|permission_error|rate_limit_error|server_error|billing_error",
    "code": "bad_request|invalid_api_key|insufficient_quota|model_not_found|model_not_supported|rate_limit_exceeded|internal_server_error|bad_gateway|service_unavailable|gateway_timeout|payment_required"
  }
}
```

### 10.2 Bảng đầy đủ mã lỗi HTTP

| HTTP | `type` | `code` | Mô tả | Khi nào gặp |
|------|--------|--------|-------|-------------|
| **400** | `invalid_request_error` | `bad_request` | Request không hợp lệ | Thiếu/malformed JSON body, thiếu `model`, thiếu `messages`/`prompt`, model format sai, provider không hỗ trợ loại request này |
| **401** | `authentication_error` | `invalid_api_key` | API key không hợp lệ | Thiếu key, key không tồn tại, key hết hạn, key vượt quota, key bị khóa |
| **401** | `authentication_error` | `missing_api_key` | Thiếu API key | Header `Authorization` hoặc `x-api-key` không có |
| **402** | `billing_error` | `payment_required` | Yêu cầu thanh toán | Upstream provider yêu cầu thanh toán (hiếm) |
| **403** | `permission_error` | `insufficient_quota` | Vượt quota | Upstream provider báo quota exceeded |
| **403** | `permission_error` | `model_not_allowed` | Model bị chặn | Key bị giới hạn model (`modelAccessMode: "restricted"`) và model yêu cầu không nằm trong whitelist |
| **404** | `invalid_request_error` | `model_not_found` | Không tìm thấy model | Model không tồn tại trong catalog, không có credentials cho provider, provider không active |
| **406** | `invalid_request_error` | `model_not_supported` | Model không được hỗ trợ | Model tồn tại nhưng không hỗ trợ loại request này |
| **429** | `rate_limit_error` | `rate_limit_exceeded` | Rate limit | Tất cả tài khoản của provider đều bị rate limit. Response kèm header `Retry-After: <seconds>` |
| **499** | — | — | Client ngắt kết nối | Request bị hủy giữa chừng (client disconnect). Không có body. |
| **500** | `server_error` | `internal_server_error` | Lỗi server nội bộ | Lỗi không mong đợi trong V-Router |
| **502** | `server_error` | `bad_gateway` | Upstream provider lỗi | Không thể kết nối tới upstream, upstream trả về response không hợp lệ, parse JSON/SSE thất bại |
| **503** | `server_error` | `service_unavailable` | Dịch vụ tạm thời không khả dụng | Tất cả tài khoản của provider đều unavailable, pool cạn kiệt |
| **504** | `server_error` | `gateway_timeout` | Gateway timeout | Upstream provider không phản hồi trong thời gian cho phép (timeout 60s) |

### 10.3 Mã lỗi từ API Client (`/api/client/*`)

| HTTP | Body | Khi nào gặp |
|------|------|-------------|
| **400** | `{"error": "API key is required"}` | Thiếu `apiKey` trong body auth |
| **401** | `{"error": "Unauthorized"}` | Thiếu/mất session cookie, JWT không hợp lệ hoặc hết hạn |
| **401** | `{"error": "Invalid API key", "status": "<status>"}` | Auth thất bại: `status` có thể là `"invalid"`, `"expired"`, `"quota_exceeded"`, `"daily_quota_exceeded"`, `"suspended"`, `"inactive"` |
| **401** | `{"authenticated": false}` | `/api/client/me` — session expired hoặc key bị xóa |
| **404** | `{"error": "API key not found"}` | `/api/client/usage` — key không tồn tại |
| **500** | `{"error": "Failed to login"}` | Lỗi server khi xử lý auth |
| **500** | `{"error": "Failed to fetch models"}` | Lỗi server khi lấy danh sách model |

### 10.4 Mã lỗi từ Dashboard/Admin API

| HTTP | Body | Khi nào gặp |
|------|------|-------------|
| **400** | `{"error": "body is required"}` | POST/PUT không có body |
| **400** | `{"error": "severity must be info, warning, or error"}` | Notification sai severity |
| **400** | `{"error": "Invalid period"}` | Period không hợp lệ (usage stats) |
| **401** | `{"error": "Unauthorized"}` | Thiếu dashboard auth |
| **401** | `{"error": "Dashboard login is Discord-only."}` | Login sai phương thức |
| **401** | `{"error": "API key required for remote API access"}` | Truy cập remote API không có key |
| **403** | `{"error": "Local only: CLI token required"}` | Truy cập local-only route từ remote |
| **404** | `{"error": "Combo not found"}` | Combo không tồn tại |
| **500** | `{"error": "Failed to fetch admin stats"}` | Lỗi stats |
| **500** | `{"error": "Failed to create notification"}` | Lỗi tạo notification |

### 10.5 Error Status của API Key (`effectiveStatus`)

Đây là các giá trị `effectiveStatus` trong `quota` object, không phải HTTP status:

| Status | Ý nghĩa | Hành động khuyến nghị |
|--------|---------|----------------------|
| `active` | Key hoạt động bình thường | Tiếp tục sử dụng |
| `expired` | Key đã hết hạn (`expiresAt` đã qua) | Yêu cầu user gia hạn |
| `quota_exceeded` | Vượt tổng token limit (total mode) | Chờ admin nâng limit hoặc reset |
| `daily_quota_exceeded` | Vượt daily token limit | Chờ đến `resetAt` (thường 00:00 giờ địa phương) |
| `suspended` | Key bị admin tạm khóa thủ công | Liên hệ admin |
| `inactive` | Key bị vô hiệu hóa (`isActive: false`) | Liên hệ admin |

### 10.6 Rate Limit & Backoff Config (tham khảo)

| Config | Giá trị |
|--------|--------|
| Max retries upstream (502/503/504) | 2-3 lần, delay 2-3s |
| Rate limit cooldown (429) | Exponential backoff: 2s → 4s → 8s → ... → max 30 phút |
| Transient error cooldown | 30 giây |
| Auth error cooldown (401/402/403) | 2 phút |
| SSE keep-alive ping interval | 25 giây |
| Upstream connect timeout | 60 giây |
| Stream stall timeout | 60 giây |
| JWT expiry (client token) | 7 ngày |
| JWT expiry (dashboard token) | 24 giờ |

### 10.7 Cách xử lý lỗi trong Extension

```js
async function handleVrouterError(response) {
  const status = response.status;

  // 401 — Key hết hạn hoặc bị vô hiệu hóa
  if (status === 401) {
    const body = await response.json().catch(() => ({}));
    // Với /api/client/auth: body.status cho biết lý do cụ thể
    if (body.status === "expired") {
      return { action: "show_expired", message: "API key đã hết hạn, vui lòng gia hạn" };
    }
    if (body.status === "quota_exceeded" || body.status === "daily_quota_exceeded") {
      return { action: "show_quota_exceeded", message: "Đã vượt quá hạn mức token" };
    }
    // Với /api/client/*: cần re-auth
    return { action: "re_auth", message: "Phiên đăng nhập hết hạn, vui lòng đăng nhập lại" };
  }

  // 403 — Model bị chặn
  if (status === 403) {
    const body = await response.json().catch(() => ({}));
    const code = body?.error?.code;
    if (code === "model_not_allowed") {
      return { action: "model_blocked", message: "API key của bạn không có quyền truy cập model này" };
    }
    return { action: "forbidden", message: body?.error?.message || "Truy cập bị từ chối" };
  }

  // 429 — Rate limit
  if (status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 30;
    return { action: "rate_limited", waitSeconds, message: `Rate limited, thử lại sau ${waitSeconds}s` };
  }

  // 5xx — Lỗi server/upstream
  if (status >= 500) {
    return { action: "server_error", message: "Máy chủ V-Router hoặc upstream provider đang gặp sự cố" };
  }

  return { action: "unknown", message: `Lỗi không xác định (${status})` };
}
```

---

## 11. Tài liệu tham khảo

| File | Vai trò |
|------|--------|
| `src/lib/quota/quotaManager.js` | Quota manager: validate key, consume tokens, build quota snapshot |
| `src/lib/quota/quotaUtils.js` | Quota utilities: hash key, quota snapshot builder, timezone handling |
| `src/app/api/client/` | Client API routes: auth, me, usage, models, stream |
| `src/app/api/usage/` | Usage stats routes: stats, chart, history, providers, request details |
| `src/lib/auth/clientSession.js` | Client JWT session: create, verify, require |
| `src/app/api/v1/models/route.js` | `/v1/models` + `buildModelsList()` — model catalog resolver |
| `src/lib/apiKeyModelAccess.js` | Model access control: per-key model whitelist filtering |
| `open-sse/config/providerModels.js` | Static provider → models mapping (master catalog) |
| `open-sse/config/errorConfig.js` | Error type/code mapping, ERROR_RULES, backoff config |
| `open-sse/utils/error.js` | `buildErrorBody`, `errorResponse`, `createErrorResult` |
| `src/lib/db/schema.js` | Database schema: apiKeys, apiKeyDailyUsage, apiKeyQuotaLedger |
