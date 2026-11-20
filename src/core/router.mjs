/**
 * Multi-backend router:
 * - Instantiates enabled backend adapters (magpie, systemone, perplexity, google-direct, openai-direct)
 * - Enforces routing modes: api_only, local_only, api_with_local_fallback
 * - Enforces hard data_destination boundaries (never silently escalates local -> cloud)
 * - Integrates per-backend CircuitBreaker for 0ms primary skip & instant local fallback
 * - Enforces multimodal safety gate (never silently drops images on local fallback unless opted in)
 * - Executes bounded-concurrency batches with mid-batch circuit-aware fallback
 */

import { createGoogleDirectBackend, createOpenAIDirectBackend } from "../backends/direct-cloud.mjs";
import { createMagpieBackend } from "../backends/magpie.mjs";
import { createPerplexityBackend } from "../backends/perplexity.mjs";
import { createSystemOneBackend } from "../backends/systemone.mjs";
import { CircuitBreakerRegistry } from "./circuit-breaker.mjs";
import { DecisionError, ERROR_CODES, isAvailabilityFailure } from "./errors.mjs";
import { loadImages } from "./images.mjs";
import { normalizeDecisionResponse } from "./normalize.mjs";
import { exceedsDataDestination } from "./schema.mjs";

export const PACKAGE_VERSION = "0.1.0";

const WIRE_QUESTION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Upstream engines such as Google gemini-decision-1 require every question ID
 * to match /^[A-Za-z0-9_-]{1,64}$/. Transparently alias any non-matching caller
 * keys on the wire and restore the original keys after normalization.
 *
 * @param {Record<string, any>} questions
 */
function prepareWireQuestions(questions) {
  /** @type {Record<string, any>} */
  const wireQuestions = {};
  /** @type {Map<string, string>} */
  const wireToOriginal = new Map();
  const used = new Set(Object.keys(questions).filter((k) => WIRE_QUESTION_ID_RE.test(k)));

  let seq = 0;
  for (const [origKey, qDef] of Object.entries(questions)) {
    let wireKey = origKey;
    if (!WIRE_QUESTION_ID_RE.test(wireKey)) {
      do {
        wireKey = `q_${seq++}`;
      } while (used.has(wireKey));
      used.add(wireKey);
    }
    wireQuestions[wireKey] = qDef;
    wireToOriginal.set(wireKey, origKey);
  }
  return { wireQuestions, wireToOriginal };
}

function restoreAnswerKeys(normalized, wireToOriginal) {
  /** @type {Record<string, any>} */
  const answers = {};
  for (const [wireKey, ans] of Object.entries(normalized.answers)) {
    const origKey = wireToOriginal.get(wireKey) ?? wireKey;
    answers[origKey] = ans;
  }
  return { ...normalized, answers };
}

function instantiateBackend(cfg, runtime) {
  switch (cfg.type) {
    case "magpie":
      return createMagpieBackend(cfg, runtime);
    case "systemone":
      return createSystemOneBackend(cfg, runtime);
    case "perplexity":
      return createPerplexityBackend(cfg, runtime);
    case "google-direct":
    case "gemini-decisions":
      return createGoogleDirectBackend(cfg, runtime);
    case "openai-direct":
      return createOpenAIDirectBackend(cfg, runtime);
    case "openai-decisions":
    case "decisions-gateway":
      return createOpenAIDirectBackend(
        { stripProviderPrefix: false, ...cfg },
        runtime,
      );
    default:
      return null;
  }
}

export class DecisionRouter {
  /**
   * @param {ReturnType<import("../config/load.mjs").loadConfig>} config
   * @param {{ fetchImpl?: typeof fetch, env?: Record<string, string | undefined>, magpieDir?: string, now?: () => number, secretResolver?: any, circuit?: CircuitBreakerRegistry }} [runtime]
   */
  constructor(config, runtime = {}) {
    this.config = config;
    this.runtime = runtime;
    this.circuit =
      runtime.circuit ||
      new CircuitBreakerRegistry({
        ...config.circuitBreaker,
        now: runtime.now,
      });
    /** @type {Map<string, any>} */
    this.backends = new Map();

    for (const [id, bCfg] of Object.entries(config.backends || {})) {
      if (!bCfg || bCfg.enabled === false) continue;
      const inst = instantiateBackend({ ...bCfg, id }, runtime);
      if (inst) this.backends.set(id, inst);
    }
  }

