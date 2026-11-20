/**
 * Zero-dependency standalone local Web Admin UI server (`light-decision-mcp ui`).
 *
 * Security invariants:
 * - Strictly binds to 127.0.0.1 (loopback only, never 0.0.0.0)
 * - Validates Host and Origin headers on every /api/* request (blocks DNS rebinding & cross-site requests)
 * - Requires a per-session random X-CSRF-Token header on every mutating request (POST/PUT/DELETE)
 * - Never echoes raw API key values over HTTP; only reports key source ("env" | "secrets.json" | "keychain" | null)
 * - Edits persist to ~/.config/light-decision-mcp/config.json & 0600 secrets.json and hot-reload automatically
 */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultConfigPath, loadConfig, saveConfigFile } from "../config/load.mjs";
import {
  createSecretResolver,
  getDefaultSecretsPath,
  isValidKeyName,
  removeFileSecret,
  removeKeychainSecret,
  setFileSecret,
  setKeychainSecret,
} from "../config/secrets.mjs";
import { PACKAGE_VERSION } from "../core/router.mjs";
import { DATA_DESTINATIONS, ROUTING_MODES } from "../core/schema.mjs";
import { createTools } from "../core/tools.mjs";
import { probeHostEnvironment } from "../wizard/hardware.mjs";
import { recommendModels } from "../wizard/recommend.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, "ui");
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const DEFAULT_KEY_NAMES = [
  "PERPLEXITY_API_KEY",
  "OPENROUTER_API_KEY",
  "TYPESAFE_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
];

const MAX_BODY_BYTES = 256 * 1024;

function isLoopbackHostHeader(hostHeader) {
  if (!hostHeader || typeof hostHeader !== "string") return false;
  const host = hostHeader.trim().toLowerCase();
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host.startsWith("127.0.0.1:") ||
    host.startsWith("localhost:") ||
    host === "[::1]" ||
    host.startsWith("[::1]:")
  );
}

