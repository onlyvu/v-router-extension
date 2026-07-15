export const vi = {
  appName: "V-Router Smart",
  tagline: "Trợ lý lập trình AI kết nối trực tiếp với V-Router",
  serverOrigin: "Server Origin",
  advancedSettings: "Cài đặt nâng cao",
  apiKey: "API key",
  checkConnection: "Kiểm tra kết nối",
  checkAndSave: "Kiểm tra & lưu",
  replaceApiKey: "Thay API key",
  removeApiKey: "Xóa API key",
  send: "Gửi",
  stop: "Dừng",
  attachSelection: "Đính kèm selection",
  attachActiveFile: "Đính kèm file hiện tại",
  chooseFiles: "Chọn file",
  clearContext: "Xóa context",
  newChat: "Chat mới",
  settings: "Cài đặt",
  modelPlaceholder: "Chọn model",
  quotaUnknown: "Chưa có quota",
  lastRequest: "Request gần nhất",
  authMessages: {
    invalid: "API key không hợp lệ.",
    expired: "API key đã hết hạn. Vui lòng gia hạn để tiếp tục.",
    quota_exceeded: "API key đã sử dụng hết tổng hạn mức token.",
    daily_quota_exceeded: "API key đã sử dụng hết hạn mức hôm nay.",
    suspended: "API key đang bị tạm khóa. Vui lòng liên hệ quản trị viên.",
    inactive: "API key đã bị vô hiệu hóa.",
    active: "API key đang hoạt động."
  },
  emptySuggestions: [
    "Giải thích đoạn code đang chọn",
    "Tìm lỗi trong file hiện tại",
    "Viết unit test",
    "Tối ưu đoạn code",
    "Tạo tài liệu cho hàm đang chọn"
  ]
} as const;
