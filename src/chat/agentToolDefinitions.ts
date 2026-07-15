import type { ChatTool } from "../api/types";

export const AGENT_WORKSPACE_TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "list_workspace",
      description: "List files and folders in the current VS Code workspace. Use this first to inspect the project tree.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative directory path. Omit or use empty string for the workspace root."
          },
          recursive: {
            type: "boolean",
            description: "Whether to recursively list subdirectories."
          },
          max_entries: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            description: "Maximum number of entries to return."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file from the current VS Code workspace by workspace-relative path.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative file path to read."
          },
          start_line: {
            type: "integer",
            minimum: 1,
            description: "Optional 1-based start line."
          },
          end_line: {
            type: "integer",
            minimum: 1,
            description: "Optional 1-based end line."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_workspace",
      description: "Search text across workspace files and return matching file paths and line snippets.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description: "Plain text query to search for."
          },
          include_glob: {
            type: "string",
            description: "Optional VS Code glob include pattern, such as **/*.ts."
          },
          max_results: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Maximum number of matching lines to return."
          }
        }
      }
    }
  }
];

export function isAgentWorkspaceTool(name: string): boolean {
  return AGENT_WORKSPACE_TOOLS.some((tool) => tool.function.name === name);
}
