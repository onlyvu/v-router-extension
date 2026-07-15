import type { ChatTool } from "../api/types";
import type { ToolDefinition } from "../tools/ToolDefinition";
import { ToolRegistry } from "../tools/ToolRegistry";

function workspaceTool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  permissionCategory: ToolDefinition["permissionCategory"],
  riskLevel: ToolDefinition["riskLevel"]
): ToolDefinition {
  return {
    name,
    description,
    parameters,
    permissionCategory,
    riskLevel,
    timeoutMs: 15_000,
    audit: true,
    validateInput(input: unknown): Record<string, unknown> {
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        throw new Error(`${name} arguments must be a JSON object.`);
      }
      return input as Record<string, unknown>;
    },
    async execute(): Promise<never> {
      throw new Error(`${name} is executed by WorkspaceAgentToolExecutor.`);
    }
  };
}

function readTool(name: string, description: string, parameters: Record<string, unknown>): ToolDefinition {
  return workspaceTool(name, description, parameters, "read_workspace", "low");
}

function editTool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  riskLevel: ToolDefinition["riskLevel"] = "medium"
): ToolDefinition {
  return workspaceTool(name, description, parameters, "edit_workspace", riskLevel);
}

const directoryParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    path: { type: "string", description: "Workspace-relative directory path. Empty means workspace root." },
    recursive: { type: "boolean", description: "Whether to recursively list subdirectories." },
    max_entries: { type: "integer", minimum: 1, maximum: 500 }
  }
};

const readFileParameters = {
  type: "object",
  additionalProperties: false,
  required: ["path"],
  properties: {
    path: { type: "string", description: "Workspace-relative file path." },
    start_line: { type: "integer", minimum: 1 },
    end_line: { type: "integer", minimum: 1 }
  }
};

const searchParameters = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: { type: "string", description: "Plain text query to search for." },
    include_glob: { type: "string", description: "Optional VS Code glob include pattern, such as **/*.ts." },
    max_results: { type: "integer", minimum: 1, maximum: 100 }
  }
};

const writeFileParameters = {
  type: "object",
  additionalProperties: false,
  required: ["path", "content"],
  properties: {
    path: { type: "string", description: "Workspace-relative file path." },
    content: { type: "string", description: "Complete UTF-8 text content to write." }
  }
};

export const AGENT_TOOL_REGISTRY = new ToolRegistry();

for (const tool of [
  readTool("list_directory", "List files and folders in a workspace directory.", directoryParameters),
  readTool("find_files", "Find workspace files by glob pattern.", {
    type: "object",
    additionalProperties: false,
    properties: {
      pattern: { type: "string", description: "VS Code glob, such as **/*.ts. Defaults to **/*." },
      max_results: { type: "integer", minimum: 1, maximum: 500 }
    }
  }),
  readTool("search_text", "Search plain text across workspace files.", searchParameters),
  readTool("read_file", "Read a text file from the workspace.", readFileParameters),
  readTool("read_files", "Read multiple text files from the workspace.", {
    type: "object",
    additionalProperties: false,
    required: ["paths"],
    properties: {
      paths: { type: "array", items: { type: "string" }, maxItems: 20 }
    }
  }),
  readTool("read_file_range", "Read a specific 1-based line range from a workspace file.", readFileParameters),
  readTool("get_file_metadata", "Get file size, mtime and type metadata.", {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: { type: "string" }
    }
  }),
  readTool("get_workspace_structure", "Return a compact workspace tree summary.", directoryParameters),
  readTool("get_open_editors", "List currently open text editors.", { type: "object", additionalProperties: false, properties: {} }),
  readTool("get_selection", "Return the active editor selection metadata and text.", { type: "object", additionalProperties: false, properties: {} }),
  readTool("get_diagnostics", "Return VS Code diagnostics for workspace files.", {
    type: "object",
    additionalProperties: false,
    properties: {
      path: { type: "string", description: "Optional workspace-relative path." },
      max_results: { type: "integer", minimum: 1, maximum: 200 }
    }
  }),
  readTool("get_problems", "Alias for get_diagnostics.", {
    type: "object",
    additionalProperties: false,
    properties: {
      path: { type: "string" },
      max_results: { type: "integer", minimum: 1, maximum: 200 }
    }
  }),
  readTool("update_plan", "Update the visible task plan for the current agent session.", {
    type: "object",
    additionalProperties: false,
    required: ["summary"],
    properties: {
      summary: { type: "string" },
      steps: { type: "array", items: { type: "string" }, maxItems: 20 }
    }
  }),
  readTool("report_progress", "Report concise progress for the current agent session.", {
    type: "object",
    additionalProperties: false,
    required: ["summary"],
    properties: {
      summary: { type: "string" }
    }
  }),
  readTool("complete_task", "Signal that the agent task is complete with a final summary.", {
    type: "object",
    additionalProperties: false,
    required: ["summary"],
    properties: {
      summary: { type: "string" }
    }
  }),
  editTool("create_file", "Create a UTF-8 text file in the workspace. Use this directly when the user asks to create a file.", {
    type: "object",
    additionalProperties: false,
    required: ["path", "content"],
    properties: {
      path: { type: "string", description: "Workspace-relative file path to create." },
      content: { type: "string", description: "UTF-8 text content for the new file." },
      overwrite: { type: "boolean", description: "Overwrite an existing file when true. Defaults to false." }
    }
  }),
  editTool("modify_file", "Replace a workspace text file with the supplied complete UTF-8 content.", writeFileParameters),
  editTool("append_file", "Append UTF-8 text to a workspace file, creating it when create_if_missing is true or omitted.", {
    type: "object",
    additionalProperties: false,
    required: ["path", "content"],
    properties: {
      path: { type: "string", description: "Workspace-relative file path." },
      content: { type: "string", description: "UTF-8 text to append exactly." },
      create_if_missing: { type: "boolean", description: "Create the file if it does not exist. Defaults to true." }
    }
  }),
  editTool("delete_file", "Delete a workspace file. This never deletes directories or paths outside the workspace.", {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: { type: "string", description: "Workspace-relative file path to delete." },
      use_trash: { type: "boolean", description: "Move to trash when supported. Defaults to true." }
    }
  }, "high"),
  editTool("rename_file", "Rename or move a workspace file within the workspace.", {
    type: "object",
    additionalProperties: false,
    required: ["old_path", "new_path"],
    properties: {
      old_path: { type: "string", description: "Existing workspace-relative file path." },
      new_path: { type: "string", description: "New workspace-relative file path." },
      overwrite: { type: "boolean", description: "Overwrite an existing destination file when true. Defaults to false." }
    }
  }, "high"),
  readTool("list_workspace", "Deprecated alias for list_directory.", directoryParameters),
  readTool("search_workspace", "Deprecated alias for search_text.", searchParameters)
]) {
  AGENT_TOOL_REGISTRY.register(tool);
}

export const AGENT_WORKSPACE_TOOLS: ChatTool[] = AGENT_TOOL_REGISTRY.toChatTools();

export function isAgentWorkspaceTool(name: string): boolean {
  return AGENT_TOOL_REGISTRY.has(name);
}

export function getAgentToolDefinitionsForDisplay(): unknown {
  return AGENT_TOOL_REGISTRY.list().map((tool) => ({
    name: tool.name,
    description: tool.description,
    permissionCategory: tool.permissionCategory,
    riskLevel: tool.riskLevel,
    timeoutMs: tool.timeoutMs,
    parameters: tool.parameters
  }));
}
