import { SECRET_API_KEY } from "../config/constants";

export interface SecretStore {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

export interface ApiKeyView {
  masked: string;
  prefix: string;
}

export function maskApiKey(apiKey: string): ApiKeyView {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) {
    return { masked: "••••", prefix: "••••" };
  }
  const prefix = trimmed.slice(0, Math.min(9, trimmed.length - 4));
  const suffix = trimmed.slice(-4);
  return {
    masked: `${prefix}••••${suffix}`,
    prefix
  };
}

export class ApiKeyService {
  public constructor(private readonly secrets: SecretStore) {}

  public async getApiKey(): Promise<string | null> {
    const value = await this.secrets.get(SECRET_API_KEY);
    return value ?? null;
  }

  public async storeApiKey(apiKey: string): Promise<void> {
    await this.secrets.store(SECRET_API_KEY, apiKey.trim());
  }

  public async deleteApiKey(): Promise<void> {
    await this.secrets.delete(SECRET_API_KEY);
  }

  public async hasApiKey(): Promise<boolean> {
    const value = await this.getApiKey();
    return value !== null && value.length > 0;
  }
}