  /**
   * Find the first enabled on-device backend (preferring configured fallbackBackend / defaultBackend).
   */
  _findLocalBackend(preferredId) {
    const candidates = [
      preferredId,
      this.config.fallbackBackend,
      this.config.defaultBackend,
      ...this.backends.keys(),
    ].filter(Boolean);

    const seen = new Set();
    for (const id of candidates) {
      if (seen.has(id)) continue;
      seen.add(id);
      const b = this.backends.get(id);
      if (!b) continue;
      if (b.getDataDestination(b.defaultModel) === "on-device") {
        return b;
      }
    }
    return null;
  }

  /**
   * Resolve primary backend, optional local fallback backend, effective mode, and data limit.
   * @param {{ mode?: string, backend?: string, model?: string, maxDataDestination?: string }} opts
   */
  resolveRoute(opts = {}) {
    const effectiveMode = opts.mode || this.config.routingMode;
    let maxDest = opts.maxDataDestination || this.config.maxDataDestination;

    if (effectiveMode === "local_only") {
      maxDest = "on-device";
    }

    let primary;
    let fallback = null;

    if (opts.backend) {
      primary = this.backends.get(opts.backend);
      if (!primary) {
        throw new DecisionError(
          ERROR_CODES.BACKEND_NOT_FOUND,
          `unknown or disabled backend '${opts.backend}' (enabled: ${[...this.backends.keys()].join(", ") || "none"})`,
          {
            backend: opts.backend,
            hint: "Run the 'status' tool to inspect available backends, or configure it in ~/.config/light-decision-mcp/config.json.",
          },
        );
      }
      // Explicit backend only uses fallback if caller also explicitly requested api_with_local_fallback
      if (opts.mode === "api_with_local_fallback") {
        const local = this._findLocalBackend(this.config.fallbackBackend);
        if (local && local.id !== primary.id) fallback = local;
      }
    } else if (effectiveMode === "local_only") {
      primary = this._findLocalBackend(this.config.fallbackBackend);
      if (!primary) {
        throw new DecisionError(
          ERROR_CODES.NOT_CONFIGURED,
          "no enabled on-device local backend found for local_only mode",
          {
            hint: "Run 'light-decision-mcp setup' to install and start a local decision model (e.g. opendecider).",
          },
        );
      }
    } else {
      primary = this.backends.get(this.config.defaultBackend);
      if (!primary) {
        throw new DecisionError(
          ERROR_CODES.BACKEND_NOT_FOUND,
          `default backend '${this.config.defaultBackend}' is not enabled`,
          { hint: "Run 'light-decision-mcp doctor' or check ~/.config/light-decision-mcp/config.json." },
        );
      }
      if (effectiveMode === "api_with_local_fallback") {
        const local = this._findLocalBackend(this.config.fallbackBackend);
        if (local && local.id !== primary.id) fallback = local;
      }
    }

    const primaryModel = opts.model || primary.defaultModel;
    const primaryDest = primary.getDataDestination(primaryModel);

    if (exceedsDataDestination(primaryDest, maxDest)) {
      throw new DecisionError(
        ERROR_CODES.DATA_BOUNDARY_EXCEEDED,
        `backend '${primary.id}' (model '${primaryModel}') sends data to '${primaryDest}', which exceeds max_data_destination '${maxDest}'`,
        {
          backend: primary.id,
          model: primaryModel,
          hint:
            maxDest === "on-device"
              ? "Switch to mode: 'local_only' or backend: 'local-opendecider' to keep data on-device."
              : `Raise max_data_destination to '${primaryDest}' or choose a nearer backend.`,
        },
      );
    }

    if (fallback) {
      const fbDest = fallback.getDataDestination(fallback.defaultModel);
      if (exceedsDataDestination(fbDest, maxDest)) {
        fallback = null;
      }
    }

    return {
      mode: effectiveMode,
      maxDataDestination: maxDest,
      primary,
      primaryModel,
      primaryDest,
      fallback,
    };
  }

