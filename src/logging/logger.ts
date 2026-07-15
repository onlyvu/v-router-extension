import * as vscode from "vscode";
import { OUTPUT_CHANNEL_NAME } from "../config/constants";
import { redactSensitive } from "./redaction";

export class Logger implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);

  public info(message: string, details?: unknown): void {
    this.write("INFO", message, details);
  }

  public warn(message: string, details?: unknown): void {
    this.write("WARN", message, details);
  }

  public error(message: string, details?: unknown): void {
    this.write("ERROR", message, details);
  }

  public show(): void {
    this.output.show(true);
  }

  public dispose(): void {
    this.output.dispose();
  }

  private write(level: "INFO" | "WARN" | "ERROR", message: string, details?: unknown): void {
    const suffix = details === undefined ? "" : ` ${redactSensitive(details)}`;
    this.output.appendLine(`[${new Date().toISOString()}] ${level} ${redactSensitive(message)}${suffix}`);
  }
}
