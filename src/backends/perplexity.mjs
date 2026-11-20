/**
 * Direct Perplexity Decisions API adapter (`POST https://api.perplexity.ai/v1/decisions`).
 *
 * Supports `pplx-decider-v1.3`, `pplx-decider-flash-v1.3`, and optional
 * `mode: "web_grounding"` for live web-grounded decisions.
 */

import { DecisionError, ERROR_CODES } from "../core/errors.mjs";
import {
  assertSafeCredentialTransport,
  fetchJson,
  toSystemOneQuestions,
} from "./http.mjs";

const DEFAULT_MODELS = ["pplx-decider-v1.3", "pplx-decider-flash-v1.3"];

/**
 * @param {object} cfg
 * @param {{ fetchImpl?: typeof fetch, env?: Record<string, string | undefined> }} [runtime]
 */
export function createPerplexityBackend(cfg, runtime = {}) {
  const id = cfg.id || "perplexity";
  const baseUrl = String(cfg.baseUrl || "https://api.perplexity.ai").replace(/\/+$/, "");
  const endpointPath = String(cfg.endpointPath || "/v1/decisions").replace(/^([^/])/, "/$1");
  const extraHeaders = cfg.headers && typeof cfg.headers === "object" ? cfg.headers : {};
  const defaultModel = cfg.defaultModel || "pplx-decider-v1.3";
  const apiKeyEnv = cfg.apiKeyEnv || "PERPLEXITY_API_KEY";
  const dataDestination = cfg.dataDestination || "third-party";
  const env = runtime.env || process.env;
  const fetchImpl = runtime.fetchImpl || globalThis.fetch;

  function readApiKey() {
    const val = runtime.secretResolver ? runtime.secretResolver.get(apiKeyEnv) : env[apiKeyEnv];
    return typeof val === "string" && val.trim() ? val.trim() : undefined;
  }

  return {
    id,
    type: "perplexity",
    defaultModel,

    getDataDestination() {
      return dataDestination;
    },

    supportsImages() {
      return false;
    },

    supportsWebGrounding() {
      return true;
    },

    async status() {
      const keyPresent = Boolean(readApiKey());
      return {
        id,
        type: "perplexity",
        reachable: keyPresent,
        ready: keyPresent,
        base_url: baseUrl,
        default_model: defaultModel,
        data_destination: dataDestination,
        capabilities: {
          images: false,
          web_grounding: true,
        },
        available_models: keyPresent ? [...new Set([defaultModel, ...DEFAULT_MODELS])] : [],
        ...(!keyPresent
          ? { setup_hint: `Set environment variable ${apiKeyEnv} to enable Perplexity Decisions API.` }
          : {}),
      };
    },

    async decide(req) {
      const model = req.model || defaultModel;
      if (Array.isArray(req.images) && req.images.length > 0) {
        throw new DecisionError(
          ERROR_CODES.IMAGES_UNSUPPORTED,
          `Backend '${id}' does not accept image inputs in V1`,
          { backend: id, model },
        );
      }

      const apiKey = readApiKey();
      if (!apiKey) {
        throw new DecisionError(
          ERROR_CODES.NOT_CONFIGURED,
          `Backend '${id}' requires environment variable ${apiKeyEnv}`,
          {
            backend: id,
            model,
            hint: `Export ${apiKeyEnv}=<your_key> or run 'light-decision-mcp setup'.`,
          },
        );
      }

      const endpoint = `${baseUrl}${endpointPath}`;
      assertSafeCredentialTransport(endpoint, apiKey, cfg.allowInsecureHttp === true);

      /** @type {Record<string, any>} */
      const body = {
        model,
        state: req.state,
        questions: toSystemOneQuestions(req.questions),
      };
      if (req.webGrounding === true) {
        body.mode = "web_grounding";
      }

      const res = await fetchJson({
        url: endpoint,
        method: "POST",
        headers: {
          ...extraHeaders,
          Authorization: `Bearer ${apiKey}`,
        },
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
