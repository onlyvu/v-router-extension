# Privacy

V-Router Smart gửi nội dung chat và context do bạn chủ động chọn tới server V-Router đã cấu hình.

Extension kiểm soát các điểm sau:

- Không tự đọc toàn bộ workspace.
- Không có telemetry mặc định.
- API key được lưu bằng VS Code SecretStorage.
- Cookie `client_token` chỉ giữ trong memory của Extension Host.
- Conversation history lưu cục bộ theo workspace và không chứa API key/cookie.
- Bạn có thể xóa API key bằng command `V-Router Smart: Remove API Key`.
- Bạn có thể xóa nội dung chat bằng `Clear chat` trong sidebar.

Extension không khẳng định hoặc thay thế chính sách lưu trữ/xử lý dữ liệu của server V-Router. Hãy kiểm tra chính sách server trước khi gửi dữ liệu nhạy cảm.