function isAllowedOrigin(originHeader) {
  if (!originHeader) return true;
  try {
    const u = new URL(originHeader);
    return (
      (u.protocol === "http:" || u.protocol === "https:") &&
      (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1")
    );
  } catch {
    return false;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function sendFile(res, filePath, contentType) {
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Request body too large"), { status: 413 });
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw Object.assign(new Error("Request body must be a JSON object"), { status: 400 });
    }
    return parsed;
  } catch (err) {
    if (err.status) throw err;
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
}

function collectKeyNames(config) {
  const set = new Set(DEFAULT_KEY_NAMES);
  for (const b of Object.values(config.backends || {})) {
    if (b && typeof b.apiKeyEnv === "string" && isValidKeyName(b.apiKeyEnv)) {
      set.add(b.apiKeyEnv.trim());
    }
    if (b && typeof b.fallbackApiKeyEnv === "string" && isValidKeyName(b.fallbackApiKeyEnv)) {
      set.add(b.fallbackApiKeyEnv.trim());
    }
  }
  return [...set];
}

function validateAndSanitizeConfigPatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("Config payload must be an object"), { status: 400 });
  }
  const routingMode = ROUTING_MODES.includes(body.routingMode)
    ? body.routingMode
    : "api_with_local_fallback";
  const maxDataDestination =
    routingMode === "local_only"
      ? "on-device"
      : DATA_DESTINATIONS.includes(body.maxDataDestination)
        ? body.maxDataDestination
        : "third-party";

  const posInt = (v, fallback, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(n)));
  };

  /** @type {Record<string, any>} */
  const backends = {};
  if (body.backends && typeof body.backends === "object" && !Array.isArray(body.backends)) {
    const allowedTypes = new Set([
      "magpie",
      "systemone",
      "perplexity",
      "google-direct",
      "gemini-decisions",
      "openai-direct",
      "openai-decisions",
      "decisions-gateway",
    ]);
    for (const [rawId, rawCfg] of Object.entries(body.backends)) {
      const id = String(rawId || "").trim();
      if (!/^[A-Za-z0-9_-]{1,48}$/.test(id)) {
        throw Object.assign(
          new Error(`Invalid backend id '${rawId}' (use 1-48 chars matching [A-Za-z0-9_-])`),
          { status: 400 },
        );
      }
      if (!rawCfg || typeof rawCfg !== "object" || Array.isArray(rawCfg)) continue;
      if (!allowedTypes.has(rawCfg.type)) {
        throw Object.assign(new Error(`Unsupported backend type '${rawCfg.type}' on '${id}'`), {
          status: 400,
        });
      }
      const clean = {
        type: rawCfg.type,
        enabled: rawCfg.enabled !== false,
      };
      if (typeof rawCfg.baseUrl === "string" && rawCfg.baseUrl.trim()) {
        clean.baseUrl = rawCfg.baseUrl.trim();
      }
      if (typeof rawCfg.gatewayUrl === "string" && rawCfg.gatewayUrl.trim()) {
        clean.gatewayUrl = rawCfg.gatewayUrl.trim();
      }
      if (typeof rawCfg.endpointPath === "string" && rawCfg.endpointPath.trim()) {
        clean.endpointPath = rawCfg.endpointPath.trim();
      }
      if (typeof rawCfg.readyPath === "string" && rawCfg.readyPath.trim()) {
        clean.readyPath = rawCfg.readyPath.trim();
      }
      if (typeof rawCfg.defaultModel === "string" && rawCfg.defaultModel.trim()) {
        clean.defaultModel = rawCfg.defaultModel.trim();
      }
      if (typeof rawCfg.apiKeyEnv === "string" && rawCfg.apiKeyEnv.trim()) {
        const keyName = rawCfg.apiKeyEnv.trim();
        if (!isValidKeyName(keyName)) {
          throw Object.assign(
            new Error(`Invalid apiKeyEnv '${keyName}' on '${id}' (expected UPPER_SNAKE_CASE)`),
            { status: 400 },
          );
        }
        clean.apiKeyEnv = keyName;
      } else if (rawCfg.apiKeyEnv === null) {
        clean.apiKeyEnv = null;
      }
      if (typeof rawCfg.fallbackApiKeyEnv === "string" && isValidKeyName(rawCfg.fallbackApiKeyEnv)) {
        clean.fallbackApiKeyEnv = rawCfg.fallbackApiKeyEnv.trim();
      }
      if (typeof rawCfg.sendModel === "boolean") clean.sendModel = rawCfg.sendModel;
      if (typeof rawCfg.supportsImages === "boolean") clean.supportsImages = rawCfg.supportsImages;
      if (typeof rawCfg.allowInsecureHttp === "boolean") {
        clean.allowInsecureHttp = rawCfg.allowInsecureHttp;
      }
      if (DATA_DESTINATIONS.includes(rawCfg.dataDestination)) {
        clean.dataDestination = rawCfg.dataDestination;
      }
      if (rawCfg.headers && typeof rawCfg.headers === "object" && !Array.isArray(rawCfg.headers)) {
        /** @type {Record<string, string>} */
        const headers = {};
        for (const [hk, hv] of Object.entries(rawCfg.headers)) {
          if (hk.trim() && typeof hv === "string" && hv.trim()) {
            headers[hk.trim()] = hv.trim();
          }
        }
        if (Object.keys(headers).length > 0) clean.headers = headers;
      }
      backends[id] = clean;
    }
  }

  return {
    version: 1,
    routingMode,
    defaultBackend:
      typeof body.defaultBackend === "string" && body.defaultBackend.trim()
        ? body.defaultBackend.trim()
        : "magpie",
    fallbackBackend:
      typeof body.fallbackBackend === "string" && body.fallbackBackend.trim()
        ? body.fallbackBackend.trim()
        : "local-opendecider",
    defaultModel:
      typeof body.defaultModel === "string" && body.defaultModel.trim()
        ? body.defaultModel.trim()
        : "google/gemini-decision-1",
    ...(typeof body.gatewayUrl === "string" && body.gatewayUrl.trim()
      ? { gatewayUrl: body.gatewayUrl.trim() }
      : {}),
    timeoutMs: posInt(body.timeoutMs, 25_000, 1_000, 55_000),
    primaryTimeoutMs: posInt(body.primaryTimeoutMs, 15_000, 1_000, 50_000),
    fallbackTimeoutMs: posInt(body.fallbackTimeoutMs, 10_000, 1_000, 30_000),
    fallbackOnNotConfigured: Boolean(body.fallbackOnNotConfigured),
    circuitBreaker: {
      failureThreshold: posInt(body.circuitBreaker?.failureThreshold, 2, 1, 10),
      cooldownMs: posInt(body.circuitBreaker?.cooldownMs, 30_000, 1_000, 300_000),
      maxCooldownMs: posInt(body.circuitBreaker?.maxCooldownMs, 120_000, 5_000, 600_000),
    },
    maxDataDestination,
    backends,
  };
}

/**
 * Create the standalone local Admin UI HTTP server (not yet listening).
 *
 * @param {{
 *   configPath?: string,
 *   secretsPath?: string,
 *   env?: Record<string, string | undefined>,
 *   magpieAvailable?: boolean,
 *   useKeychain?: boolean,
 *   fetchImpl?: typeof fetch,
 * }} [opts]
 */
