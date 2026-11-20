/**
 * Per-backend in-process circuit breaker (closed -> open -> half_open)
 * enabling 0ms primary bypass to local fallback during upstream outages or 429 windows.
 */

import { ERROR_CODES, isCircuitTrippingFailure } from "./errors.mjs";

export const DEFAULT_CIRCUIT_CONFIG = Object.freeze({
  failureThreshold: 2,
  cooldownMs: 30_000,
  maxCooldownMs: 120_000,
});

export class CircuitBreakerRegistry {
  /**
   * @param {{ failureThreshold?: number, cooldownMs?: number, maxCooldownMs?: number, now?: () => number }} [opts]
   */
  constructor(opts = {}) {
    this.failureThreshold = Math.max(1, opts.failureThreshold ?? DEFAULT_CIRCUIT_CONFIG.failureThreshold);
    this.cooldownMs = Math.max(1_000, opts.cooldownMs ?? DEFAULT_CIRCUIT_CONFIG.cooldownMs);
    this.maxCooldownMs = Math.max(this.cooldownMs, opts.maxCooldownMs ?? DEFAULT_CIRCUIT_CONFIG.maxCooldownMs);
    this.now = typeof opts.now === "function" ? opts.now : () => Date.now();
    /** @type {Map<string, { state: "closed"|"open"|"half_open", consecutiveFailures: number, openUntil: number, lastError: { code: string, message: string, status?: number } | null, probeInFlight: boolean }>} */
    this.entries = new Map();
  }

  _entry(backendId) {
    let e = this.entries.get(backendId);
    if (!e) {
      e = {
        state: "closed",
        consecutiveFailures: 0,
        openUntil: 0,
        lastError: null,
        probeInFlight: false,
      };
      this.entries.set(backendId, e);
    }
    return e;
  }

  /**
   * Check whether a call to backendId is currently permitted.
   * @param {string} backendId
   */
  beforeCall(backendId) {
    const e = this._entry(backendId);
    const now = this.now();

    if (e.state === "open") {
      if (now < e.openUntil) {
        return {
          allowed: false,
          state: "open",
          openUntil: e.openUntil,
          remainingMs: e.openUntil - now,
          lastError: e.lastError,
        };
      }
      // Cooldown expired -> allow a single half-open probe
      e.state = "half_open";
      e.probeInFlight = true;
      return {
        allowed: true,
        state: "half_open",
        openUntil: 0,
        remainingMs: 0,
        lastError: e.lastError,
      };
    }

    if (e.state === "half_open") {
      if (e.probeInFlight) {
        return {
          allowed: false,
          state: "half_open",
          openUntil: e.openUntil,
          remainingMs: 0,
          lastError: e.lastError,
        };
      }
      e.probeInFlight = true;
      return {
        allowed: true,
        state: "half_open",
        openUntil: 0,
        remainingMs: 0,
        lastError: e.lastError,
      };
    }

    return {
      allowed: true,
      state: "closed",
      openUntil: 0,
      remainingMs: 0,
      lastError: e.lastError,
    };
  }

  /**
   * Record a successful call, closing the circuit immediately.
   * @param {string} backendId
   */
  recordSuccess(backendId) {
    const e = this._entry(backendId);
    e.state = "closed";
    e.consecutiveFailures = 0;
    e.openUntil = 0;
    e.lastError = null;
    e.probeInFlight = false;
  }

  /**
   * Record a failed call; trips the circuit when threshold or immediate-open rules hit.
   * @param {string} backendId
   * @param {any} err
   */
  recordFailure(backendId, err) {
    const e = this._entry(backendId);
    e.probeInFlight = false;

    if (!isCircuitTrippingFailure(err)) {
      return this.getState(backendId);
    }

    const now = this.now();
    e.consecutiveFailures += 1;
    e.lastError = {
      code: err.code,
      message: err.message,
      ...(typeof err.status === "number" ? { status: err.status } : {}),
    };

    const immediateOpen =
      e.state === "half_open" ||
      err.code === ERROR_CODES.GATEWAY_UNREACHABLE ||
      err.code === ERROR_CODES.NETWORK_ERROR ||
      (err.code === ERROR_CODES.RATE_LIMITED && typeof err.retryAfterMs === "number" && err.retryAfterMs > 0);

    if (immediateOpen || e.consecutiveFailures >= this.failureThreshold) {
      const requestedCooldown =
        typeof err.retryAfterMs === "number" && err.retryAfterMs > 0
          ? err.retryAfterMs
          : this.cooldownMs;
      const effectiveCooldown = Math.min(Math.max(requestedCooldown, 1_000), this.maxCooldownMs);
      e.state = "open";
      e.openUntil = now + effectiveCooldown;
    }

    return this.getState(backendId);
  }

  /**
   * Read current observable state for `status` reporting.
   * @param {string} backendId
   */
  getState(backendId) {
    const e = this._entry(backendId);
    const now = this.now();
    let effectiveState = e.state;
    if (e.state === "open" && now >= e.openUntil) {
      effectiveState = "half_open";
    }
    return {
      state: effectiveState,
      consecutive_failures: e.consecutiveFailures,
      open_until: effectiveState === "open" ? new Date(e.openUntil).toISOString() : null,
      last_error: e.lastError,
    };
  }

  /**
   * Reset all circuit states (useful for tests).
   */
  reset() {
    this.entries.clear();
  }
}
