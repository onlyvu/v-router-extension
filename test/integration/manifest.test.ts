import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("extension manifest integration checks", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    name: string;
    contributes: {
      viewsContainers: {
        activitybar: Array<{ id: string; when?: string }>;
        secondarySidebar: Array<{ id: string; title?: string; when?: string }>;
      };
      views: Record<string, Array<{ id: string; type?: string; when?: string }>>;
      commands: Array<{ command: string }>;
      menus: Record<string, Array<{ command: string; when?: string }>>;
      configuration: { properties: Record<string, unknown> };
    };
    capabilities: { untrustedWorkspaces: { supported: boolean } };
  };

  it("declares required package identity and views", () => {
    expect(manifest.name).toBe("v-router-smart");
    expect(manifest.contributes.viewsContainers.secondarySidebar[0]).toMatchObject({
      id: "vRouterSmartSecondary",
      title: "V-Router",
      when: "!vRouterSmart.doesNotSupportSecondarySidebar"
    });
    expect(manifest.contributes.viewsContainers.activitybar[0]).toMatchObject({
      id: "vRouterSmart",
      title: "V-Router",
      when: "vRouterSmart.doesNotSupportSecondarySidebar"
    });
    expect(manifest.contributes.views.vRouterSmartSecondary?.[0]).toMatchObject({
      id: "vRouterSmart.chatSecondaryView",
      name: "V-Router",
      type: "webview",
      when: "!vRouterSmart.doesNotSupportSecondarySidebar"
    });
    expect(manifest.contributes.views.vRouterSmart?.[0]).toMatchObject({
      id: "vRouterSmart.chatView",
      name: "V-Router",
      type: "webview",
      when: "vRouterSmart.doesNotSupportSecondarySidebar"
    });
  });

  it("declares all required commands", () => {
    const commands = new Set(manifest.contributes.commands.map((command) => command.command));
    for (const command of [
      "vRouterSmart.openChat",
      "vRouterSmart.setApiKey",
      "vRouterSmart.removeApiKey",
      "vRouterSmart.validateApiKey",
      "vRouterSmart.refreshModels",
      "vRouterSmart.refreshQuota",
      "vRouterSmart.refreshView",
      "vRouterSmart.openSettings",
      "vRouterSmart.newChat",
      "vRouterSmart.clearAllHistory",
      "vRouterSmart.showTaskHistory",
      "vRouterSmart.attachSelection",
      "vRouterSmart.explainSelection",
      "vRouterSmart.fixSelection",
      "vRouterSmart.showLastRequest",
      "vRouterSmart.openLogs"
    ]) {
      expect(commands.has(command)).toBe(true);
    }
  });

  it("declares native view title actions", () => {
    const viewTitleCommands = new Set((manifest.contributes.menus["view/title"] ?? []).map((item) => item.command));
    expect(viewTitleCommands.has("vRouterSmart.refreshView")).toBe(true);
    expect(viewTitleCommands.has("vRouterSmart.openSettings")).toBe(true);
    expect(viewTitleCommands.has("vRouterSmart.newChat")).toBe(true);
  });

  it("declares required configuration and restricted workspace support", () => {
    expect(manifest.contributes.configuration.properties["vRouterSmart.systemPrompt"]).toBeDefined();
    expect(manifest.contributes.configuration.properties["vRouterSmart.serverOrigin"]).toBeUndefined();
    expect(manifest.contributes.configuration.properties["vRouterSmart.agent.permissionMode"]).toBeDefined();
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe(true);
  });
});
