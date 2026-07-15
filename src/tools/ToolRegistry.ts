import type { ChatTool } from "../api/types";
import type { ToolDefinition } from "./ToolDefinition";
import { toChatTool } from "./ToolDefinition";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  public register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  public get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public has(name: string): boolean {
    return this.tools.has(name);
  }

  public list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  public toChatTools(): ChatTool[] {
    return this.list().map(toChatTool);
  }
}
