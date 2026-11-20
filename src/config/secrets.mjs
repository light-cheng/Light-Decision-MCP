/**
 * Secure local credential resolution for direct (non-Magpie) cloud backends.
 *
 * Resolution order for a named environment variable (e.g. "PERPLEXITY_API_KEY"):
 *   1. Process environment (`env[keyName]`)
 *   2. User-only local secrets file (`~/.config/light-decision-mcp/secrets.json`, mode 0600)
 *   3. Optional macOS Keychain entry (service: "light-decision-mcp", account: keyName)
 *
 * Plaintext keys are NEVER stored in the repository or in `config.json`.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const KEYCHAIN_SERVICE = "light-decision-mcp";
const VALID_KEY_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;

export function getDefaultSecretsPath(env = process.env) {
  if (env.LIGHT_DECISION_SECRETS && env.LIGHT_DECISION_SECRETS.trim()) {
    return path.resolve(env.LIGHT_DECISION_SECRETS.trim());
  }
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim();
  const root = xdg || path.join(os.homedir(), ".config");
  return path.join(root, "light-decision-mcp", "secrets.json");
}

export function isValidKeyName(name) {
  return typeof name === "string" && VALID_KEY_NAME.test(name.trim());
}

/**
 * Read local 0600 secrets.json map safely.
 * @param {string} [secretsPath]
 * @returns {Record<string, string>}
 */
export function readSecretsFile(secretsPath) {
  const file = secretsPath || getDefaultSecretsPath();
  try {
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    /** @type {Record<string, string>} */
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Save a secret to ~/.config/light-decision-mcp/secrets.json with 0600 permissions.
 * @param {string} keyName
 * @param {string} value
 * @param {string} [secretsPath]
 */
export function setFileSecret(keyName, value, secretsPath) {
  const name = keyName.trim();
  if (!isValidKeyName(name)) {
    throw new Error(`Invalid key name '${keyName}'. Use uppercase letters, digits, and underscores (e.g. PERPLEXITY_API_KEY).`);
  }
  const val = String(value || "").trim();
  if (!val) throw new Error("Secret value must not be empty.");

  const file = secretsPath || getDefaultSecretsPath();
  const current = readSecretsFile(file);
  current[name] = val;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(current, null, 2) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best-effort on non-POSIX filesystems
  }
  return file;
}

/**
 * Remove a secret from ~/.config/light-decision-mcp/secrets.json.
 * @param {string} keyName
 * @param {string} [secretsPath]
 * @returns {boolean}
 */
export function removeFileSecret(keyName, secretsPath) {
  const file = secretsPath || getDefaultSecretsPath();
  const current = readSecretsFile(file);
  if (!(keyName in current)) return false;
  delete current[keyName];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(current, null, 2) + "\n", { mode: 0o600 });
  return true;
}

/**
 * Read a secret from macOS Keychain (only on darwin).
 * @param {string} keyName
 * @returns {string | undefined}
 */
export function readKeychainSecret(keyName) {
  if (process.platform !== "darwin") return undefined;
  try {
    const out = execFileSync(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", keyName, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 },
    );
    const trimmed = out.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Store a secret in macOS Keychain (only on darwin).
 * @param {string} keyName
 * @param {string} value
 */
export function setKeychainSecret(keyName, value) {
  if (process.platform !== "darwin") {
    throw new Error("macOS Keychain storage is only available on macOS.");
  }
  const name = keyName.trim();
  if (!isValidKeyName(name)) {
    throw new Error(`Invalid key name '${keyName}'.`);
  }
  const val = String(value || "").trim();
  if (!val) throw new Error("Secret value must not be empty.");
  execFileSync(
    "security",
    ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", name, "-w", val],
    { stdio: ["ignore", "ignore", "pipe"], timeout: 3_000 },
  );
}

/**
 * Remove a secret from macOS Keychain (only on darwin).
 * @param {string} keyName
 * @returns {boolean}
 */
export function removeKeychainSecret(keyName) {
  if (process.platform !== "darwin") return false;
  try {
    execFileSync(
      "security",
      ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", keyName],
      { stdio: ["ignore", "ignore", "ignore"], timeout: 2_000 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a cached secret resolver for runtime backend lookups.
 * Avoids repeated Keychain subprocess calls on hot paths.
 *
 * @param {{ env?: Record<string, string | undefined>, secretsPath?: string, useKeychain?: boolean }} [opts]
 */
export function createSecretResolver(opts = {}) {
  const env = opts.env || process.env;
  const secretsPath = opts.secretsPath || getDefaultSecretsPath(env);
  const useKeychain =
    opts.useKeychain !== undefined
      ? opts.useKeychain
      : process.platform === "darwin" && opts.env === undefined;

  let cachedMtime = -1;
  /** @type {Record<string, string>} */
  let fileSecrets = {};
  /** @type {Map<string, string | null>} */
  const keychainCache = new Map();

  function refreshFileIfNeeded() {
    let mtime = 0;
    try {
      mtime = fs.statSync(secretsPath).mtimeMs;
    } catch {
      mtime = 0;
    }
    if (mtime !== cachedMtime) {
      cachedMtime = mtime;
      fileSecrets = mtime > 0 ? readSecretsFile(secretsPath) : {};
    }
  }

  /**
   * Resolve a secret value by env variable name.
   * @param {string | null | undefined} keyName
   * @returns {string | undefined}
   */
  function get(keyName) {
    if (!keyName || typeof keyName !== "string") return undefined;
    const trimmedName = keyName.trim();
    if (!trimmedName) return undefined;

    const fromEnv = env[trimmedName];
    if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();

    refreshFileIfNeeded();
    if (fileSecrets[trimmedName]) return fileSecrets[trimmedName];

    if (useKeychain) {
      if (!keychainCache.has(trimmedName)) {
        keychainCache.set(trimmedName, readKeychainSecret(trimmedName) ?? null);
      }
      const fromKc = keychainCache.get(trimmedName);
      if (fromKc) return fromKc;
    }
    return undefined;
  }

  /**
   * Report where a key comes from (never returns the raw secret).
   * @param {string} keyName
   * @returns {"env" | "secrets.json" | "keychain" | null}
   */
  function sourceOf(keyName) {
    const trimmedName = keyName.trim();
    if (typeof env[trimmedName] === "string" && env[trimmedName].trim()) return "env";
    refreshFileIfNeeded();
    if (fileSecrets[trimmedName]) return "secrets.json";
    if (useKeychain) {
      if (!keychainCache.has(trimmedName)) {
        keychainCache.set(trimmedName, readKeychainSecret(trimmedName) ?? null);
      }
      if (keychainCache.get(trimmedName)) return "keychain";
    }
    return null;
  }

  function clearCache() {
    cachedMtime = -1;
    keychainCache.clear();
  }

  return { get, sourceOf, clearCache, secretsPath };
}
