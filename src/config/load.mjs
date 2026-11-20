/**
 * Layered configuration loader, live Magpie plugins.json reader, & zero-config discovery.
 *
 * Precedence (highest -> lowest):
 * 1. Per-call tool arguments (handled in router)
 * 2. Non-empty Magpie plugin options (`server(input, options)` or live `<magpieDir>/plugins.json`)
 * 3. User config file (`LIGHT_DECISION_CONFIG` or `~/.config/light-decision-mcp/config.json`)
 * 4. Environment variables + local 0600 secrets.json / macOS Keychain presence
 * 5. Built-in defaults + zero-config auto-discovery
 *
 * Empty strings (`""`) and `null` in Magpie plugin options are treated as "unset"
 * so default package.json placeholders NEVER clobber `~/.config/light-decision-mcp/config.json`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CIRCUIT_CONFIG } from "../core/circuit-breaker.mjs";
import { DATA_DESTINATIONS, DEFAULT_LIMITS, ROUTING_MODES } from "../core/schema.mjs";
import { createSecretResolver, getDefaultSecretsPath } from "./secrets.mjs";

export const CONFIG_VERSION = 1;

export function getDefaultConfigPath(env = process.env) {
  if (env.LIGHT_DECISION_CONFIG && env.LIGHT_DECISION_CONFIG.trim()) {
    return path.resolve(env.LIGHT_DECISION_CONFIG.trim());
  }
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim();
  const root = xdg || path.join(os.homedir(), ".config");
  return path.join(root, "light-decision-mcp", "config.json");
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Read live plugin options from `<magpieDir>/plugins.json` so edits made in
 * Magpie's visual Plugin Page (`magpie.options.set`) or Plugins JSON editor
 * take effect immediately on the next request without restarting Magpie.
 *
 * @param {string | undefined} magpieDir
 * @returns {{ options: Record<string, any> | null, pluginsJsonPath: string | null }}
 */
export function readLiveMagpiePluginOptions(magpieDir) {
  if (!magpieDir) return { options: null, pluginsJsonPath: null };
  const pluginsJsonPath = path.join(magpieDir, "plugins.json");
  const data = readJsonSafe(pluginsJsonPath);
  const list = Array.isArray(data?.plugins) ? data.plugins : [];
  const match = list.find((entry) => {
    const spec = typeof entry?.spec === "string" ? entry.spec.toLowerCase() : "";
    return spec.includes("light-decision-mcp");
  });
  if (match && match.options && typeof match.options === "object" && !Array.isArray(match.options)) {
    return { options: match.options, pluginsJsonPath };
  }
  return { options: null, pluginsJsonPath };
}

function nonEmptyString(val) {
  return typeof val === "string" && val.trim() ? val.trim() : undefined;
}

function positiveInt(val, fallback, max) {
  if (val === undefined || val === null || val === "") return fallback;
  const n = typeof val === "string" && val.trim() ? Number(val) : val;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return fallback;
  const floored = Math.floor(n);
  return max ? Math.min(floored, max) : floored;
}

function optionalBool(val) {
  if (typeof val === "boolean") return val;
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  return undefined;
}

function hasMagpiePresent(opts, env, fileConfig) {
  if (typeof opts.magpieAvailable === "boolean") return opts.magpieAvailable;
  if (opts.magpieDir) return true;
  if (nonEmptyString(env.MAGPIE_GATEWAY) || nonEmptyString(fileConfig.gatewayUrl)) return true;
  if (fileConfig.backends?.magpie?.enabled === true) return true;
  const defaultMagpieDir = env.MAGPIE_DIR || path.join(os.homedir(), ".config", "magpie");
  return fs.existsSync(path.join(defaultMagpieDir, "gateway.json"));
}

