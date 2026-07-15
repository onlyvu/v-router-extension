import * as vscode from "vscode";
import {
  DEFAULT_SERVER_ORIGIN,
  MAX_CONTEXT_HARD_BYTES,
  MAX_FILE_CONTEXT_HARD_BYTES,
  MODEL_CACHE_TTL_DEFAULT_MS,
  QUOTA_CACHE_TTL_DEFAULT_MS
} from "./constants";
import type { ChatAccessMode, ChatMode } from "../chat/types";

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
  defaultMode: ChatMode;
  agentEnabled: boolean;
  agentPermissionMode: ChatAccessMode;
  agentMaxIterations: number;
  agentMaxToolCalls: number;
  agentMaxDurationMinutes: number;
  agentAutoApplySafeEdits: boolean;
  agentConfirmFileCreate: boolean;
  agentConfirmFileDelete: boolean;
  agentConfirmFileRename: boolean;
  agentTerminalEnabled: boolean;
  agentTaskExecutionEnabled: boolean;
  agentCheckpointsEnabled: boolean;
  agentCheckpointRetention: number;
  agentHistoryRetentionDays: number;
  agentMaxSnapshotStorageMb: number;
  agentShowToolTimeline: boolean;
  agentShowPlan: boolean;
  agentContextCompactionEnabled: boolean;
  agentRequireApprovalForSensitiveFiles: boolean;
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
  maxTokens: 4096,
  defaultMode: "chat",
  agentEnabled: true,
  agentPermissionMode: "review_edits",
  agentMaxIterations: 30,
  agentMaxToolCalls: 100,
  agentMaxDurationMinutes: 30,
  agentAutoApplySafeEdits: false,
  agentConfirmFileCreate: true,
  agentConfirmFileDelete: true,
  agentConfirmFileRename: true,
  agentTerminalEnabled: false,
  agentTaskExecutionEnabled: true,
  agentCheckpointsEnabled: true,
  agentCheckpointRetention: 50,
  agentHistoryRetentionDays: 30,
  agentMaxSnapshotStorageMb: 500,
  agentShowToolTimeline: true,
  agentShowPlan: true,
  agentContextCompactionEnabled: true,
  agentRequireApprovalForSensitiveFiles: true
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
  const readEnum = <T extends string>(key: keyof VRouterSettings, fallback: T, allowed: readonly T[]): T => {
    const value = values[key];
    if (typeof value === "string" && allowed.includes(value as T)) {
      return value as T;
    }
    warnings.push({ key, message: "Giá trị không hợp lệ, dùng mặc định." });
    return fallback;
  };

  const maxContextBytes = readNumber("maxContextBytes", defaults.maxContextBytes, 1024, MAX_CONTEXT_HARD_BYTES);
  const maxFileContextBytes = Math.min(
    readNumber("maxFileContextBytes", defaults.maxFileContextBytes, 1024, MAX_FILE_CONTEXT_HARD_BYTES),
    maxContextBytes
  );

  return {
    settings: {
      serverOrigin: DEFAULT_SERVER_ORIGIN,
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
      maxTokens: readNumber("maxTokens", defaults.maxTokens, 1, 200_000),
      defaultMode: readEnum("defaultMode", defaults.defaultMode, ["chat", "edit", "agent"] as const),
      agentEnabled: readBoolean("agentEnabled", defaults.agentEnabled),
      agentPermissionMode: readEnum("agentPermissionMode", defaults.agentPermissionMode, ["read_only", "review_edits", "auto_apply_safe", "full_agent"] as const),
      agentMaxIterations: readNumber("agentMaxIterations", defaults.agentMaxIterations, 1, 100),
      agentMaxToolCalls: readNumber("agentMaxToolCalls", defaults.agentMaxToolCalls, 1, 300),
      agentMaxDurationMinutes: readNumber("agentMaxDurationMinutes", defaults.agentMaxDurationMinutes, 1, 180),
      agentAutoApplySafeEdits: readBoolean("agentAutoApplySafeEdits", defaults.agentAutoApplySafeEdits),
      agentConfirmFileCreate: readBoolean("agentConfirmFileCreate", defaults.agentConfirmFileCreate),
      agentConfirmFileDelete: readBoolean("agentConfirmFileDelete", defaults.agentConfirmFileDelete),
      agentConfirmFileRename: readBoolean("agentConfirmFileRename", defaults.agentConfirmFileRename),
      agentTerminalEnabled: readBoolean("agentTerminalEnabled", defaults.agentTerminalEnabled),
      agentTaskExecutionEnabled: readBoolean("agentTaskExecutionEnabled", defaults.agentTaskExecutionEnabled),
      agentCheckpointsEnabled: readBoolean("agentCheckpointsEnabled", defaults.agentCheckpointsEnabled),
      agentCheckpointRetention: readNumber("agentCheckpointRetention", defaults.agentCheckpointRetention, 1, 500),
      agentHistoryRetentionDays: readNumber("agentHistoryRetentionDays", defaults.agentHistoryRetentionDays, 1, 365),
      agentMaxSnapshotStorageMb: readNumber("agentMaxSnapshotStorageMb", defaults.agentMaxSnapshotStorageMb, 10, 10_000),
      agentShowToolTimeline: readBoolean("agentShowToolTimeline", defaults.agentShowToolTimeline),
      agentShowPlan: readBoolean("agentShowPlan", defaults.agentShowPlan),
      agentContextCompactionEnabled: readBoolean("agentContextCompactionEnabled", defaults.agentContextCompactionEnabled),
      agentRequireApprovalForSensitiveFiles: readBoolean("agentRequireApprovalForSensitiveFiles", defaults.agentRequireApprovalForSensitiveFiles)
    },
    warnings
  };
}

export function getSettings(): SettingsReadResult {
  const config = vscode.workspace.getConfiguration("vRouterSmart");
  return validateSettingsValues({
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
    maxTokens: config.get("maxTokens"),
    defaultMode: config.get("mode.default"),
    agentEnabled: config.get("agent.enabled"),
    agentPermissionMode: config.get("agent.permissionMode"),
    agentMaxIterations: config.get("agent.maxIterations"),
    agentMaxToolCalls: config.get("agent.maxToolCalls"),
    agentMaxDurationMinutes: config.get("agent.maxDurationMinutes"),
    agentAutoApplySafeEdits: config.get("agent.autoApplySafeEdits"),
    agentConfirmFileCreate: config.get("agent.confirmFileCreate"),
    agentConfirmFileDelete: config.get("agent.confirmFileDelete"),
    agentConfirmFileRename: config.get("agent.confirmFileRename"),
    agentTerminalEnabled: config.get("agent.terminalEnabled"),
    agentTaskExecutionEnabled: config.get("agent.taskExecutionEnabled"),
    agentCheckpointsEnabled: config.get("agent.checkpointsEnabled"),
    agentCheckpointRetention: config.get("agent.checkpointRetention"),
    agentHistoryRetentionDays: config.get("agent.historyRetentionDays"),
    agentMaxSnapshotStorageMb: config.get("agent.maxSnapshotStorageMb"),
    agentShowToolTimeline: config.get("agent.showToolTimeline"),
    agentShowPlan: config.get("agent.showPlan"),
    agentContextCompactionEnabled: config.get("agent.contextCompactionEnabled"),
    agentRequireApprovalForSensitiveFiles: config.get("agent.requireApprovalForSensitiveFiles")
  });
}
