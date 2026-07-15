import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");

const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: false,
  logLevel: "info"
};

const webviewConfig = {
  entryPoints: ["src/webview/src/main.ts"],
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "iife",
  outdir: "dist/webview",
  entryNames: "[name]",
  assetNames: "assets/[name]",
  sourcemap: false,
  logLevel: "info"
};

if (isWatch) {
  const contexts = await Promise.all([
    esbuild.context(extensionConfig),
    esbuild.context(webviewConfig)
  ]);
  await Promise.all(contexts.map((context) => context.watch()));
  console.log("Watching extension and webview bundles...");
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig)
  ]);
}
