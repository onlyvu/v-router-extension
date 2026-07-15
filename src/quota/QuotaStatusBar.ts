import * as vscode from "vscode";
import type { QuotaSnapshot } from "../api/types";

export class QuotaStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 88);

  public constructor() {
    this.item.name = "V-Router Smart Quota";
    this.item.command = "vRouterSmart.openChat";
    this.clear();
  }

  public update(quota: QuotaSnapshot): void {
    const percent = Math.max(0, Math.min(100, Math.round(quota.percentUsed)));
    const remaining = quota.remaining === null ? "không giới hạn" : `${quota.remaining.toLocaleString()} token còn lại`;
    const icon = percent >= 95 ? "$(error)" : percent >= 80 ? "$(warning)" : "$(pulse)";
    this.item.text = `${icon} V-Router ${percent}%`;
    this.item.tooltip = [
      `V-Router Smart quota`,
      `Đã dùng: ${percent}%`,
      `Còn lại: ${remaining}`,
      `Trạng thái: ${quota.effectiveStatus}`,
      quota.resetAt === null ? "" : `Reset: ${new Date(quota.resetAt).toLocaleString()}`
    ].filter((line) => line.length > 0).join("\n");
    this.item.backgroundColor = percent >= 95
      ? new vscode.ThemeColor("statusBarItem.errorBackground")
      : percent >= 80
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;
    this.item.show();
  }

  public clear(): void {
    this.item.text = "$(pulse) V-Router 0%";
    this.item.tooltip = "V-Router Smart chưa xác minh quota. Bấm để mở chat.";
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  public dispose(): void {
    this.item.dispose();
  }
}
