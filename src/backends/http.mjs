/**
 * Shared HTTP transport, AbortSignal budgeting (separating plugin timeout from
 * caller cancellation), loopback checks, and wire-format payload builders.
 */

import { DecisionError, ERROR_CODES, parseRetryAfterMs } from "../core/errors.mjs";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * @param {string} urlStr
 * @returns {boolean}
 */
export function isLoopbackUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return LOOPBACK_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Enforce TLS when sending credentials to non-loopback hosts unless explicitly allowed.
 * @param {string} urlStr
 * @param {string | undefined} apiKey
 * @param {boolean} [allowInsecureHttp=false]
 */
export function assertSafeCredentialTransport(urlStr, apiKey, allowInsecureHttp = false) {
  if (!apiKey) return;
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    throw new DecisionError(ERROR_CODES.INVALID_ARGUMENTS, `invalid backend URL: ${urlStr}`);
  }
  if (u.protocol === "http:" && !isLoopbackUrl(urlStr) && !allowInsecureHttp) {
    throw new DecisionError(
      ERROR_CODES.INVALID_ARGUMENTS,
      `refusing to send API credentials over plain HTTP to non-loopback host '${u.hostname}'; use https://`,
    );
  }
}

/**
 * Deterministic text serialization when a structured JSON state must be sent to
 * a text/multimodal `input` endpoint (e.g. Gemini or OpenAI /v1/decisions).
 * @param {string | object | Array<unknown>} state
 * @returns {string}
 */
export function serializeStateAsText(state) {
  if (typeof state === "string") return state;
  return JSON.stringify(state, null, 2);
}

/**
 * Convert canonical questions map into System One / OpenDecider / TypeSafe Jev wire map.
 * @param {Record<string, any>} canonicalQuestions
 */
export function toSystemOneQuestions(canonicalQuestions) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [key, q] of Object.entries(canonicalQuestions)) {
    if (q.type === "noul") {
      /** @type {Record<string, any>} */
      const item = { type: "noul", instructions: q.instructions };
      if (q.criteria && (q.criteria.true || q.criteria.false)) {
        item.criteria = { ...q.criteria };
      }
      out[key] = item;
    } else if (q.type === "choice") {
      out[key] = {
        type: "choice",
        instructions: q.instructions,
        criteria: { ...q.criteria },
      };
    } else {
      out[key] = {
        type: "score",
        instructions: q.instructions,
        criteria: q.levels.map((l) =>
          l.description && l.description !== l.label ? `${l.label}: ${l.description}` : l.label,
        ),
      };
    }
  }
  return out;
}

/**
 * Convert canonical request into OpenAI Decisions API (/v1/decisions) payload,
 * also consumed by Magpie's gateway /v1/decisions -> Google/Clef/OpenAI translator.
 *
 * @param {{ model: string, state: any, questions: Record<string, any>, images?: Array<{ url: string }> }} req
 */
export function toOpenAIDecisionsPayload(req) {
  const images = req.images || [];
  let input;
  if (images.length > 0) {
    input = [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: serializeStateAsText(req.state),
          },
          ...images.map((img) => ({
            type: "input_image",
            image_url: img.url,
          })),
        ],
      },
    ];
  } else if (typeof req.state === "string") {
    input = req.state;
  } else {
    input = serializeStateAsText(req.state);
  }

  const questions = Object.entries(req.questions).map(([name, q]) => {
    if (q.type === "noul") {
      let instructions = q.instructions;
      if (q.criteria?.true || q.criteria?.false) {
        const parts = [];
        if (q.criteria.true) parts.push(`Yes: ${q.criteria.true}`);
        if (q.criteria.false) parts.push(`No: ${q.criteria.false}`);
        instructions = `${instructions} (${parts.join("; ")})`;
      }
      return { type: "predicate", name, instructions };
    }
    if (q.type === "choice") {
      return {
        type: "choice",
        name,
        instructions: q.instructions,
        choices: q.options.map((opt) => ({
          value: opt,
          ...(q.criteria[opt] && q.criteria[opt] !== opt ? { description: q.criteria[opt] } : {}),
        })),
      };
    }
    return {
      type: "score",
      name,
      instructions: q.instructions,
      levels: q.levels.map((l) => ({
        label: l.label,
        ...(l.description && l.description !== l.label ? { description: l.description } : {}),
      })),
    };
  });

  return {
    model: req.model,
    input,
    questions,
  };
}

/**
 * Convert canonical request into Google Gemini Decisions API (/v1beta/decisions) payload.
 * @param {{ model: string, state: any, questions: Record<string, any>, images?: Array<{ kind: string, url: string, mimeType: string | null, base64?: string }> }} req
 */
export function toGeminiDecisionsPayload(req) {
  const images = req.images || [];
  let input;
  if (images.length > 0) {
    input = [
      { type: "text", text: serializeStateAsText(req.state) },
      ...images.map((img) =>
        img.kind === "data_uri" && img.base64 && img.mimeType
          ? { type: "image", data: img.base64, mime_type: img.mimeType }
          : { type: "image", uri: img.url },
      ),
    ];
  } else {
    input = serializeStateAsText(req.state);
  }

  /** @type {Record<string, any>} */
  const questions = {};
  for (const [key, q] of Object.entries(req.questions)) {
    if (q.type === "noul") {
      /** @type {Record<string, any>} */
      const item = { type: "noul", instructions: q.instructions };
      if (q.criteria?.true) item.true_description = q.criteria.true;
      if (q.criteria?.false) item.false_description = q.criteria.false;
      questions[key] = item;
    } else if (q.type === "choice") {
      questions[key] = {
        type: "choice",
        instructions: q.instructions,
        criteria: { ...q.criteria },
      };
    } else {
      questions[key] = {
        type: "score",
        instructions: q.instructions,
        levels: q.levels.map((l) =>
          l.description && l.description !== l.label ? `${l.label}: ${l.description}` : l.label,
        ),
      };
    }
  }

  return {
    model: req.model,
    input,
    questions,
  };
}

