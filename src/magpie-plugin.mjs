/**
 * Magpie OpenCode v1 Plugin Entrypoint for light-decision-mcp.
 *
 * Host contract guardrails:
 * - Zero external imports (NO @opencode-ai/plugin)
 * - Uses `export default { id, server }` only (no stray top-level exported functions)
 * - Declares ONLY the `tool` hook (NO `auth` or `config` provider hooks)
 * - Never writes ordinary logs to stdout
 */

import { createTools } from "./core/tools.mjs";

const plugin = {
  id: "light-decision-mcp",

  /**
   * @param {any} input
   * @param {Record<string, any>} [options]
   */
  async server(input, options) {
    const magpieDir =
      input && typeof input.directory === "string" && input.directory.trim()
        ? input.directory.trim()
        : undefined;

    const { tools } = createTools({
      pluginOptions: options && typeof options === "object" ? options : {},
      magpieDir,
      useLiveMagpieOptions: Boolean(magpieDir),
      hotReload: true,
    });

    if (typeof input?.client?.app?.log === "function") {
      try {
        input.client.app.log({
          level: "info",
          message: `[light-decision-mcp] registered ${Object.keys(tools).length} decision tools`,
        });
      } catch {
        // Best-effort structured logging only
      }
    }

    return { tool: tools };
  },
};

export default plugin;
