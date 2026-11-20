#!/usr/bin/env node
/**
 * Zero-dependency MCP server over stdio (newline-delimited JSON-RPC 2.0).
 *
 * Designed for claude-desktop and any MCP client that speaks stdio directly.
 * stdout carries strictly JSON-RPC frames; diagnostics go strictly to stderr.
 */

import readline from "node:readline";
import { PACKAGE_VERSION } from "../src/core/router.mjs";
import { createTools } from "../src/core/tools.mjs";

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-03-26", "2024-11-05"];

const SERVER_INSTRUCTIONS =
  "Light Decision MCP evaluates typed bounded questions (noul/yes-no, choice, score) with calibrated probabilities across multiple cloud and local System One decision backends (Magpie gateway, local OpenDecider, TypeSafe Jev, Perplexity, Google & OpenAI), supporting api_only, local_only, and api_with_local_fallback routing.";

/**
 * Create a JSON-RPC MCP message handler around the shared tool registry.
 * Exported for in-process protocol testing without spawning child processes.
 *
 * @param {Parameters<typeof createTools>[0]} [opts]
 */
export function createStdioHandler(opts = {}) {
  const { tools } = createTools(opts);

  const toolDefinitions = Object.entries(tools).map(([name, def]) => ({
    name,
    description: def.description,
    inputSchema: def.args,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: name !== "status",
    },
  }));

  /**
   * Handle one parsed JSON-RPC 2.0 request object.
   * Returns null for notifications (no response should be emitted).
   *
   * @param {any} msg
   */
  async function handleMessage(msg) {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      return {
        jsonrpc: "2.0",
        id: msg?.id ?? null,
        error: { code: -32600, message: "Invalid JSON-RPC 2.0 request" },
      };
    }

    const { id, method, params } = msg;
    const isNotification = id === undefined;

    if (method === "notifications/initialized" || method === "notifications/cancelled") {
      return null;
    }

    if (method === "ping") {
      return isNotification ? null : { jsonrpc: "2.0", id, result: {} };
    }

    if (method === "initialize") {
      const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0];

      return isNotification
        ? null
        : {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion,
              capabilities: {
                tools: { listChanged: false },
              },
              serverInfo: {
                name: "light-decision-mcp",
                version: PACKAGE_VERSION,
              },
              instructions: SERVER_INSTRUCTIONS,
            },
          };
    }

    if (method === "tools/list") {
      return isNotification
        ? null
        : {
            jsonrpc: "2.0",
            id,
            result: {
              tools: toolDefinitions,
            },
          };
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments ?? {};
      const toolDef = typeof toolName === "string" ? tools[toolName] : undefined;

      if (!toolDef) {
        return isNotification
          ? null
          : {
              jsonrpc: "2.0",
              id,
              error: { code: -32602, message: `Unknown tool: ${String(toolName)}` },
            };
      }

      const controller = new AbortController();
      const result = await toolDef.execute(toolArgs, {
        agent: "stdio",
        directory: process.cwd(),
        worktree: process.cwd(),
        abort: controller.signal,
      });

      const isError = Boolean(result && typeof result === "object" && "error" in result);
      return isNotification
        ? null
        : {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result),
                },
              ],
              isError,
            },
          };
    }

    if (isNotification) return null;
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }

  return { handleMessage, tools };
}

/**
 * Start reading newline-delimited JSON-RPC messages from stdin and writing to stdout.
 * Processes frames sequentially in arrival order so parse errors never overtake
 * in-flight async requests and EOF waits for pending replies to flush.
 */
export async function runStdioServer(opts = {}) {
  const { handleMessage } = createStdioHandler(opts);
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error: invalid JSON" },
        }) + "\n",
      );
      continue;
    }

    try {
      const reply = await handleMessage(msg);
      if (reply !== null) {
        process.stdout.write(JSON.stringify(reply) + "\n");
      }
    } catch (err) {
      process.stderr.write(
        `[light-decision-mcp-stdio] internal error: ${err instanceof Error ? err.stack : String(err)}\n`,
      );
      if (msg && msg.id !== undefined) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            error: {
              code: -32603,
              message: err instanceof Error ? err.message : String(err),
            },
          }) + "\n",
        );
      }
    }
  }
}

// Run when executed directly as CLI binary
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/stdio.mjs") ||
    process.argv[1].endsWith("\\stdio.mjs") ||
    process.argv[1].endsWith("/light-decision-mcp-stdio"));

if (invokedDirectly) {
  runStdioServer();
}