function buildDefaultBackends(env, secretResolver, magpieEnabled) {
  const openDeciderUrl = (env.OPENDECIDER_URL || "http://127.0.0.1:8001").trim();
  const typesafeUrl = (env.TYPESAFE_BASE_URL || "https://api.typesafe.ai").trim();

  return {
    magpie: {
      id: "magpie",
      type: "magpie",
      enabled: magpieEnabled,
      defaultModel: "google/gemini-decision-1",
    },
    "local-opendecider": {
      id: "local-opendecider",
      type: "systemone",
      enabled: true,
      baseUrl: openDeciderUrl,
      sendModel: false,
      defaultModel: "local-opendecider",
      dataDestination: "on-device",
    },
    typesafe: {
      id: "typesafe",
      type: "systemone",
      enabled: Boolean(secretResolver.get("TYPESAFE_API_KEY")),
      baseUrl: typesafeUrl,
      sendModel: true,
      defaultModel: "jev-latest",
      apiKeyEnv: "TYPESAFE_API_KEY",
      dataDestination: "third-party",
    },
    perplexity: {
      id: "perplexity",
      type: "perplexity",
      enabled: Boolean(secretResolver.get("PERPLEXITY_API_KEY")),
      baseUrl: "https://api.perplexity.ai",
      defaultModel: "pplx-decider-v1.3",
      apiKeyEnv: "PERPLEXITY_API_KEY",
      dataDestination: "third-party",
    },
    "google-direct": {
      id: "google-direct",
      type: "google-direct",
      enabled: Boolean(secretResolver.get("GEMINI_API_KEY") || secretResolver.get("GOOGLE_API_KEY")),
      baseUrl: "https://generativelanguage.googleapis.com",
      defaultModel: "gemini-decision-1",
      apiKeyEnv: "GEMINI_API_KEY",
      fallbackApiKeyEnv: "GOOGLE_API_KEY",
      dataDestination: "third-party",
    },
    "openai-direct": {
      id: "openai-direct",
      type: "openai-direct",
      enabled: Boolean(secretResolver.get("OPENAI_API_KEY")),
      baseUrl: "https://api.openai.com",
      defaultModel: "gpt-6-luna",
      apiKeyEnv: "OPENAI_API_KEY",
      dataDestination: "third-party",
    },
  };
}

function sanitizeBackendConfig(id, raw, warnings) {
  const clean = { ...raw, id };
  if ("apiKey" in clean || "api_key" in clean) {
    delete clean.apiKey;
    delete clean.api_key;
    warnings.push(
      `backend '${id}': ignored plaintext 'apiKey' in config; use 'apiKeyEnv' + 'light-decision-mcp key set' or env vars instead`,
    );
  }
  return clean;
}

/**
 * Compute a lightweight mtime signature across config, secrets, and Magpie plugins.json
 * to support zero-restart hot reload.
 *
 * @param {{ configPath: string, secretsPath: string, magpieDir?: string }} paths
 * @returns {string}
 */
export function getConfigMtimeSignature(paths) {
  const files = [
    paths.configPath,
    paths.secretsPath,
    paths.magpieDir ? path.join(paths.magpieDir, "plugins.json") : null,
  ];
  return files
    .map((f) => {
      if (!f) return "0";
      try {
        return String(fs.statSync(f).mtimeMs);
      } catch {
        return "0";
      }
    })
    .join("|");
}

/**
 * Load effective runtime configuration.
 * @param {{
 *   pluginOptions?: Record<string, any>,
 *   configPath?: string,
 *   secretsPath?: string,
 *   env?: Record<string, string | undefined>,
 *   magpieDir?: string,
 *   useLiveMagpieOptions?: boolean,
 *   secretResolver?: ReturnType<typeof createSecretResolver>,
 * }} [opts]
 */