/**
 * Extract human-readable error message from a JSON or plain-text upstream body.
 * @param {any} parsed
 * @param {string} rawText
 * @param {number} status
 */
export function extractErrorMessage(parsed, rawText, status) {
  if (parsed && typeof parsed === "object") {
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
    if (parsed.error && typeof parsed.error.message === "string" && parsed.error.message.trim()) {
      return parsed.error.message.trim();
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim();
    if (typeof parsed.detail === "string" && parsed.detail.trim()) return parsed.detail.trim();
  }
  const snippet = (rawText || "").trim().slice(0, 300);
  return snippet || `HTTP ${status}`;
}

/**
 * Execute an HTTP JSON request with distinct caller-abort vs plugin-timeout handling.
 *
 * @param {object} params
 * @param {string} params.url
 * @param {string} [params.method="POST"]
 * @param {Record<string, string>} [params.headers]
 * @param {any} [params.body]
 * @param {number} params.timeoutMs
 * @param {AbortSignal} [params.callerSignal]
 * @param {typeof fetch} [params.fetchImpl]
 * @param {string} params.backendId
 * @param {string} [params.model]
 * @param {boolean} [params.isGateway=false]
 */
export async function fetchJson(params) {
  const {
    url,
    method = "POST",
    headers = {},
    body,
    timeoutMs,
    callerSignal,
    fetchImpl = globalThis.fetch,
    backendId,
    model,
    isGateway = false,
  } = params;

  if (callerSignal?.aborted) {
    throw new DecisionError(ERROR_CODES.CALLER_ABORTED, "request cancelled by caller", {
      backend: backendId,
      model,
    });
  }

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), Math.max(100, timeoutMs));
  const onCallerAbort = () => timeoutController.abort();
  if (callerSignal) {
    callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  const startedAt = performance.now();
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: timeoutController.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener("abort", onCallerAbort);

    if (callerSignal?.aborted) {
      throw new DecisionError(ERROR_CODES.CALLER_ABORTED, "request cancelled by caller", {
        backend: backendId,
        model,
        cause: err,
      });
    }
    if (timeoutController.signal.aborted) {
      throw new DecisionError(
        ERROR_CODES.TIMEOUT,
        `${backendId} timed out after ${timeoutMs}ms`,
        { backend: backendId, model, cause: err },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new DecisionError(
      isGateway ? ERROR_CODES.GATEWAY_UNREACHABLE : ERROR_CODES.NETWORK_ERROR,
      `${backendId} unreachable at ${url}: ${msg}`,
      {
        backend: backendId,
        model,
        cause: err,
        hint: isGateway
          ? "Ensure Magpie is running and gateway.json is reachable."
          : `Check that backend '${backendId}' is running and reachable at ${url}.`,
      },
    );
  }

  let rawText = "";
  try {
    rawText = await res.text();
  } catch (err) {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener("abort", onCallerAbort);
    if (callerSignal?.aborted) {
      throw new DecisionError(ERROR_CODES.CALLER_ABORTED, "request cancelled by caller", {
        backend: backendId,
        model,
        cause: err,
      });
    }
    if (timeoutController.signal.aborted) {
      throw new DecisionError(ERROR_CODES.TIMEOUT, `${backendId} timed out reading response`, {
        backend: backendId,
        model,
        cause: err,
      });
    }
    throw new DecisionError(
      ERROR_CODES.NETWORK_ERROR,
      `${backendId} connection dropped while reading response`,
      { backend: backendId, model, cause: err },
    );
  } finally {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener("abort", onCallerAbort);
  }

  const latencyMs = performance.now() - startedAt;
  let parsed = null;
  if (rawText.trim()) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const retryAfterMs = parseRetryAfterMs(res.headers?.get?.("retry-after"));
    const message = extractErrorMessage(parsed, rawText, res.status);
    let code = ERROR_CODES.UPSTREAM_ERROR;
    if (res.status === 400 || res.status === 422) code = ERROR_CODES.INVALID_ARGUMENTS;
    else if (res.status === 401 || res.status === 403) code = ERROR_CODES.AUTH_FAILED;
    else if (res.status === 404) code = ERROR_CODES.MODEL_NOT_FOUND;
    else if (res.status === 429) code = ERROR_CODES.RATE_LIMITED;
    else if (res.status >= 500) code = ERROR_CODES.UPSTREAM_ERROR;

    throw new DecisionError(code, message, {
      backend: backendId,
      model,
      status: res.status,
      retryAfterMs,
    });
  }

  if (parsed === null) {
    throw new DecisionError(
      ERROR_CODES.MALFORMED_RESPONSE,
      `${backendId} returned non-JSON response (HTTP ${res.status})`,
      { backend: backendId, model, status: res.status },
    );
  }

  return { data: parsed, latencyMs, status: res.status };
}
