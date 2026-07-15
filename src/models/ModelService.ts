import type * as vscode from "vscode";
import type { VRouterClient } from "../api/VRouterClient";
import type { ModelEntry } from "../api/types";
import { LAST_MODEL_KEY } from "../config/constants";
import type { VRouterSettings } from "../config/settings";
import type { Logger } from "../logging/logger";
import type { ModelCache } from "./types";

export function filterChatModels(models: ModelEntry[]): ModelEntry[] {
  return models
    .filter((model) => model.object === "model")
    .filter((model) => model.kind === undefined || model.kind === "llm")
    .filter((model) => model.id.trim().length > 0);
}

export class ModelService {
  private cache: ModelCache | null = null;

  public constructor(
    private readonly client: VRouterClient,
    private readonly globalState: vscode.Memento,
    private readonly logger: Logger
  ) {}

  public async getModels(apiKey: string, settings: VRouterSettings, force = false, signal?: AbortSignal): Promise<ModelEntry[]> {
    if (!force && this.cache !== null && Date.now() - this.cache.fetchedAt < settings.modelCacheTtlMs) {
      return this.cache.models;
    }
    const response = await this.client.getModels(apiKey, signal);
    const models = filterChatModels(response.data);
    this.cache = { models, fetchedAt: Date.now() };
    this.logger.info("Models refreshed", { count: models.length });
    return models;
  }

  public invalidate(): void {
    this.cache = null;
  }

  public getSelectedModel(models: ModelEntry[], settings: VRouterSettings): string {
    const persisted = this.globalState.get<string>(LAST_MODEL_KEY) ?? settings.defaultModel;
    if (persisted.length > 0 && models.some((model) => model.id === persisted)) {
      return persisted;
    }
    return models[0]?.id ?? "";
  }

  public async setSelectedModel(modelId: string, models: ModelEntry[]): Promise<string> {
    const valid = models.some((model) => model.id === modelId);
    const selected = valid ? modelId : (models[0]?.id ?? "");
    await this.globalState.update(LAST_MODEL_KEY, selected);
    return selected;
  }
}
