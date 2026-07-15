import { describe, expect, it } from "vitest";
import { filterChatModels } from "../../src/models/ModelService";

describe("ModelService", () => {
  it("filters non-LLM models from chat picker", () => {
    const models = filterChatModels([
      { id: "openai/gpt", object: "model", owned_by: "openai" },
      { id: "openai/embed", object: "model", owned_by: "openai", kind: "embedding" },
      { id: "openai/image", object: "model", owned_by: "openai", kind: "image" },
      { id: "cc/sonnet", object: "model", owned_by: "cc", kind: "llm" }
    ]);
    expect(models.map((model) => model.id)).toEqual(["openai/gpt", "cc/sonnet"]);
  });
});