  /**
   * Execute a single multi-question decision request with circuit breaker & optional local fallback.
   *
   * @param {{
   *   state: any,
   *   questions: Record<string, any>,
   *   images?: string[],
   *   loadedImages?: Array<any>,
   *   mode?: string,
   *   backend?: string,
   *   model?: string,
   *   maxDataDestination?: string,
   *   webGrounding?: boolean,
   *   allowImageDropOnFallback?: boolean,
   * }} req
   * @param {{ abort?: AbortSignal, directory?: string }} [ctx]
   */
  async decide(req, ctx = {}) {
    const route = this.resolveRoute(req);
    const loadedImages =
      req.loadedImages !== undefined
        ? req.loadedImages
        : await loadImages(req.images || [], {
            baseDir: ctx.directory || process.cwd(),
            maxImages: this.config.limits.images,
            maxBytes: this.config.limits.imageMaxBytes,
          });

    const hasImages = loadedImages.length > 0;
    const { primary, primaryModel, fallback } = route;
    const { wireQuestions, wireToOriginal } = prepareWireQuestions(req.questions);
    const wireReq = { ...req, questions: wireQuestions };

    /** @type {string[]} */
    const warnings = [];
    if (req.webGrounding && !primary.supportsWebGrounding(primaryModel)) {
      warnings.push(
        `web_grounding requested but backend '${primary.id}' does not support web grounding; proceeding without web grounding`,
      );
    }

    const canUseFallback = Boolean(fallback);
    const primaryTimeoutMs = canUseFallback
      ? Math.min(this.config.limits.primaryTimeoutMs, this.config.limits.timeoutMs)
      : this.config.limits.timeoutMs;
    const fallbackTimeoutMs = Math.min(
      this.config.limits.fallbackTimeoutMs,
      this.config.limits.timeoutMs,
    );

    // 1. Check primary circuit breaker before spending latency
    const gate = this.circuit.beforeCall(primary.id);
    if (!gate.allowed) {
      const circuitErr = new DecisionError(
        ERROR_CODES.CIRCUIT_OPEN,
        `backend '${primary.id}' circuit is ${gate.state} (${gate.remainingMs}ms remaining until probe)`,
        {
          backend: primary.id,
          model: primaryModel,
          status: gate.lastError?.status,
          hint: canUseFallback
            ? `Routing skipped open primary '${primary.id}'.`
            : "Wait for circuit cooldown or switch to a local backend.",
        },
      );
      if (!canUseFallback) throw circuitErr;
      const fbNormalized = await this._executeFallback({
        fallback,
        primary,
        primaryModel,
        primaryErr: circuitErr,
        circuitState: gate.state,
        req: wireReq,
        loadedImages,
        hasImages,
        timeoutMs: fallbackTimeoutMs,
        callerSignal: ctx.abort,
        warnings,
      });
      return restoreAnswerKeys(fbNormalized, wireToOriginal);
    }

    // 2. Execute primary call
    try {
      const res = await primary.decide({
        state: wireReq.state,
        questions: wireReq.questions,
        images: loadedImages,
        model: primaryModel,
        webGrounding: req.webGrounding === true,
        timeoutMs: primaryTimeoutMs,
        callerSignal: ctx.abort,
      });
      this.circuit.recordSuccess(primary.id);
      const normalized = normalizeDecisionResponse(res.raw, wireReq.questions, {
        backend: primary.id,
        model: res.model,
        dataDestination: res.dataDestination,
        latencyMs: res.latencyMs,
        fallbackUsed: false,
        warnings,
      });
      return restoreAnswerKeys(normalized, wireToOriginal);
    } catch (err) {
      // Never trip circuit or fallback if caller cancelled the operation
      if (err instanceof DecisionError && err.code === ERROR_CODES.CALLER_ABORTED) {
        throw err;
      }

      const circuitSnapshot = this.circuit.recordFailure(primary.id, err);

      if (
        canUseFallback &&
        isAvailabilityFailure(err, {
          fallbackOnNotConfigured: this.config.fallbackOnNotConfigured,
        })
      ) {
        const fbNormalized = await this._executeFallback({
          fallback,
          primary,
          primaryModel,
          primaryErr: err,
          circuitState: circuitSnapshot.state,
          req: wireReq,
          loadedImages,
          hasImages,
          timeoutMs: fallbackTimeoutMs,
          callerSignal: ctx.abort,
          warnings,
        });
        return restoreAnswerKeys(fbNormalized, wireToOriginal);
      }

      throw err;
    }
  }

