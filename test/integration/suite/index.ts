import * as assert from "node:assert/strict";
import * as vscode from "vscode";

declare const suite: (name: string, callback: () => void) => void;
declare const test: (name: string, callback: () => Promise<void>) => void;

suite("V-Router Smart Extension Host", () => {
  test("activates and registers commands", async () => {
    const extension = vscode.extensions.getExtension("vrouter-smart.v-router-smart");
    assert.ok(extension, "Extension should be discoverable by publisher.name");
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      "vRouterSmart.openChat",
      "vRouterSmart.setApiKey",
      "vRouterSmart.removeApiKey",
      "vRouterSmart.validateApiKey",
      "vRouterSmart.refreshModels",
      "vRouterSmart.refreshQuota",
      "vRouterSmart.newChat",
      "vRouterSmart.attachSelection",
      "vRouterSmart.explainSelection",
      "vRouterSmart.fixSelection",
      "vRouterSmart.showLastRequest",
      "vRouterSmart.openLogs"
    ]) {
      assert.ok(commands.includes(command), `Command registered: ${command}`);
    }
  });
});
