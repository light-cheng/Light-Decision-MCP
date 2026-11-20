import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createStdioHandler } from "../bin/stdio.mjs";
import * as pluginModule from "../src/magpie-plugin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

describe("Magpie plugin host contract", () => {
  it("satisfies package.json & OpenCode v1 export guardrails", async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    assert.equal(pkg.type, "module");
    assert.equal(pkg.main, "./src/magpie-plugin.mjs");
    assert.ok(pkg.magpie.icon.startsWith("data:image/png;base64,"));
    assert.ok(pkg.magpie.options && typeof pkg.magpie.options === "object");
    assert.equal(pkg.magpie.page.file, "page/index.html");
    assert.equal(pkg.magpie.page.icon, "page/icon.png");

    // Verify sandboxed Magpie page assets (must load _magpie/bridge.js, zero inline script)
    const pageHtml = fs.readFileSync(path.join(REPO_ROOT, "page", "index.html"), "utf8");
    assert.ok(pageHtml.includes('<script src="_magpie/bridge.js"></script>'));
    assert.ok(!/<script(?:\s[^>]*)?>\s*[^<\s]/i.test(pageHtml), "page/index.html must not contain inline JS");
    assert.ok(fs.existsSync(path.join(REPO_ROOT, "page", "icon.png")));

    // Only default export { id, server }; no stray top-level exported functions
    const exportedKeys = Object.keys(pluginModule);
    assert.deepEqual(exportedKeys, ["default"]);
    assert.equal(pluginModule.default.id, "light-decision-mcp");
    assert.equal(typeof pluginModule.default.server, "function");

    const logs = [];
    const hooks = await pluginModule.default.server(
      {
        directory: "/nonexistent-magpie-dir-for-test",
        client: { app: { log: (entry) => logs.push(entry) } },
      },
      { routingMode: "local_only", timeoutMs: 5000 },
    );

    // Must NOT declare auth or config provider hooks
    assert.equal(hooks.auth, undefined);
    assert.equal(hooks.config, undefined);
    assert.ok(hooks.tool && typeof hooks.tool === "object");

    const names = Object.keys(hooks.tool).sort();
    assert.deepEqual(names, ["choose", "decide", "decide_batch", "score", "status", "yes_no"]);

    const TOOL_NAME = /^[A-Za-z0-9_-]{1,48}$/;
    for (const [name, def] of Object.entries(hooks.tool)) {
      assert.ok(TOOL_NAME.test(name), `invalid tool name: ${name}`);
      assert.equal(typeof def.description, "string");
      assert.equal(def.args.type, "object");
      assert.equal(typeof def.args.properties, "object");
      assert.equal(typeof def.execute, "function");
    }
    assert.equal(logs.length, 1);
  });
});

describe("stdio MCP JSON-RPC 2.0 protocol", () => {
  it("handles initialize, ping, tools/list, tools/call, notifications, and unknown methods", async () => {
    const { handleMessage } = createStdioHandler({
      pluginOptions: { routingMode: "local_only" },
      env: {},
    });

    const init = await handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {} },
    });
    assert.equal(init.result.serverInfo.name, "light-decision-mcp");
    assert.equal(init.result.protocolVersion, "2025-03-26");

    assert.equal(
      await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }),
      null,
    );

    const ping = await handleMessage({ jsonrpc: "2.0", id: 2, method: "ping" });
    assert.deepEqual(ping.result, {});

    const list = await handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    assert.equal(list.result.tools.length, 6);

    const badCall = await handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "yes_no", arguments: { state: "", question: "" } },
    });
    assert.equal(badCall.result.isError, true);
    const parsedErr = JSON.parse(badCall.result.content[0].text);
    assert.equal(parsedErr.error.code, "invalid_arguments");

    const unknown = await handleMessage({ jsonrpc: "2.0", id: 5, method: "resources/list" });
    assert.equal(unknown.error.code, -32601);
  });

  it("runs cleanly over real child-process stdio framing", async () => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, "bin", "stdio.mjs")], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, LIGHT_DECISION_MODE: "local_only" },
    });

    const lines = [];
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const parts = buffer.split("\n");
      buffer = parts.pop() || "";
      for (const p of parts) {
        if (p.trim()) lines.push(JSON.parse(p));
      }
    });

    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    child.stdin.write("not valid json\n");
    child.stdin.end();

    await new Promise((resolve, reject) => {
      child.on("close", resolve);
      child.on("error", reject);
    });

    assert.equal(lines.length, 3);
    assert.equal(lines[0].id, 1);
    assert.equal(lines[0].result.serverInfo.name, "light-decision-mcp");
    assert.equal(lines[1].id, 2);
    assert.equal(lines[1].result.tools.length, 6);
    assert.equal(lines[2].error.code, -32700);
  });
});