  async _executeFallback({
    fallback,
    primary,
    primaryModel,
    primaryErr,
    circuitState,
    req,
    loadedImages,
    hasImages,
    timeoutMs,
    callerSignal,
    warnings,
  }) {
    const fbModel = fallback.defaultModel;
    const fbSupportsImages = fallback.supportsImages(fbModel);

    // Multimodal safety gate: NEVER silently drop images on fallback unless caller explicitly opted in
    if (hasImages && !fbSupportsImages && !req.allowImageDropOnFallback) {
      throw new DecisionError(primaryErr.code, primaryErr.message, {
        backend: primary.id,
        model: primaryModel,
        status: primaryErr.status,
        retryAfterMs: primaryErr.retryAfterMs,
        hint: primaryErr.hint,
        fallback: {
          attempted: false,
          backend: fallback.id,
          skipped_reason: ERROR_CODES.IMAGES_UNSUPPORTED,
          message: `Refused to fall back to text-only backend '${fallback.id}' because this request includes ${loadedImages.length} image(s). Pass allow_image_drop_on_fallback: true to override.`,
        },
        cause: primaryErr,
      });
    }

    const fbWarnings = [...warnings];
    const fbImages = hasImages && !fbSupportsImages ? [] : loadedImages;
    if (hasImages && !fbSupportsImages && req.allowImageDropOnFallback) {
      fbWarnings.push(
        `images omitted during fallback to text-only backend '${fallback.id}' (allow_image_drop_on_fallback=true)`,
      );
    }

    try {
      const fbRes = await fallback.decide({
        state: req.state,
        questions: req.questions,
        images: fbImages,
        model: fbModel,
        webGrounding: false,
        timeoutMs,
        callerSignal,
      });
      this.circuit.recordSuccess(fallback.id);

      return normalizeDecisionResponse(fbRes.raw, req.questions, {
        backend: fallback.id,
        model: fbRes.model,
        dataDestination: fbRes.dataDestination,
        latencyMs: fbRes.latencyMs,
        fallbackUsed: true,
        fallbackInfo: {
          primary_backend: primary.id,
          primary_model: primaryModel,
          reason: primaryErr.code,
          ...(typeof primaryErr.status === "number" ? { primary_status: primaryErr.status } : {}),
          circuit_state: circuitState,
        },
        warnings: fbWarnings,
      });
    } catch (fbErr) {
      this.circuit.recordFailure(fallback.id, fbErr);
      throw new DecisionError(primaryErr.code, primaryErr.message, {
        backend: primary.id,
        model: primaryModel,
        status: primaryErr.status,
        retryAfterMs: primaryErr.retryAfterMs,
        hint: primaryErr.hint,
        fallback: {
          attempted: true,
          backend: fallback.id,
          code: fbErr instanceof DecisionError ? fbErr.code : ERROR_CODES.UPSTREAM_ERROR,
          message: fbErr instanceof Error ? fbErr.message : String(fbErr),
        },
        cause: primaryErr,
      });
    }
  }

