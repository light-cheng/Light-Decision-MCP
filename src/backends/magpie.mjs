/**
 * Local Magpie gateway backend adapter.
 *
 * - Dynamically discovers local gateway URL from `<magpieDir>/gateway.json` (`addr`).
 * - Stores ZERO API keys; inherits Magpie's provider credentials, rotation, quotas,
 *   and privacy redaction (`redact` / `redactPersonal`).
 * - Routes text-only requests via POST /v1/systemone and image requests via
 *   POST /v1/decisions (input_image) for image-capable decision models
 *   (google/gemini-decision-1, Cloudflare Clef, openai/gpt-6-luna).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DecisionError, ERROR_CODES } from "../core/errors.mjs";
import { fetchJson, toOpenAIDecisionsPayload, toSystemOneQuestions } from "./http.mjs";

const LOCAL_MODEL_PREFIXES = ["ollama/", "mlx-serve/", "omlx/", "local/"];
const KNOWN_DECISION_PATTERNS = [
  /gemini-decision/i,
  /gpt-6-luna/i,
  /\bjev\b/i,
  /\bclef\b/i,
  /decision-model/i,
  /opendecider/i,
  /pplx-decider/i,
];

/**
 * Resolve Magpie gateway base URL dynamically.
 * @param {{ baseUrl?: string, gatewayUrl?: string, magpieDir?: string, env?: Record<string, string | undefined> }} cfg
 * @returns {string}
 */
export function resolveMagpieBaseUrl(cfg = {}) {
  const env = cfg.env || process.env;
  const explicit = (cfg.baseUrl || cfg.gatewayUrl || env.MAGPIE_GATEWAY || "").trim();
  if (explicit) {
    return normalizeBaseUrl(explicit);
  }

  const magpieDir = cfg.magpieDir || env.MAGPIE_DIR || path.join(os.homedir(), ".config", "magpie");
  const gatewayFile = path.join(magpieDir, "gateway.json");
  try {
    const raw = fs.readFileSync(gatewayFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.addr === "string" && parsed.addr.trim()) {
      return normalizeBaseUrl(parsed.addr.trim());
    }
  } catch {
    // Fallback to default local Magpie port if gateway.json is absent/unreadable
  }
  return "http://127.0.0.1:3425";
}

function normalizeBaseUrl(raw) {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

/**
 * Derive data destination from a Magpie provider/model id.
 * @param {string} model
 * @returns {"on-device" | "third-party"}
 */
export function deriveMagpieDestination(model) {
  const m = (model || "").toLowerCase();
  if (LOCAL_MODEL_PREFIXES.some((p) => m.startsWith(p))) return "on-device";
  return "third-party";
}

/**
 * Determine whether a Magpie model id supports image inputs on Decisions / System One.
 * Verified against Magpie gateway: Google gemini-decision-1, Cloudflare Clef, and OpenAI gpt-6-luna.
 * @param {string} model
 * @returns {boolean}
 */
export function magpieModelSupportsImages(model) {
  const m = (model || "").toLowerCase();
  return (
    m.includes("gemini-decision") ||
    m.includes("clef") ||
    m.includes("gpt-6-luna")
  );
}

/**
 * Filter /v1/models payload to decision-capable models.
 * @param {any} modelsPayload
 * @returns {Array<{ id: string, display_name?: string, data_destination: string, supports_images: boolean }>}
 */
export function extractDecisionModels(modelsPayload) {
  const list = Array.isArray(modelsPayload?.data) ? modelsPayload.data : [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item.id !== "string") continue;
    const endpoints = Array.isArray(item.native_endpoints) ? item.native_endpoints : [];
    const outputMods = Array.isArray(item.modalities?.output) ? item.modalities.output : [];
    const isDecision =
      endpoints.includes("/v1/systemone") ||
      endpoints.includes("/v1/decisions") ||
      outputMods.includes("decisions") ||
      item.decides === true ||
      KNOWN_DECISION_PATTERNS.some((re) => re.test(item.id));
    if (!isDecision) continue;
    out.push({
      id: item.id,
      ...(typeof item.display_name === "string" ? { display_name: item.display_name } : {}),
      data_destination: deriveMagpieDestination(item.id),
      supports_images:
        magpieModelSupportsImages(item.id) ||
        (Array.isArray(item.modalities?.input) && item.modalities.input.includes("image")),
    });
  }
  return out;
}

/**
 * Build a helpful setup hint when a model/provider is missing in Magpie.
 * @param {string} model
 */
function magpieSetupHint(model) {
  const lower = (model || "").toLowerCase();
  if (lower.startsWith("google/") || lower.includes("gemini-decision")) {
    return "Add your Google AI Studio key in Magpie: magpie provider add google <API_KEY>";
  }
  if (lower.startsWith("typesafe/")) {
    return "Add TypeSafe Jev in Magpie: magpie provider add typesafe <API_KEY>";
  }
  if (lower.startsWith("openai/")) {
    return "Add OpenAI in Magpie: magpie provider add openai <API_KEY>";
  }
  return `Configure the provider for '${model}' in Magpie (run 'magpie presets' to see available vendors).`;
}

/**
 * Create a Magpie gateway backend instance.
 * @param {object} cfg
 * @param {{ fetchImpl?: typeof fetch, env?: Record<string, string | undefined>, magpieDir?: string }} [runtime]
 */
