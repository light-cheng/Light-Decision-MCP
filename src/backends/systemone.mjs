/**
 * Universal System One HTTP backend adapter (`POST <baseUrl>/v1/systemone`).
 *
 * Covers:
 * - Local `opendecider serve` (e.g. http://127.0.0.1:8001, `sendModel: false`, GET /ready)
 * - Direct TypeSafe Jev API (https://api.typesafe.ai, `apiKeyEnv: "TYPESAFE_API_KEY"`)
 * - Self-hosted private-network System One servers
 */

import { DecisionError, ERROR_CODES } from "../core/errors.mjs";
import {
  assertSafeCredentialTransport,
  fetchJson,
  isLoopbackUrl,
  toSystemOneQuestions,
} from "./http.mjs";

/**
 * Derive default data destination for a System One endpoint.
 * @param {object} cfg
 * @returns {"on-device" | "private-network" | "third-party"}
 */
function resolveDestination(cfg) {
  if (cfg.dataDestination) return cfg.dataDestination;
  if (cfg.baseUrl && isLoopbackUrl(cfg.baseUrl)) return "on-device";
  return "third-party";
}

/**
 * @param {object} cfg
 * @param {{ fetchImpl?: typeof fetch, env?: Record<string, string | undefined> }} [runtime]
 */
export function createSystemOneBackend(cfg, runtime = {}) {
  const id = cfg.id || "systemone";
  const baseUrl = String(cfg.baseUrl || "http://127.0.0.1:8001").replace(/\/+$/, "");
  const endpointPath = String(cfg.endpointPath || "/v1/systemone").replace(/^([^/])/, "/$1");
  const readyPath = String(cfg.readyPath || "/ready").replace(/^([^/])/, "/$1");
  const extraHeaders = cfg.headers && typeof cfg.headers === "object" ? cfg.headers : {};
  const sendModel = cfg.sendModel !== false;
  const defaultModel = cfg.defaultModel || (sendModel ? "jev-latest" : "local-opendecider");
  const apiKeyEnv = cfg.apiKeyEnv || null;
  const dataDestination = resolveDestination({ ...cfg, baseUrl });
  const supportsImagesFlag = cfg.supportsImages === true;
  const env = runtime.env || process.env;
  const fetchImpl = runtime.fetchImpl || globalThis.fetch;

  function readApiKey() {
    if (!apiKeyEnv) return undefined;
    const val = runtime.secretResolver ? runtime.secretResolver.get(apiKeyEnv) : env[apiKeyEnv];
    return typeof val === "string" && val.trim() ? val.trim() : undefined;
  }

  return {
    id,
    type: "systemone",
    defaultModel,

    getDataDestination() {
      return dataDestination;
    },

    supportsImages() {
      return supportsImagesFlag;
    },

    supportsWebGrounding() {
      return false;
    },

    async status({ timeoutMs = 3_000, callerSignal } = {}) {
      // Cloud/keyed System One endpoints (like TypeSafe Jev): verify config & env key without billable call
      if (apiKeyEnv && !isLoopbackUrl(baseUrl)) {
        const keyPresent = Boolean(readApiKey());
        return {
          id,
          type: "systemone",
          reachable: keyPresent,
          ready: keyPresent,
          base_url: baseUrl,
          default_model: defaultModel,
          data_destination: dataDestination,
          capabilities: {
            images: supportsImagesFlag,
            web_grounding: false,
          },
          available_models: keyPresent ? [defaultModel] : [],
          ...(!keyPresent
            ? { setup_hint: `Set environment variable ${apiKeyEnv} to enable '${id}'.` }
            : {}),
        };
      }

      // Loopback / self-hosted System One server: check /ready (read-only)
      try {
        const { data } = await fetchJson({
          url: `${baseUrl}${readyPath}`,
          method: "GET",
          headers: extraHeaders,
          timeoutMs,
          callerSignal,
          fetchImpl,
          backendId: id,
        });
        const ready = data?.ready === true || data?.status === "ok" || data?.ok === true;
        const reportedModel =
          typeof data?.model === "string" && data.model.trim() ? data.model.trim() : defaultModel;
        return {
          id,
          type: "systemone",
          reachable: true,
          ready,
          base_url: baseUrl,
          default_model: reportedModel,
          data_destination: dataDestination,
          capabilities: {
            images: supportsImagesFlag,
            web_grounding: false,
          },
          available_models: ready ? [reportedModel] : [],
          ...(!ready
            ? { setup_hint: `Backend '${id}' at ${baseUrl} responded to /ready with ready=false.` }
            : {}),
        };
      } catch (err) {
        return {
          id,
          type: "systemone",
          reachable: false,
          ready: false,
          base_url: baseUrl,
          default_model: defaultModel,
          data_destination: dataDestination,
          capabilities: {
            images: supportsImagesFlag,
            web_grounding: false,
          },
          available_models: [],
          error: err instanceof Error ? err.message : String(err),
          setup_hint: isLoopbackUrl(baseUrl)
            ? "Start local opendecider server or run 'light-decision-mcp setup' to install & configure a local model."
            : `Ensure System One server '${id}' is reachable at ${baseUrl}.`,
        };
      }
    },

    async decide(req) {
      const hasImages = Array.isArray(req.images) && req.images.length > 0;
      if (hasImages && !supportsImagesFlag) {
        throw new DecisionError(
          ERROR_CODES.IMAGES_UNSUPPORTED,
          `Backend '${id}' does not support image inputs`,
          { backend: id, model: req.model || defaultModel },
        );
      }

      const apiKey = readApiKey();
      if (apiKeyEnv && !apiKey) {
        throw new DecisionError(
          ERROR_CODES.NOT_CONFIGURED,
          `Backend '${id}' requires environment variable ${apiKeyEnv}`,
          {
            backend: id,
            model: req.model || defaultModel,
            hint: `Export ${apiKeyEnv}=<your_key> or run 'light-decision-mcp setup'.`,
          },
        );
      }

      const endpoint = `${baseUrl}${endpointPath}`;
      assertSafeCredentialTransport(endpoint, apiKey, cfg.allowInsecureHttp === true);

      const headers = { ...extraHeaders };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      if (hasImages && cfg.imagesHeader) {
        headers[cfg.imagesHeader] = "true";
      }

      const model = req.model || defaultModel;
      /** @type {Record<string, any>} */
      const body = {
        state: req.state,
        questions: toSystemOneQuestions(req.questions),
      };
      if (sendModel) {
        body.model = model;
      }

      const res = await fetchJson({
        url: endpoint,
        method: "POST",
        headers,
        body,
        timeoutMs: req.timeoutMs,
        callerSignal: req.callerSignal,
        fetchImpl,
        backendId: id,
        model,
      });

      return {
        raw: res.data,
        model: (typeof res.data?.model === "string" && res.data.model) || model,
        dataDestination,
        latencyMs: res.latencyMs,
      };
    },
  };
}