export function createAdminServer(opts = {}) {
  const env = opts.env || process.env;
  const configPath = opts.configPath || getDefaultConfigPath(env);
  const secretsPath = opts.secretsPath || getDefaultSecretsPath(env);
  const useKeychain =
    opts.useKeychain !== undefined
      ? opts.useKeychain
      : process.platform === "darwin" && opts.env === undefined;
  const csrfToken = crypto.randomBytes(24).toString("hex");

  const secretResolver = createSecretResolver({ env, secretsPath, useKeychain });

  const getEffectiveConfig = () =>
    loadConfig({
      configPath,
      secretsPath,
      env,
      magpieAvailable: opts.magpieAvailable,
      secretResolver,
    });

  const getKeySummary = (cfg) =>
    collectKeyNames(cfg).map((name) => ({
      name,
      source: secretResolver.sourceOf(name),
    }));

  const buildTools = () => {
    const cfg = getEffectiveConfig();
    return createTools({
      config: cfg,
      configPath,
      secretsPath,
      env,
      fetchImpl: opts.fetchImpl,
      hotReload: false,
    });
  };

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = urlObj.pathname;
    const method = (req.method || "GET").toUpperCase();

    // Static UI assets
    if (method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      return sendFile(res, path.join(UI_DIR, "index.html"), "text/html; charset=utf-8");
    }
    if (method === "GET" && pathname === "/style.css") {
      return sendFile(res, path.join(UI_DIR, "style.css"), "text/css; charset=utf-8");
    }
    if (method === "GET" && pathname === "/app.js") {
      return sendFile(res, path.join(UI_DIR, "app.js"), "application/javascript; charset=utf-8");
    }
    if (method === "GET" && pathname === "/icon.png") {
      const pageIcon = path.join(REPO_ROOT, "page", "icon.png");
      const assetIcon = path.join(REPO_ROOT, "assets", "icon.png");
      return sendFile(res, fs.existsSync(pageIcon) ? pageIcon : assetIcon, "image/png");
    }

    // All /api/* routes enforce loopback Host + Origin check
    if (pathname.startsWith("/api/")) {
      if (!isLoopbackHostHeader(req.headers.host)) {
        return sendJson(res, 403, { error: "Forbidden host header" });
      }
      if (!isAllowedOrigin(req.headers.origin)) {
        return sendJson(res, 403, { error: "Forbidden cross-origin request" });
      }
      if (method !== "GET" && method !== "HEAD") {
        const provided = String(req.headers["x-csrf-token"] || "");
        if (!provided || provided !== csrfToken) {
          return sendJson(res, 403, { error: "Missing or invalid X-CSRF-Token" });
        }
      }

      try {
        if (method === "GET" && pathname === "/api/bootstrap") {
          secretResolver.clearCache();
          const cfg = getEffectiveConfig();
          return sendJson(res, 200, {
            csrfToken,
            version: PACKAGE_VERSION,
            platform: process.platform,
            keychainSupported: process.platform === "darwin",
            configPath,
            secretsPath,
            configFileExists: cfg.configFileExists,
            repoRoot: REPO_ROOT,
            stdioPath: path.join(REPO_ROOT, "bin", "stdio.mjs"),
            config: {
              version: cfg.version,
              routingMode: cfg.routingMode,
              defaultBackend: cfg.defaultBackend,
              fallbackBackend: cfg.fallbackBackend,
              defaultModel: cfg.defaultModel,
              maxDataDestination: cfg.maxDataDestination,
              fallbackOnNotConfigured: cfg.fallbackOnNotConfigured,
              timeoutMs: cfg.limits.timeoutMs,
              primaryTimeoutMs: cfg.limits.primaryTimeoutMs,
              fallbackTimeoutMs: cfg.limits.fallbackTimeoutMs,
              circuitBreaker: cfg.circuitBreaker,
              gatewayUrl: cfg.backends?.magpie?.gatewayUrl || "",
              backends: cfg.backends,
            },
            keys: getKeySummary(cfg),
            warnings: cfg.configWarnings || [],
          });
        }

        if (method === "GET" && pathname === "/api/status") {
          secretResolver.clearCache();
          const { tools } = buildTools();
          const st = await tools.status.execute({});
          return sendJson(res, 200, st);
        }

        if (method === "GET" && pathname === "/api/environment") {
          const envReport = await probeHostEnvironment({ env, fetchImpl: opts.fetchImpl });
          const rec = recommendModels(envReport);
          return sendJson(res, 200, { environment: envReport, recommendations: rec });
        }

        if (method === "PUT" && pathname === "/api/config") {
          const body = await readJsonBody(req);
          const sanitized = validateAndSanitizeConfigPatch(body);
          saveConfigFile(configPath, sanitized);
          secretResolver.clearCache();
          const reloaded = getEffectiveConfig();
          return sendJson(res, 200, {
            ok: true,
            configPath,
            config: {
              version: reloaded.version,
              routingMode: reloaded.routingMode,
              defaultBackend: reloaded.defaultBackend,
              fallbackBackend: reloaded.fallbackBackend,
              defaultModel: reloaded.defaultModel,
              maxDataDestination: reloaded.maxDataDestination,
              fallbackOnNotConfigured: reloaded.fallbackOnNotConfigured,
              timeoutMs: reloaded.limits.timeoutMs,
              primaryTimeoutMs: reloaded.limits.primaryTimeoutMs,
              fallbackTimeoutMs: reloaded.limits.fallbackTimeoutMs,
              circuitBreaker: reloaded.circuitBreaker,
              gatewayUrl: reloaded.backends?.magpie?.gatewayUrl || "",
              backends: reloaded.backends,
            },
            keys: getKeySummary(reloaded),
          });
        }

        if (method === "POST" && pathname === "/api/keys") {
          const body = await readJsonBody(req);
          const name = String(body.name || "").trim().toUpperCase();
          const value = String(body.value || "").trim();
          const store = body.store === "keychain" ? "keychain" : "file";
          if (!isValidKeyName(name)) {
            return sendJson(res, 400, { error: "Invalid key name (use UPPER_SNAKE_CASE, e.g. PERPLEXITY_API_KEY)" });
          }
          if (!value) {
            return sendJson(res, 400, { error: "Key value must not be empty" });
          }
          if (store === "keychain") {
            setKeychainSecret(name, value);
          } else {
            setFileSecret(name, value, secretsPath);
          }
          secretResolver.clearCache();
          const cfg = getEffectiveConfig();
          return sendJson(res, 200, { ok: true, name, store, keys: getKeySummary(cfg) });
        }

        if (method === "DELETE" && pathname.startsWith("/api/keys/")) {
          const name = decodeURIComponent(pathname.slice("/api/keys/".length)).trim().toUpperCase();
          if (!isValidKeyName(name)) {
            return sendJson(res, 400, { error: "Invalid key name" });
          }
          const removedFile = removeFileSecret(name, secretsPath);
          const removedKc = useKeychain ? removeKeychainSecret(name) : false;
          secretResolver.clearCache();
          const cfg = getEffectiveConfig();
          return sendJson(res, 200, {
            ok: true,
            removed: removedFile || removedKc,
            keys: getKeySummary(cfg),
          });
        }

        if (method === "POST" && pathname === "/api/test") {
          const body = await readJsonBody(req);
          const toolName = String(body.tool || "yes_no");
          const toolArgs = body.arguments && typeof body.arguments === "object" ? body.arguments : {};
          const { tools } = buildTools();
          if (!["yes_no", "choose", "score", "decide"].includes(toolName)) {
            return sendJson(res, 400, { error: `Unsupported test tool '${toolName}'` });
          }
          const result = await tools[toolName].execute(toolArgs, {
            agent: "admin-ui",
            directory: process.cwd(),
          });
          return sendJson(res, 200, { tool: toolName, result });
        }

        return sendJson(res, 404, { error: "Unknown API route" });
      } catch (err) {
        const status = typeof err?.status === "number" ? err.status : 500;
        return sendJson(res, status, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  return { server, csrfToken };
}

function openBrowser(url) {
  if (process.platform === "darwin") {
    execFile("open", [url], () => {});
  } else if (process.platform === "linux") {
    execFile("xdg-open", [url], () => {});
  } else if (process.platform === "win32") {
    execFile("cmd", ["/c", "start", "", url], () => {});
  }
}

/**
 * Start the standalone local Admin UI on 127.0.0.1 and keep running until Ctrl+C.
 * @param {{ port?: number, open?: boolean }} [opts]
 */
export async function startAdminServer(opts = {}) {
  const startPort = Number.isInteger(opts.port) && opts.port > 0 ? opts.port : 4395;
  const shouldOpen = opts.open !== false;
  const { server } = createAdminServer();

  let boundPort = null;
  for (let attempt = 0; attempt <= 10; attempt++) {
    const candidate = startPort + attempt;
    try {
      await new Promise((resolve, reject) => {
        const onErr = (err) => {
          server.off("listening", onListen);
          reject(err);
        };
        const onListen = () => {
          server.off("error", onErr);
          resolve();
        };
        server.once("error", onErr);
        server.once("listening", onListen);
        server.listen(candidate, "127.0.0.1");
      });
      boundPort = candidate;
      break;
    } catch (err) {
      if (err?.code !== "EADDRINUSE" || attempt === 10) throw err;
    }
  }

  const url = `http://127.0.0.1:${boundPort}`;
  console.log(`Light Decision MCP Admin UI listening at ${url}`);
  console.log(`Loopback-only (127.0.0.1) · CSRF-protected · Hot-reloads config.json & 0600 secrets.json`);
  console.log(`Press Ctrl+C to stop.`);

  if (shouldOpen) openBrowser(url);

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return { server, url, port: boundPort };
}