export function loadConfig(opts = {}) {
  const env = opts.env || process.env;
  const configPath = opts.configPath || getDefaultConfigPath(env);
  const secretsPath = opts.secretsPath || getDefaultSecretsPath(env);
  const secretResolver =
    opts.secretResolver ||
    createSecretResolver({
      env,
      secretsPath,
      useKeychain: process.platform === "darwin" && opts.env === undefined,
    });

  const liveMagpie =
    opts.useLiveMagpieOptions && opts.magpieDir
      ? readLiveMagpiePluginOptions(opts.magpieDir).options
      : null;

  // Live plugins.json overrides initial startup snapshot when present
  const pluginOptions = {
    ...(opts.pluginOptions && typeof opts.pluginOptions === "object" ? opts.pluginOptions : {}),
    ...(liveMagpie || {}),
  };

  const fileConfig = readJsonSafe(configPath) || {};
  /** @type {string[]} */
  const configWarnings = [];

  const magpiePresent = hasMagpiePresent(opts, env, fileConfig);
  const backends = buildDefaultBackends(env, secretResolver, magpiePresent);

  if (
    fileConfig.backends &&
    typeof fileConfig.backends === "object" &&
    !Array.isArray(fileConfig.backends)
  ) {
    for (const [id, rawCfg] of Object.entries(fileConfig.backends)) {
      if (!rawCfg || typeof rawCfg !== "object" || Array.isArray(rawCfg)) continue;
      const sanitized = sanitizeBackendConfig(id, rawCfg, configWarnings);
      backends[id] = {
        ...(backends[id] || {}),
        ...sanitized,
        id,
      };
    }
  }

  // Pick a smart standalone default backend when Magpie is not installed/running
  const explicitDefaultBackend =
    nonEmptyString(pluginOptions.defaultBackend) ||
    nonEmptyString(fileConfig.defaultBackend) ||
    nonEmptyString(env.LIGHT_DECISION_BACKEND);

  let inferredDefaultBackend = "magpie";
  if (!explicitDefaultBackend && !backends.magpie?.enabled) {
    const customEnabled = Object.entries(backends).find(
      ([id, b]) =>
        b &&
        b.enabled !== false &&
        id !== "magpie" &&
        id !== "local-opendecider" &&
        b.dataDestination !== "on-device",
    );
    const preferredOrder = ["google-direct", "typesafe", "perplexity", "openai-direct"];
    const directCloud = preferredOrder.find((id) => backends[id]?.enabled);
    inferredDefaultBackend = directCloud || customEnabled?.[0] || "local-opendecider";
  }

  const defaultBackend = explicitDefaultBackend || inferredDefaultBackend;

  // Non-empty plugin options override fileConfig; empty strings / null inherit cleanly
  const explicitMode =
    nonEmptyString(pluginOptions.routingMode) ||
    nonEmptyString(fileConfig.routingMode) ||
    nonEmptyString(env.LIGHT_DECISION_MODE);
  const inferredMode =
    defaultBackend === "local-opendecider" && !backends.magpie?.enabled
      ? "local_only"
      : "api_with_local_fallback";
  const rawMode = explicitMode || inferredMode;
  const routingMode = ROUTING_MODES.includes(rawMode) ? rawMode : "api_with_local_fallback";

  const rawMaxDest =
    nonEmptyString(pluginOptions.maxDataDestination) ||
    nonEmptyString(fileConfig.maxDataDestination) ||
    nonEmptyString(env.LIGHT_DECISION_MAX_DATA_DESTINATION) ||
    "third-party";
  const maxDataDestination = DATA_DESTINATIONS.includes(rawMaxDest) ? rawMaxDest : "third-party";

  const fallbackBackend =
    nonEmptyString(pluginOptions.fallbackBackend) ||
    nonEmptyString(fileConfig.fallbackBackend) ||
    nonEmptyString(env.LIGHT_DECISION_FALLBACK_BACKEND) ||
    "local-opendecider";

  const explicitDefaultModel =
    nonEmptyString(pluginOptions.defaultModel) ||
    nonEmptyString(fileConfig.defaultModel) ||
    nonEmptyString(env.LIGHT_DECISION_MODEL);
  const defaultModel =
    explicitDefaultModel ||
    backends[defaultBackend]?.defaultModel ||
    "google/gemini-decision-1";

  const gatewayUrl =
    nonEmptyString(pluginOptions.gatewayUrl) ||
    nonEmptyString(fileConfig.gatewayUrl) ||
    nonEmptyString(env.MAGPIE_GATEWAY) ||
    "";

  // If user explicitly picked a direct backend in pluginOptions/config, auto-enable it
  if (backends[defaultBackend] && backends[defaultBackend].enabled === false && nonEmptyString(pluginOptions.defaultBackend)) {
    backends[defaultBackend].enabled = true;
  }
  if (backends[fallbackBackend] && backends[fallbackBackend].enabled === false && nonEmptyString(pluginOptions.fallbackBackend)) {
    backends[fallbackBackend].enabled = true;
  }

  if (backends.magpie) {
    if (gatewayUrl) backends.magpie.gatewayUrl = gatewayUrl;
    if (opts.magpieDir) backends.magpie.magpieDir = opts.magpieDir;
    if (defaultBackend === "magpie" && defaultModel) {
      backends.magpie.defaultModel = defaultModel;
    }
  } else if (backends[defaultBackend] && defaultModel) {
    backends[defaultBackend].defaultModel = defaultModel;
  }
  if (defaultBackend !== "magpie" && backends[defaultBackend] && nonEmptyString(pluginOptions.defaultModel)) {
    backends[defaultBackend].defaultModel = defaultModel;
  }

  const limits = {
    questions: positiveInt(
      pluginOptions.maxQuestions ?? fileConfig.limits?.questions,
      DEFAULT_LIMITS.questions,
      DEFAULT_LIMITS.maxQuestions,
    ),
    maxQuestions: DEFAULT_LIMITS.maxQuestions,
    options: DEFAULT_LIMITS.options,
    stateChars: positiveInt(
      pluginOptions.maxStateChars ?? fileConfig.limits?.stateChars,
      DEFAULT_LIMITS.stateChars,
    ),
    images: positiveInt(
      pluginOptions.maxImages ?? fileConfig.limits?.images,
      DEFAULT_LIMITS.images,
      16,
    ),
    imageMaxBytes: positiveInt(
      pluginOptions.imageMaxBytes ?? fileConfig.limits?.imageMaxBytes,
      DEFAULT_LIMITS.imageMaxBytes,
      20 * 1024 * 1024,
    ),
    batchStates: positiveInt(
      pluginOptions.maxBatchStates ?? fileConfig.limits?.batchStates,
      DEFAULT_LIMITS.batchStates,
      256,
    ),
    batchItems: positiveInt(
      pluginOptions.maxBatchItems ?? fileConfig.limits?.batchItems,
      DEFAULT_LIMITS.batchItems,
      1024,
    ),
    batchConcurrency: positiveInt(
      pluginOptions.batchConcurrency ?? fileConfig.limits?.batchConcurrency,
      DEFAULT_LIMITS.batchConcurrency,
      DEFAULT_LIMITS.maxBatchConcurrency,
    ),
    maxBatchConcurrency: DEFAULT_LIMITS.maxBatchConcurrency,
    timeoutMs: positiveInt(
      pluginOptions.timeoutMs ?? fileConfig.timeoutMs ?? env.LIGHT_DECISION_TIMEOUT_MS,
      DEFAULT_LIMITS.timeoutMs,
      55_000,
    ),
    primaryTimeoutMs: positiveInt(
      pluginOptions.primaryTimeoutMs ?? fileConfig.primaryTimeoutMs,
      DEFAULT_LIMITS.primaryTimeoutMs,
      50_000,
    ),
    fallbackTimeoutMs: positiveInt(
      pluginOptions.fallbackTimeoutMs ?? fileConfig.fallbackTimeoutMs,
      DEFAULT_LIMITS.fallbackTimeoutMs,
      30_000,
    ),
  };

  const fallbackOnNotConfigured =
    optionalBool(pluginOptions.fallbackOnNotConfigured) ??
    optionalBool(fileConfig.fallbackOnNotConfigured) ??
    optionalBool(env.LIGHT_DECISION_FALLBACK_ON_NOT_CONFIGURED) ??
    false;

  const circuitBreaker = {
    failureThreshold: positiveInt(
      fileConfig.circuitBreaker?.failureThreshold,
      DEFAULT_CIRCUIT_CONFIG.failureThreshold,
      10,
    ),
    cooldownMs: positiveInt(
      fileConfig.circuitBreaker?.cooldownMs,
      DEFAULT_CIRCUIT_CONFIG.cooldownMs,
      300_000,
    ),
    maxCooldownMs: positiveInt(
      fileConfig.circuitBreaker?.maxCooldownMs,
      DEFAULT_CIRCUIT_CONFIG.maxCooldownMs,
      600_000,
    ),
  };

  return {
    version: CONFIG_VERSION,
    configPath,
    secretsPath,
    configFileExists: fs.existsSync(configPath),
    routingMode,
    defaultBackend,
    fallbackBackend,
    defaultModel,
    maxDataDestination,
    fallbackOnNotConfigured,
    limits,
    circuitBreaker,
    backends,
    configWarnings,
  };
}

/**
 * Safely persist user config file without ever writing plaintext API keys.
 * @param {string} configPath
 * @param {Record<string, any>} configObj
 */
export function saveConfigFile(configPath, configObj) {
  const cloned = structuredClone(configObj);
  if (cloned.backends && typeof cloned.backends === "object") {
    for (const cfg of Object.values(cloned.backends)) {
      if (cfg && typeof cfg === "object") {
        delete cfg.apiKey;
        delete cfg.api_key;
      }
    }
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cloned, null, 2) + "\n", { mode: 0o600 });
}