  /**
   * Evaluate the same questions across multiple states with bounded concurrency.
   * Mid-batch circuit trips automatically switch remaining states to local fallback.
   *
   * @param {{ states: Array<any>, questions: Record<string, any>, mode?: string, backend?: string, model?: string, maxDataDestination?: string, webGrounding?: boolean }} req
   * @param {{ abort?: AbortSignal, directory?: string }} [ctx]
   */
  async decideBatch(req, ctx = {}) {
    // Validate route & boundary up front before launching parallel items
    const route = this.resolveRoute(req);
    const concurrency = Math.min(this.config.limits.batchConcurrency, req.states.length);
    const startedAt = performance.now();

    /** @type {Array<any>} */
    const results = new Array(req.states.length);
    let cursor = 0;

    const worker = async () => {
      while (cursor < req.states.length) {
        if (ctx.abort?.aborted) {
          throw new DecisionError(ERROR_CODES.CALLER_ABORTED, "batch cancelled by caller");
        }
        const index = cursor++;
        try {
          const single = await this.decide(
            {
              state: req.states[index],
              questions: req.questions,
              loadedImages: [],
              mode: req.mode,
              backend: req.backend,
              model: req.model,
              maxDataDestination: req.maxDataDestination,
              webGrounding: req.webGrounding,
            },
            ctx,
          );
          const item = {
            index,
            answers: single.answers,
            backend: single.backend,
            model: single.model,
            data_destination: single.data_destination,
            fallback_used: single.fallback_used,
          };
          if (single.fallback_info) item.fallback_info = single.fallback_info;
          if (single.warnings) item.warnings = single.warnings;
          results[index] = item;
        } catch (err) {
          if (err instanceof DecisionError && err.code === ERROR_CODES.CALLER_ABORTED) {
            throw err;
          }
          results[index] = {
            index,
            error:
              err instanceof DecisionError
                ? {
                    code: err.code,
                    message: err.message,
                    ...(err.backend ? { backend: err.backend } : {}),
                    ...(err.fallback ? { fallback: err.fallback } : {}),
                  }
                : {
                    code: ERROR_CODES.UPSTREAM_ERROR,
                    message: err instanceof Error ? err.message : String(err),
                  },
          };
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    const fallbackCount = results.filter((r) => r && r.fallback_used === true).length;
    const firstOk = results.find((r) => r && !r.error);

    return {
      backend: firstOk?.backend || route.primary.id,
      model: firstOk?.model || route.primaryModel,
      data_destination: firstOk?.data_destination || route.primaryDest,
      fallback_used: fallbackCount > 0,
      fallback_count: fallbackCount,
      results,
      latency_ms: Math.round((performance.now() - startedAt) * 10) / 10,
    };
  }

  /**
   * Read-only status probe across enabled backends.
   * @param {{ backend?: string, dataDestination?: string, multimodal?: boolean }} [filter]
   * @param {{ abort?: AbortSignal }} [ctx]
   */
  async status(filter = {}, ctx = {}) {
    const entries = [...this.backends.values()];
    const statuses = await Promise.all(
      entries.map(async (b) => {
        const s = await b.status({
          timeoutMs: Math.min(4_000, this.config.limits.timeoutMs),
          callerSignal: ctx.abort,
        });
        return {
          ...s,
          circuit: this.circuit.getState(b.id),
        };
      }),
    );

    const filtered = statuses.filter((s) => {
      if (filter.backend && s.id !== filter.backend) return false;
      if (filter.dataDestination && s.data_destination !== filter.dataDestination) return false;
      if (typeof filter.multimodal === "boolean" && Boolean(s.capabilities?.images) !== filter.multimodal) {
        return false;
      }
      return true;
    });

    const out = {
      version: PACKAGE_VERSION,
      routing_mode: this.config.routingMode,
      default_backend: this.config.defaultBackend,
      fallback_backend: this.config.fallbackBackend,
      default_model: this.config.defaultModel,
      max_data_destination: this.config.maxDataDestination,
      fallback_on_not_configured: this.config.fallbackOnNotConfigured,
      config_path: this.config.configPath,
      backends: filtered,
      limits: {
        questions: this.config.limits.questions,
        options: this.config.limits.options,
        state_chars: this.config.limits.stateChars,
        images: this.config.limits.images,
        image_max_bytes: this.config.limits.imageMaxBytes,
        batch_states: this.config.limits.batchStates,
        batch_items: this.config.limits.batchItems,
        batch_concurrency: this.config.limits.batchConcurrency,
        timeout_ms: this.config.limits.timeoutMs,
        primary_timeout_ms: this.config.limits.primaryTimeoutMs,
        fallback_timeout_ms: this.config.limits.fallbackTimeoutMs,
      },
    };

    if (this.config.configWarnings?.length > 0) {
      out.warnings = [...this.config.configWarnings];
    }
    return out;
  }
}
