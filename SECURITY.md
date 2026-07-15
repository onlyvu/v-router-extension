# Security Policy

## Báo cáo lỗ hổng

Vui lòng báo cáo lỗ hổng qua kênh riêng của maintainer. Không đăng API key, cookie, prompt nhạy cảm, log thô hoặc file workspace riêng tư vào public issue.

## Dữ liệu nhạy cảm

Dữ liệu nhạy cảm gồm API key, `client_token`, Authorization header, Cookie header, prompt/context chứa secret, private key, certificate private key và file credentials.

## Secret storage

API key chỉ được lưu bằng VS Code SecretStorage với key `vRouterSmart.apiKey`. Cookie session chỉ giữ trong memory và không gửi tới webview.

## Webview CSP

Webview dùng CSP chặn default source, không dùng CDN, không dùng `unsafe-eval` hoặc inline script. JavaScript/CSS được bundle cục bộ.

## Request redaction

Log và request inspector redact Authorization, Cookie, API key và `client_token`. Debug logging không ghi full prompt/file content vào Output Channel.

## Dependency policy

Ưu tiên dependency nhỏ, phổ biến và bundle được. Chạy `npm audit` định kỳ trước khi publish Marketplace.
