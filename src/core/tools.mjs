/**
 * Shared 6-tool registry consumed by both the Magpie plugin entry and the stdio MCP server:
 * decide, choose, yes_no, score, decide_batch, status.
 *
 * Supports lightweight zero-restart hot reload whenever `~/.config/light-decision-mcp/config.json`,
 * `~/.config/light-decision-mcp/secrets.json`, or `<magpieDir>/plugins.json` changes on disk,
 * while preserving the live CircuitBreakerRegistry across reloads.
 */

import {
  getConfigMtimeSignature,
  getDefaultConfigPath,
  loadConfig,
} from "../config/load.mjs";
import { createSecretResolver, getDefaultSecretsPath } from "../config/secrets.mjs";
import { CircuitBreakerRegistry } from "./circuit-breaker.mjs";
import { toErrorPayload } from "./errors.mjs";
import { DecisionRouter } from "./router.mjs";
import {
  TOOL_DESCRIPTIONS,
  TOOL_SCHEMAS,
  validateChooseArgs,
  validateDecideArgs,
  validateDecideBatchArgs,
  validateScoreArgs,
  validateStatusArgs,
  validateYesNoArgs,
} from "./schema.mjs";

function unwrapSingleAnswer(result, questionKey) {
  const ans = result.answers[questionKey];
  /** @type {Record<string, any>} */
  const out = {
    backend: result.backend,
    model: result.model,
    data_destination: result.data_destination,
    fallback_used: result.fallback_used,
    ...(result.fallback_info ? { fallback_info: result.fallback_info } : {}),
    ...ans,
    latency_ms: result.latency_ms,
  };
  if (result.usage) out.usage = result.usage;
  if (result.warnings) out.warnings = result.warnings;
  return out;
}

/**
 * Create the 6 MCP/Magpie tools backed by a shared DecisionRouter instance.
 *
 * @param {{
 *   config?: ReturnType<typeof loadConfig>,
 *   pluginOptions?: Record<string, any>,
 *   configPath?: string,
 *   secretsPath?: string,
 *   magpieDir?: string,
 *   useLiveMagpieOptions?: boolean,
 *   hotReload?: boolean,
 *   env?: Record<string, string | undefined>,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 * }} [opts]
 */
export function createTools(opts = {}) {
  const env = opts.env || process.env;
  const configPath = opts.config?.configPath || opts.configPath || getDefaultConfigPath(env);
  const secretsPath = opts.config?.secretsPath || opts.secretsPath || getDefaultSecretsPath(env);
  const secretResolver = createSecretResolver({
    env,
    secretsPath,
    useKeychain: process.platform === "darwin" && opts.env === undefined,
  });

  const hotReloadEnabled = opts.hotReload !== undefined ? opts.hotReload : !opts.config;

  const buildConfig = () =>
    opts.config ||
    loadConfig({
      pluginOptions: opts.pluginOptions,
      configPath,
      secretsPath,
      magpieDir: opts.magpieDir,
      useLiveMagpieOptions: opts.useLiveMagpieOptions === true,
      env,
      secretResolver,
    });

  let currentConfig = buildConfig();
  const sharedCircuit = new CircuitBreakerRegistry({
    ...currentConfig.circuitBreaker,
    now: opts.now,
  });

  const buildRouter = (cfg) =>
    new DecisionRouter(cfg, {
      fetchImpl: opts.fetchImpl,
      env,
      magpieDir: opts.magpieDir,
      now: opts.now,
      secretResolver,
      circuit: sharedCircuit,
    });

  let currentRouter = buildRouter(currentConfig);
  let lastSig = hotReloadEnabled
    ? getConfigMtimeSignature({ configPath, secretsPath, magpieDir: opts.magpieDir })
    : "";

  function ensureFresh() {
    if (!hotReloadEnabled) return { router: currentRouter, config: currentConfig };
    const sig = getConfigMtimeSignature({ configPath, secretsPath, magpieDir: opts.magpieDir });
    if (sig !== lastSig) {
      lastSig = sig;
      secretResolver.clearCache();
      currentConfig = buildConfig();
      currentRouter = buildRouter(currentConfig);
    }
    return { router: currentRouter, config: currentConfig };
  }

  async function safeRun(fn) {
    try {
      const state = ensureFresh();
      return await fn(state);
    } catch (err) {
      return toErrorPayload(err);
    }
  }

  const tools = {
    decide: {
      description: TOOL_DESCRIPTIONS.decide,
      args: TOOL_SCHEMAS.decide,
      async execute(args, ctx = {}) {
        return safeRun(async ({ router, config }) => {
          const validated = validateDecideArgs(args, config.limits);
          return await router.decide(validated, ctx);
        });
      },
    },

    choose: {
      description: TOOL_DESCRIPTIONS.choose,
      args: TOOL_SCHEMAS.choose,
      async execute(args, ctx = {}) {
        return safeRun(async ({ router, config }) => {
          const validated = validateChooseArgs(args, config.limits);
          const res = await router.decide(validated, ctx);
          return unwrapSingleAnswer(res, validated.question);
        });
      },
    },

    yes_no: {
      description: TOOL_DESCRIPTIONS.yes_no,
      args: TOOL_SCHEMAS.yes_no,
      async execute(args, ctx = {}) {
        return safeRun(async ({ router, config }) => {
          const validated = validateYesNoArgs(args, config.limits);
          const res = await router.decide(validated, ctx);
          return unwrapSingleAnswer(res, validated.question);
        });
      },
    },

    score: {
      description: TOOL_DESCRIPTIONS.score,
      args: TOOL_SCHEMAS.score,
      async execute(args, ctx = {}) {
        return safeRun(async ({ router, config }) => {
          const validated = validateScoreArgs(args, config.limits);
          const res = await router.decide(validated, ctx);
          return unwrapSingleAnswer(res, validated.question);
        });
      },
    },

    decide_batch: {
      description: TOOL_DESCRIPTIONS.decide_batch,
      args: TOOL_SCHEMAS.decide_batch,
      async execute(args, ctx = {}) {
        return safeRun(async ({ router, config }) => {
          const validated = validateDecideBatchArgs(args, config.limits);
          return await router.decideBatch(validated, ctx);
        });
      },
    },

    status: {
      description: TOOL_DESCRIPTIONS.status,
      args: TOOL_SCHEMAS.status,
      async execute(args, ctx = {}) {
        return safeRun(async ({ router }) => {
          const filter = validateStatusArgs(args);
          return await router.status(filter, ctx);
        });
      },
    },
  };

  return {
    tools,
    get router() {
      return ensureFresh().router;
    },
    get config() {
      return ensureFresh().config;
    },
  };
}
