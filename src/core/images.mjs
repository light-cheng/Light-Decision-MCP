/**
 * Safe image input loader:
 * - Local files: regular-file check, size cap, magic-byte MIME sniffing -> data URI
 * - Data URIs: MIME whitelist + decoded byte limit
 * - HTTPS URLs: validated and passed through directly (zero SSRF fetching)
 * - Rejects http://, file://, non-image files, oversized files
 */

import fs from "node:fs/promises";
import path from "node:path";
import { DecisionError, ERROR_CODES } from "./errors.mjs";
import { DEFAULT_LIMITS } from "./schema.mjs";

const ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const DATA_URI_RE = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i;

/**
 * Sniff image MIME type from magic bytes.
 * @param {Buffer} buf
 * @returns {string | null}
 */
export function sniffImageMime(buf) {
  if (!buf || buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // GIF: GIF87a or GIF89a
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return "image/gif";
  }
  // WEBP: RIFF....WEBP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * @typedef {{
 *   kind: "data_uri" | "url",
 *   url: string,
 *   mimeType: string | null,
 *   base64?: string,
 *   bytes?: number,
 *   source: "file" | "data_uri" | "https"
 * }} LoadedImage
 */

/**
 * Load and validate an array of image inputs.
 * @param {string[]} inputs
 * @param {{ baseDir?: string, maxImages?: number, maxBytes?: number }} [opts]
 * @returns {Promise<LoadedImage[]>}
 */
export async function loadImages(inputs, opts = {}) {
  if (!inputs || inputs.length === 0) return [];
  const maxImages = opts.maxImages ?? DEFAULT_LIMITS.images;
  const maxBytes = opts.maxBytes ?? DEFAULT_LIMITS.imageMaxBytes;
  const baseDir = opts.baseDir || process.cwd();

  if (inputs.length > maxImages) {
    throw new DecisionError(
      ERROR_CODES.INVALID_ARGUMENTS,
      `at most ${maxImages} images allowed per call (got ${inputs.length})`,
    );
  }

  /** @type {LoadedImage[]} */
  const out = [];
  for (let i = 0; i < inputs.length; i++) {
    const raw = inputs[i].trim();
    const label = `images[${i}]`;

    // 1. Data URI
    if (/^data:/i.test(raw)) {
      const m = DATA_URI_RE.exec(raw);
      if (!m) {
        throw new DecisionError(
          ERROR_CODES.INVALID_ARGUMENTS,
          `${label}: invalid data URI (allowed MIME types: png, jpeg, webp, gif with base64 encoding)`,
        );
      }
      const mimeType = m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase();
      const compactB64 = m[2].replace(/\s+/g, "");
      const decoded = Buffer.from(compactB64, "base64");
      if (decoded.length === 0) {
        throw new DecisionError(ERROR_CODES.INVALID_ARGUMENTS, `${label}: empty base64 image payload`);
      }
      if (decoded.length > maxBytes) {
        throw new DecisionError(
          ERROR_CODES.INVALID_ARGUMENTS,
          `${label}: decoded image exceeds ${maxBytes} bytes limit (got ${decoded.length})`,
        );
      }
      const sniffed = sniffImageMime(decoded);
      if (!sniffed || !ALLOWED_MIMES.has(sniffed)) {
        throw new DecisionError(
          ERROR_CODES.INVALID_ARGUMENTS,
          `${label}: data URI payload is not a valid PNG, JPEG, WEBP, or GIF image`,
        );
      }
      out.push({
        kind: "data_uri",
        url: `data:${sniffed};base64,${compactB64}`,
        mimeType: sniffed,
        base64: compactB64,
        bytes: decoded.length,
        source: "data_uri",
      });
      continue;
    }

    // 2. URL scheme check (only https:// allowed; reject http://, file://, etc.)
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
      let parsed;
      try {
        parsed = new URL(raw);
      } catch {
        throw new DecisionError(ERROR_CODES.INVALID_ARGUMENTS, `${label}: malformed image URL`);
      }
      if (parsed.protocol !== "https:") {
        throw new DecisionError(
          ERROR_CODES.INVALID_ARGUMENTS,
          `${label}: only https:// image URLs are allowed (got '${parsed.protocol}')`,
        );
      }
      out.push({
        kind: "url",
        url: parsed.href,
        mimeType: null,
        source: "https",
      });
      continue;
    }

    // 3. Local file path
    const resolved = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(baseDir, raw);
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch (err) {
      throw new DecisionError(
        ERROR_CODES.INVALID_ARGUMENTS,
        `${label}: cannot access image file '${raw}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!stat.isFile()) {
      throw new DecisionError(
        ERROR_CODES.INVALID_ARGUMENTS,
        `${label}: '${raw}' is not a regular file`,
      );
    }
    if (stat.size <= 0) {
      throw new DecisionError(ERROR_CODES.INVALID_ARGUMENTS, `${label}: image file '${raw}' is empty`);
    }
    if (stat.size > maxBytes) {
      throw new DecisionError(
        ERROR_CODES.INVALID_ARGUMENTS,
        `${label}: image file '${raw}' exceeds ${maxBytes} bytes limit (got ${stat.size} bytes)`,
      );
    }

    const buf = await fs.readFile(resolved);
    const mimeType = sniffImageMime(buf);
    if (!mimeType || !ALLOWED_MIMES.has(mimeType)) {
      throw new DecisionError(
        ERROR_CODES.INVALID_ARGUMENTS,
        `${label}: file '${raw}' is not a recognized PNG, JPEG, WEBP, or GIF image`,
      );
    }
    const base64 = buf.toString("base64");
    out.push({
      kind: "data_uri",
      url: `data:${mimeType};base64,${base64}`,
      mimeType,
      base64,
      bytes: buf.length,
      source: "file",
    });
  }

  return out;
}