export function createMagpieBackend(cfg, runtime = {}) {
  const id = cfg.id || "magpie";
  const defaultModel = cfg.defaultModel || "google/gemini-decision-1";
  const env = runtime.env || process.env;
  const fetchImpl = runtime.fetchImpl || globalThis.fetch;

  function getBaseUrl() {
    return resolveMagpieBaseUrl({
      baseUrl: cfg.baseUrl,
      gatewayUrl: cfg.gatewayUrl,
      magpieDir: cfg.magpieDir || runtime.magpieDir,
      env,
    });
  }

  function getHeaders() {
    const headers = {};
    const keyEnv = cfg.apiKeyEnv;
    const token = keyEnv
      ? runtime.secretResolver
        ? runtime.secretResolver.get(keyEnv)
        : env[keyEnv]
      : undefined;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  return {
    id,
    type: "magpie",
    defaultModel,

    getDataDestination(model) {
      return deriveMagpieDestination(model || defaultModel);
    },

    supportsImages(model) {
      return magpieModelSupportsImages(model || defaultModel);
    },

    supportsWebGrounding() {
      return false;
    },

    async status({ timeoutMs = 4_000, callerSignal } = {}) {
      const baseUrl = getBaseUrl();
      try {
        const { data } = await fetchJson({
          url: `${baseUrl}/v1/models`,
          method: "GET",
          headers: getHeaders(),
          timeoutMs,
          callerSignal,
          fetchImpl,
          backendId: id,
          isGateway: true,
        });
        const models = extractDecisionModels(data);
        let hasDefault = models.some((m) => m.id === defaultModel);

        // Magpie omits decision-only models (e.g. google/gemini-decision-1) from the
        // default chat `/v1/models` list. Verify defaultModel with a zero-cost local
        // validation probe against POST /v1/decisions (validated inside Magpie before
        // any upstream API call: 400 missing "input"/"questions" => model is registered).
        if (!hasDefault && defaultModel) {
          try {
            await fetchJson({
              url: `${baseUrl}/v1/decisions`,
              method: "POST",
              headers: getHeaders(),
              body: { model: defaultModel },
              timeoutMs: Math.min(timeoutMs, 2_500),
              callerSignal,
              fetchImpl,
              backendId: id,
              model: defaultModel,
              isGateway: true,
            });
            hasDefault = true;
          } catch (probeErr) {
            if (
              probeErr instanceof DecisionError &&
              probeErr.status === 400 &&
              /"input"|input.*neither|questions/i.test(probeErr.message || "") &&
              !/can't serve/i.test(probeErr.message || "")
            ) {
              hasDefault = true;
            }
          }
        }

        const modelIds = hasDefault && !models.some((m) => m.id === defaultModel)
          ? [defaultModel, ...models.map((m) => m.id)]
          : models.map((m) => m.id);
        const ready = hasDefault || modelIds.length > 0;
        const anyImages = models.some((m) => m.supports_images) || magpieModelSupportsImages(defaultModel);
        return {
          id,
          type: "magpie",
          reachable: true,
          ready,
          gateway_url: baseUrl,
          default_model: defaultModel,
          default_model_available: hasDefault,
          data_destination: deriveMagpieDestination(defaultModel),
          capabilities: {
            images: anyImages,
            web_grounding: false,
          },
          available_models: modelIds,
          ...(!hasDefault
            ? {
                setup_hint: magpieSetupHint(defaultModel),
              }
            : {}),
        };
      } catch (err) {
        return {
          id,
          type: "magpie",
          reachable: false,
          ready: false,
          gateway_url: baseUrl,
          default_model: defaultModel,
          default_model_available: false,
          data_destination: deriveMagpieDestination(defaultModel),
          capabilities: {
            images: magpieModelSupportsImages(defaultModel),
            web_grounding: false,
          },
          available_models: [],
          error: err instanceof Error ? err.message : String(err),
          setup_hint: "Start Magpie or set MAGPIE_GATEWAY / gatewayUrl to a running gateway.",
        };
      }
    },

    async decide(req) {
      const model = req.model || defaultModel;
      const baseUrl = getBaseUrl();
      const hasImages = Array.isArray(req.images) && req.images.length > 0;

      if (hasImages && !magpieModelSupportsImages(model)) {
        throw new DecisionError(
          ERROR_CODES.IMAGES_UNSUPPORTED,
          `Magpie model '${model}' does not support image inputs (supported: google/gemini-decision-1, Cloudflare Clef, openai/gpt-6-luna)`,
          { backend: id, model },
        );
      }

      const useDecisionsEndpoint = hasImages || cfg.protocol === "decisions";
      const url = useDecisionsEndpoint ? `${baseUrl}/v1/decisions` : `${baseUrl}/v1/systemone`;
      const body = useDecisionsEndpoint
        ? toOpenAIDecisionsPayload({
            model,
            state: req.state,
            questions: req.questions,
            images: req.images,
          })
        : {
            model,
            state: req.state,
            questions: toSystemOneQuestions(req.questions),
          };

      try {
        const res = await fetchJson({
          url,
          method: "POST",
          headers: getHeaders(),
          body,
          timeoutMs: req.timeoutMs,
          callerSignal: req.callerSignal,
          fetchImpl,
          backendId: id,
          model,
          isGateway: true,
        });
        return {
          raw: res.data,
          model,
          dataDestination: deriveMagpieDestination(model),
          latencyMs: res.latencyMs,
        };
      } catch (err) {
        if (err instanceof DecisionError && err.status === 404) {
          const msg = err.message || "";
          const isUnconfigured =
            /has no Jev provider/i.test(msg) || /knows no model/i.test(msg);
          throw new DecisionError(
            isUnconfigured ? ERROR_CODES.NOT_CONFIGURED : ERROR_CODES.MODEL_NOT_FOUND,
            msg,
            {
              backend: id,
              model,
              status: err.status,
              hint: magpieSetupHint(model),
              cause: err,
            },
          );
        }
        throw err;
      }
    },
  };
}
