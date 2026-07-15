import * as vscode from "vscode";
import {
  DEFAULT_SERVER_ORIGIN,
  MAX_CONTEXT_HARD_BYTES,
  MAX_FILE_CONTEXT_HARD_BYTES,
  MODEL_CACHE_TTL_DEFAULT_MS,
  QUOTA_CACHE_TTL_DEFAULT_MS
} from "./constants";
import { normalizeServerOrigin } from "../api/urlBuilder";

export interface VRouterSettings {
  serverOrigin: string;
  defaultModel: string;
  systemPrompt: string;
  streaming: boolean;
  requestTimeoutMs: number;
  streamStallTimeoutMs: number;
  quotaCacheTtlMs: number;
  modelCacheTtlMs: number;
  autoAttachSelection: boolean;
  maxContextBytes: number;
  maxFileContextBytes: number;
  confirmBeforeApply: boolean;
  debugLogging: boolean;
  temperatureEnabled: boolean;
  temperature: number;
  maxTokensEnabled: boolean;
  maxTokens: number;
}

export type SettingsWarning = { key: string; message: string };

export interface SettingsReadResult {
  settings: VRouterSettings;
  warnings: SettingsWarning[];
}

const defaults: VRouterSettings = {
  serverOrigin: DEFAULT_SERVER_ORIGIN,
  defaultModel: "",
  systemPrompt: "",
  streaming: true,
  requestTimeoutMs: 120_000,
  streamStallTimeoutMs: 60_000,
  quotaCacheTtlMs: QUOTA_CACHE_TTL_DEFAULT_MS,
  modelCacheTtlMs: MODEL_CACHE_TTL_DEFAULT_MS,
  autoAttachSelection: false,
  maxContextBytes: 512_000,
  maxFileContextBytes: 204_800,
  confirmBeforeApply: true,
  debugLogging: false,
  temperatureEnabled: false,
  temperature: 0.2,
  maxTokensEnabled: false,
  maxTokens: 4096
};

export function validateSettingsValues(values: Partial<Record<keyof VRouterSettings, unknown>>): SettingsReadResult {
  const warnings: SettingsWarning[] = [];
  const readString = (key: keyof VRouterSettings, fallback: string): string => {
    const value = values[key];
    if (typeof value === "string") {
      return value;
    }
    warnings.push({ key, message: "Giá trị không hợp lệ, dùng mặc định." });
    return fallback;
  };
  const readBoolean = (key: keyof VRouterSettings, fallback: boolean): boolean => {
    const value = values[key];
    if (typeof value === "boolean") {
      return value;
    }
    warnings.push({ key, message: "Giá trị không hợp lệ, dùng mặc định." });
    return fallback;
  };
  const readNumber = (key: keyof VRouterSettings, fallback: number, min: number, max: number): number => {
    const value = values[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) {
      return value;
    }
    warnings.push({ key, message: "Giá trị không hợp lệ, dùng mặc định." });
    return fallback;
  };

  let serverOrigin = DEFAULT_SERVER_ORIGIN;
  try {
    serverOrigin = normalizeServerOrigin(readString("serverOrigin", defaults.serverOrigin));
  } catch {
    warnings.push({ key: "serverOrigin", message: "Server Origin không hợp lệ, dùng mặc định HTTPS." });
  }

  const maxContextBytes = readNumber("maxContextBytes", defaults.maxContextBytes, 1024, MAX_CONTEXT_HARD_BYTES);
  const maxFileContextBytes = Math.min(
    readNumber("maxFileContextBytes", defaults.maxFileContextBytes, 1024, MAX_FILE_CONTEXT_HARD_BYTES),
    maxContextBytes
  );

  return {
    settings: {
      serverOrigin,
      defaultModel: readString("defaultModel", defaults.defaultModel).trim(),
      systemPrompt: readString("systemPrompt", defaults.systemPrompt),
      streaming: readBoolean("streaming", defaults.streaming),
      requestTimeoutMs: readNumber("requestTimeoutMs", defaults.requestTimeoutMs, 10_000, 600_000),
      streamStallTimeoutMs: readNumber("streamStallTimeoutMs", defaults.streamStallTimeoutMs, 10_000, 300_000),
      quotaCacheTtlMs: readNumber("quotaCacheTtlMs", defaults.quotaCacheTtlMs, 0, 300_000),
      modelCacheTtlMs: readNumber("modelCacheTtlMs", defaults.modelCacheTtlMs, 0, 3_600_000),
      autoAttachSelection: readBoolean("autoAttachSelection", defaults.autoAttachSelection),
      maxContextBytes,
      maxFileContextBytes,
      confirmBeforeApply: readBoolean("confirmBeforeApply", defaults.confirmBeforeApply),
      debugLogging: readBoolean("debugLogging", defaults.debugLogging),
      temperatureEnabled: readBoolean("temperatureEnabled", defaults.temperatureEnabled),
      temperature: readNumber("temperature", defaults.temperature, 0, 2),
      maxTokensEnabled: readBoolean("maxTokensEnabled", defaults.maxTokensEnabled),
      maxTokens: readNumber("maxTokens", defaults.maxTokens, 1, 200_000)
    },
    warnings
  };
}

export function getSettings(): SettingsReadResult {
  const config = vscode.workspace.getConfiguration("vRouterSmart");
  return validateSettingsValues({
    serverOrigin: config.get("serverOrigin"),
    defaultModel: config.get("defaultModel"),
    systemPrompt: config.get("systemPrompt"),
    streaming: config.get("streaming"),
    requestTimeoutMs: config.get("requestTimeoutMs"),
    streamStallTimeoutMs: config.get("streamStallTimeoutMs"),
    quotaCacheTtlMs: config.get("quotaCacheTtlMs"),
    modelCacheTtlMs: config.get("modelCacheTtlMs"),
    autoAttachSelection: config.get("autoAttachSelection"),
    maxContextBytes: config.get("maxContextBytes"),
    maxFileContextBytes: config.get("maxFileContextBytes"),
    confirmBeforeApply: config.get("confirmBeforeApply"),
    debugLogging: config.get("debugLogging"),
    temperatureEnabled: config.get("temperatureEnabled"),
    temperature: config.get("temperature"),
    maxTokensEnabled: config.get("maxTokensEnabled"),
    maxTokens: config.get("maxTokens")
  });
}
