import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "dist/test/integration/suite/**/*.js",
  extensionDevelopmentPath: process.cwd(),
  workspaceFolder: process.cwd(),
  launchArgs: ["--disable-updates"],
  mocha: {
    timeout: 20000
  }
});
