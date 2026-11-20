/**
 * Optional direct cloud Decisions adapters (for environments without Magpie):
 * - google-direct: POST https://generativelanguage.googleapis.com/v1beta/decisions (gemini-decision-1)
 * - openai-direct: POST https://api.openai.com/v1/decisions (gpt-6-luna)
 */

import { DecisionError, ERROR_CODES } from "../core/errors.mjs";
import {
  assertSafeCredentialTransport,
  fetchJson,
  toGeminiDecisionsPayload,
  toOpenAIDecisionsPayload,
} from "./http.mjs";

/**
 * Create a direct Google Gemini Decisions API backend.
 * @param {object} cfg
 * @param {{ fetchImpl?: typeof fetch, env?: Record<string, string | undefined> }} [runtime]
 */
export function createGoogleDirectBackend(cfg, runtime = {}) {
  const id = cfg.id || "google-direct";
  const baseUrl = String(
    cfg.baseUrl || "https://generativelanguage.googleapis.com",
  ).replace(/\/+$/, "");
  const endpointPath = String(cfg.endpointPath || "/v1beta/decisions").replace(/^([^/])/, "/$1");
  const extraHeaders = cfg.headers && typeof cfg.headers === "object" ? cfg.headers : {};
  const defaultModel = cfg.defaultModel || "gemini-decision-1";
  const apiKeyEnv = cfg.apiKeyEnv || "GEMINI_API_KEY";
  const fallbackKeyEnv = cfg.fallbackApiKeyEnv || "GOOGLE_API_KEY";
  const dataDestination = cfg.dataDestination || "third-party";
  const env = runtime.env || process.env;
  const fetchImpl = runtime.fetchImpl || globalThis.fetch;

  function readApiKey() {
    const get = (k) => (runtime.secretResolver ? runtime.secretResolver.get(k) : env[k]);
    const primary = get(apiKeyEnv);
    if (typeof primary === "string" && primary.trim()) return primary.trim();
    const secondary = fallbackKeyEnv ? get(fallbackKeyEnv) : undefined;
    if (typeof secondary === "string" && secondary.trim()) return secondary.trim();
    return undefined;
  }

  return {
    id,
    type: "google-direct",
    defaultModel,

    getDataDestination() {
      return dataDestination;
    },

    supportsImages() {
      return true;
    },

    supportsWebGrounding() {
      return false;
    },

    async status() {
      const keyPresent = Boolean(readApiKey());
      return {
        id,
        type: "google-direct",
        reachable: keyPresent,
        ready: keyPresent,
        base_url: baseUrl,
        default_model: defaultModel,
        data_destination: dataDestination,
        capabilities: {
          images: true,
          web_grounding: false,
        },
        available_models: keyPresent ? [defaultModel] : [],
        ...(!keyPresent
          ? {
              setup_hint: `Set ${apiKeyEnv} (or ${fallbackKeyEnv}) for direct Google Gemini Decisions, or use Magpie gateway.`,
            }
          : {}),
      };
    },

    async decide(req) {
      const rawModel = req.model || defaultModel;
      const model = rawModel.replace(/^google\//i, "");
      const apiKey = readApiKey();
      if (!apiKey) {
        throw new DecisionError(
          ERROR_CODES.NOT_CONFIGURED,
          `Backend '${id}' requires environment variable ${apiKeyEnv} (or ${fallbackKeyEnv})`,
          {
            backend: id,
            model,
            hint: `Export ${apiKeyEnv}=<your_key> or route via Magpie ('magpie provider add google <API_KEY>').`,
          },
        );
      }

      const endpoint = `${baseUrl}${endpointPath}`;
      assertSafeCredentialTransport(endpoint, apiKey, cfg.allowInsecureHttp === true);

      const body = toGeminiDecisionsPayload({
        model,
        state: req.state,
        questions: req.questions,
        images: req.images,
      });

      const res = await fetchJson({
        url: endpoint,
        method: "POST",
        headers: {
          ...extraHeaders,
          "x-goog-api-key": apiKey,
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

/**
 * Create a direct OpenAI Decisions API backend (`POST /v1/decisions`).
 * @param {object} cfg
 * @param {{ fetchImpl?: typeof fetch, env?: Record<string, string | undefined> }} [runtime]
 */
export function createOpenAIDirectBackend(cfg, runtime = {}) {
  const id = cfg.id || "openai-direct";
  const baseUrl = String(cfg.baseUrl || "https://api.openai.com").replace(/\/+$/, "");
  const endpointPath = String(cfg.endpointPath || "/v1/decisions").replace(/^([^/])/, "/$1");
  const extraHeaders = cfg.headers && typeof cfg.headers === "object" ? cfg.headers : {};
  const supportsImagesFlag = cfg.supportsImages !== false;
  const stripProviderPrefix = cfg.stripProviderPrefix !== false;
  const defaultModel = cfg.defaultModel || "gpt-6-luna";
  const apiKeyEnv = cfg.apiKeyEnv === null ? null : cfg.apiKeyEnv || "OPENAI_API_KEY";
  const dataDestination = cfg.dataDestination || "third-party";
  const env = runtime.env || process.env;
  const fetchImpl = runtime.fetchImpl || globalThis.fetch;

  function readApiKey() {
    const val = runtime.secretResolver ? runtime.secretResolver.get(apiKeyEnv) : env[apiKeyEnv];
    return typeof val === "string" && val.trim() ? val.trim() : undefined;
  }

  return {
    id,
    type: "openai-direct",
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

    async status() {
      const keyPresent = !apiKeyEnv || Boolean(readApiKey());
      return {
        id,
        type: cfg.type || "openai-direct",
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
    },

    async decide(req) {
      const rawModel = req.model || defaultModel;
      const model = stripProviderPrefix ? rawModel.replace(/^openai\//i, "") : rawModel;
      if (Array.isArray(req.images) && req.images.length > 0 && !supportsImagesFlag) {
        throw new DecisionError(
          ERROR_CODES.IMAGES_UNSUPPORTED,
          `Backend '${id}' does not support image inputs`,
          { backend: id, model },
        );
      }
      const apiKey = apiKeyEnv ? readApiKey() : undefined;
      if (apiKeyEnv && !apiKey) {
        throw new DecisionError(
          ERROR_CODES.NOT_CONFIGURED,
          `Backend '${id}' requires environment variable ${apiKeyEnv}`,
          {
            backend: id,
            model,
            hint: `Export ${apiKeyEnv}=<your_key> or store it via 'light-decision-mcp key set ${apiKeyEnv}'.`,
          },
        );
      }

      const endpoint = `${baseUrl}${endpointPath}`;
      assertSafeCredentialTransport(endpoint, apiKey, cfg.allowInsecureHttp === true);

      const body = toOpenAIDecisionsPayload({
        model,
        state: req.state,
        questions: req.questions,
        images: req.images,
      });

      const res = await fetchJson({
        url: endpoint,
        method: "POST",
        headers: {
          ...extraHeaders,
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
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
