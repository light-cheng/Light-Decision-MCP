/**
 * Standardized error types and availability-fault classification for light-decision-mcp.
 */

export const ERROR_CODES = Object.freeze({
  INVALID_ARGUMENTS: "invalid_arguments",
  NOT_CONFIGURED: "not_configured",
  MODEL_NOT_FOUND: "model_not_found",
  BACKEND_NOT_FOUND: "backend_not_found",
  DATA_BOUNDARY_EXCEEDED: "data_boundary_exceeded",
  IMAGES_UNSUPPORTED: "images_unsupported",
  CIRCUIT_OPEN: "circuit_open",
  RATE_LIMITED: "rate_limited",
  AUTH_FAILED: "auth_failed",
  TIMEOUT: "timeout",
  CALLER_ABORTED: "caller_aborted",
  GATEWAY_UNREACHABLE: "gateway_unreachable",
  NETWORK_ERROR: "network_error",
  UPSTREAM_ERROR: "upstream_error",
  MALFORMED_RESPONSE: "malformed_response",
});

export class DecisionError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {object} [opts]
   */
  constructor(code, message, opts = {}) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = "DecisionError";
    this.code = code || ERROR_CODES.UPSTREAM_ERROR;
    if (opts.backend !== undefined) this.backend = opts.backend;
    if (opts.model !== undefined) this.model = opts.model;
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs;
    if (opts.hint !== undefined) this.hint = opts.hint;
    if (opts.fallback !== undefined) this.fallback = opts.fallback;
    if (opts.details !== undefined) this.details = opts.details;
  }
}

/**
 * Parse an HTTP Retry-After header (seconds or HTTP-date) into milliseconds.
 * @param {string | null | undefined} value
 * @param {number} [maxMs=120000]
 * @param {number} [now=Date.now()]
 * @returns {number | undefined}
 */
export function parseRetryAfterMs(value, maxMs = 120_000, now = Date.now()) {
  if (!value || typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1000), maxMs);
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const diff = dateMs - now;
    if (diff > 0) return Math.min(diff, maxMs);
    return 0;
  }
  return undefined;
}

/**
 * Determine whether an error represents an upstream availability fault that may
 * trigger fallback to a secondary backend in api_with_local_fallback mode.
 *
 * Caller bugs (400), caller cancellations, auth mistakes, and policy boundary
 * violations MUST NOT silently fall back.
 *
 * @param {unknown} err
 * @param {{ fallbackOnNotConfigured?: boolean }} [opts]
 * @returns {boolean}
 */
export function isAvailabilityFailure(err, opts = {}) {
  if (!(err instanceof DecisionError)) return false;
  switch (err.code) {
    case ERROR_CODES.GATEWAY_UNREACHABLE:
    case ERROR_CODES.NETWORK_ERROR:
    case ERROR_CODES.TIMEOUT:
    case ERROR_CODES.RATE_LIMITED:
    case ERROR_CODES.UPSTREAM_ERROR:
    case ERROR_CODES.CIRCUIT_OPEN:
      return true;
    case ERROR_CODES.NOT_CONFIGURED:
    case ERROR_CODES.MODEL_NOT_FOUND:
      return opts.fallbackOnNotConfigured === true;
    default:
      return false;
  }
}

/**
 * Whether a failure should count toward tripping a backend's circuit breaker.
 * Configuration absence (not_configured / model_not_found) should not confuse
 * circuit health with transient runtime faults.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isCircuitTrippingFailure(err) {
  if (!(err instanceof DecisionError)) return false;
  return (
    err.code === ERROR_CODES.GATEWAY_UNREACHABLE ||
    err.code === ERROR_CODES.NETWORK_ERROR ||
    err.code === ERROR_CODES.TIMEOUT ||
    err.code === ERROR_CODES.RATE_LIMITED ||
    err.code === ERROR_CODES.UPSTREAM_ERROR
  );
}

/**
 * Convert any error into a structured, agent-friendly JSON payload.
 * @param {unknown} err
 * @returns {{ error: Record<string, unknown> }}
 */
export function toErrorPayload(err) {
  if (err instanceof DecisionError) {
    const out = {
      code: err.code,
      message: err.message,
    };
    if (err.backend) out.backend = err.backend;
    if (err.model) out.model = err.model;
    if (typeof err.status === "number") out.status = err.status;
    if (typeof err.retryAfterMs === "number") out.retry_after_ms = err.retryAfterMs;
    if (err.hint) out.hint = err.hint;
    if (err.fallback) out.fallback = err.fallback;
    if (err.details) out.details = err.details;
    return { error: out };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    error: {
      code: ERROR_CODES.UPSTREAM_ERROR,
      message,
    },
  };
}
