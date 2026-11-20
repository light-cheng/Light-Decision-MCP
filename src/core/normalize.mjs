/**
 * Cross-protocol response normalization across:
 * - Magpie Gateway (/v1/systemone & /v1/decisions)
 * - OpenDecider (/v1/systemone wire format: integer argmax `score` + `expected` + `legend`)
 * - Google Gemini Decisions API (`noul`, `choice`, expected float `score` + `legend`)
 * - TypeSafe Jev (/v1/systemone)
 * - Perplexity Decisions API (/v1/decisions)
 * - OpenAI Decisions API (/v1/decisions array of `{ name, type, result, probabilities, confidence }`)
 */

import { DecisionError, ERROR_CODES } from "./errors.mjs";

/**
 * @param {number} n
 * @returns {number}
 */
export function round4(n) {
  return Math.round(n * 10_000) / 10_000;
}

function finiteNumber(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function clampProb(p) {
  if (p < 0) return 0;
  if (p > 1) return 1;
  return p;
}

function extractProviderConfidence(raw) {
  const c = finiteNumber(raw?.confidence);
  return c === null ? null : round4(clampProb(c));
}

/**
 * Convert upstream `probabilities` into a flat lookup object whether it arrived as:
 * - an object map (`{ billing: 0.9, tech: 0.1 }` or `{ "0": 0.1, "1": 0.9 }`), OR
 * - an OpenAI/Magpie `/v1/decisions` array (`[{ value: "billing", probability: 0.9 }]`
 *   or `[{ label: "high", value: 2, probability: 0.87 }]`).
 *
 * @param {unknown} rawProbs
 * @returns {Record<string, number> | null}
 */
function toProbLookup(rawProbs) {
  if (!rawProbs || typeof rawProbs !== "object") return null;
  if (!Array.isArray(rawProbs)) return /** @type {Record<string, number>} */ (rawProbs);
  /** @type {Record<string, number>} */
  const map = {};
  for (const entry of rawProbs) {
    if (!entry || typeof entry !== "object") continue;
    const prob = finiteNumber(entry.probability ?? entry.prob ?? entry.p);
    if (prob === null) continue;
    if (typeof entry.label === "string" && entry.label) map[entry.label] = prob;
    if (typeof entry.value === "string" && entry.value) map[entry.value] = prob;
    else if (typeof entry.value === "number" && Number.isFinite(entry.value)) {
      map[String(entry.value)] = prob;
    }
    if (typeof entry.index === "number" && Number.isFinite(entry.index)) {
      map[String(entry.index)] = prob;
    }
  }
  return map;
}

/**
 * Normalize a `noul` (yes/no or predicate) answer.
 * @param {Record<string, any>} raw
 * @param {string} questionName
 */
export function normalizeNoulAnswer(raw, questionName) {
  if (!raw || typeof raw !== "object") {
    throw new DecisionError(
      ERROR_CODES.MALFORMED_RESPONSE,
      `question '${questionName}': missing noul answer object`,
    );
  }

  let pYes = finiteNumber(raw.noul);
  if (pYes === null) pYes = finiteNumber(raw.probability_yes);
  if (pYes === null) pYes = finiteNumber(raw.probability);
  if (pYes === null && typeof raw.result === "number" && Number.isFinite(raw.result)) {
    pYes = raw.result;
  }
  if (pYes === null && raw.probabilities && typeof raw.probabilities === "object") {
    const fromProbs =
      finiteNumber(raw.probabilities.yes) ??
      finiteNumber(raw.probabilities.true) ??
      finiteNumber(raw.probabilities.Yes) ??
      finiteNumber(raw.probabilities.True);
    if (fromProbs !== null) pYes = fromProbs;
  }
  if (pYes === null && typeof raw.result === "boolean") {
    const conf = finiteNumber(raw.confidence);
    if (conf !== null) {
      pYes = raw.result ? clampProb(conf) : clampProb(1 - conf);
    } else {
      pYes = raw.result ? 1 : 0;
    }
  }

  if (pYes === null || pYes < 0 || pYes > 1) {
    throw new DecisionError(
      ERROR_CODES.MALFORMED_RESPONSE,
      `question '${questionName}': invalid noul probability in upstream response`,
    );
  }

  const pYesRounded = round4(pYes);
  const pNoRounded = round4(clampProb(1 - pYes));
  const answer = pYes >= 0.5 ? "yes" : "no";
  const confidence = round4(Math.max(pYes, 1 - pYes));

  /** @type {Record<string, any>} */
  const out = {
    answer,
    probability_yes: pYesRounded,
    probabilities: {
      yes: pYesRounded,
      no: pNoRounded,
    },
    confidence,
    provider_confidence: extractProviderConfidence(raw),
  };
  if (raw.truncated) out.truncated = true;
  return out;
}

/**
 * Normalize a `choice` answer.
 * @param {Record<string, any>} raw
 * @param {{ type: "choice", options: string[] }} question
 * @param {string} questionName
 */
export function normalizeChoiceAnswer(raw, question, questionName) {
  if (!raw || typeof raw !== "object") {
    throw new DecisionError(
      ERROR_CODES.MALFORMED_RESPONSE,
      `question '${questionName}': missing choice answer object`,
    );
  }

  const rawProbs = toProbLookup(raw.probabilities);
  /** @type {Record<string, number>} */
  const probabilities = {};
  let hasAnyProb = false;

  if (rawProbs) {
    for (const opt of question.options) {
      const val = finiteNumber(rawProbs[opt]);
      if (val !== null) {
        probabilities[opt] = round4(clampProb(val));
        hasAnyProb = true;
      } else {
        probabilities[opt] = 0;
      }
    }
  }

  const upstreamChoice =
    typeof raw.choice === "string"
      ? raw.choice
      : typeof raw.selected_option === "string"
        ? raw.selected_option
        : typeof raw.selected === "string"
          ? raw.selected
          : typeof raw.result === "string"
            ? raw.result
            : null;

  if (!hasAnyProb) {
    if (!upstreamChoice || !question.options.includes(upstreamChoice)) {
      throw new DecisionError(
        ERROR_CODES.MALFORMED_RESPONSE,
        `question '${questionName}': upstream choice response missing both valid probabilities and valid choice`,
      );
    }
    const providerConf = finiteNumber(raw.confidence);
    const winProb = providerConf !== null ? clampProb(providerConf) : 1;
    const rem = question.options.length > 1 ? (1 - winProb) / (question.options.length - 1) : 0;
    for (const opt of question.options) {
      probabilities[opt] = round4(opt === upstreamChoice ? winProb : rem);
    }
  }

  // Pick top option from probabilities; break ties in favor of upstreamChoice if valid
  let topOpt = question.options[0];
  let topProb = probabilities[topOpt] ?? -1;
  for (const opt of question.options) {
    const p = probabilities[opt] ?? 0;
    if (p > topProb || (p === topProb && opt === upstreamChoice)) {
      topProb = p;
      topOpt = opt;
    }
  }

  const choice =
    upstreamChoice &&
    question.options.includes(upstreamChoice) &&
    Math.abs((probabilities[upstreamChoice] ?? 0) - topProb) < 1e-6
      ? upstreamChoice
      : topOpt;

  const confidence = round4(probabilities[choice] ?? topProb);

  /** @type {Record<string, any>} */
  const out = {
    choice,
    probabilities,
    confidence,
    provider_confidence: extractProviderConfidence(raw),
  };
  if (raw.truncated) out.truncated = true;
  return out;
}

/**
 * Normalize a `score` answer across Gemini (expected float + legend),
 * OpenDecider (integer argmax `score` + `expected` + `legend` + index-keyed probs),
 * TypeSafe Jev, Perplexity, and OpenAI Decisions.
 *
 * @param {Record<string, any>} raw
 * @param {{ type: "score", levels: Array<{ label: string, description: string }> }} question
 * @param {string} questionName
 */
export function normalizeScoreAnswer(raw, question, questionName) {
  if (!raw || typeof raw !== "object") {
    throw new DecisionError(
      ERROR_CODES.MALFORMED_RESPONSE,
      `question '${questionName}': missing score answer object`,
    );
  }

  const labels = question.levels.map((l) => l.label);
  const descriptions = question.levels.map((l) => l.description);
  const rawProbs = toProbLookup(raw.probabilities);
  const legend = raw.legend && typeof raw.legend === "object" ? raw.legend : null;

  /** @type {number[]} */
  const probsByIndex = new Array(labels.length).fill(0);
  let probSum = 0;

  if (rawProbs) {
    for (let i = 0; i < labels.length; i++) {
      const idxKey = String(i);
      const label = labels[i];
      const desc = descriptions[i];
      const legendLabel = legend && typeof legend[idxKey] === "string" ? legend[idxKey] : null;

      let v = finiteNumber(rawProbs[label]);
      if (v === null && desc !== label) v = finiteNumber(rawProbs[desc]);
      if (v === null && legendLabel) v = finiteNumber(rawProbs[legendLabel]);
      if (v === null) v = finiteNumber(rawProbs[idxKey]);

      if (v !== null) {
        const clamped = clampProb(v);
        probsByIndex[i] = clamped;
        probSum += clamped;
      }
    }
  }

  /** @type {Record<string, number>} */
  const probabilities = {};
  let level = 0;
  let expectedLevel;

  if (probSum > 0) {
    // Re-normalize tiny floating drift only if close to 1; preserve exact probabilities otherwise
    const scale = Math.abs(probSum - 1) <= 0.05 ? 1 / probSum : 1;
    let bestProb = -1;
    let weightedSum = 0;
    for (let i = 0; i < labels.length; i++) {
      const p = probsByIndex[i] * scale;
      probabilities[labels[i]] = round4(p);
      weightedSum += i * p;
      if (p > bestProb) {
        bestProb = p;
        level = i;
      }
    }
    expectedLevel = round4(weightedSum);
  } else {
    // Fallback when an upstream (like minimal Jev reply) omits per-level probabilities
    const upstreamExpected =
      finiteNumber(raw.expected) ??
      finiteNumber(raw.expected_level) ??
      finiteNumber(raw.score) ??
      finiteNumber(raw.result);
    if (upstreamExpected === null) {
      throw new DecisionError(
        ERROR_CODES.MALFORMED_RESPONSE,
        `question '${questionName}': upstream score response missing probabilities and numeric score`,
      );
    }
    expectedLevel = round4(Math.max(0, Math.min(labels.length - 1, upstreamExpected)));
    level = Math.max(0, Math.min(labels.length - 1, Math.round(expectedLevel)));
    for (let i = 0; i < labels.length; i++) {
      probabilities[labels[i]] = i === level ? 1 : 0;
    }
  }

  const label = labels[level];
  const confidence = round4(probabilities[label] ?? 0);

  /** @type {Record<string, any>} */
  const out = {
    level,
    label,
    expected_level: expectedLevel,
    score: expectedLevel,
    probabilities,
    confidence,
    provider_confidence: extractProviderConfidence(raw),
  };
  if (raw.truncated) out.truncated = true;
  return out;
}

/**
 * Normalize token usage metadata across Gemini, OpenAI, System One, and Magpie shapes.
 * @param {Record<string, any>} rawResponse
 */
export function normalizeUsage(rawResponse) {
  if (!rawResponse || typeof rawResponse !== "object") return undefined;
  const u = rawResponse.usage || rawResponse.usageMetadata;
  if (!u || typeof u !== "object") return undefined;

  const input =
    finiteNumber(u.input_tokens) ??
    finiteNumber(u.prompt_tokens) ??
    finiteNumber(u.promptTokenCount);
  const output =
    finiteNumber(u.output_tokens) ??
    finiteNumber(u.completion_tokens) ??
    finiteNumber(u.candidatesTokenCount) ??
    0;
  const total =
    finiteNumber(u.total_tokens) ??
    finiteNumber(u.totalTokenCount) ??
    (input !== null ? input + output : null);

  if (input === null && total === null) return undefined;
  return {
    input_tokens: input ?? total,
    output_tokens: output,
    total_tokens: total ?? (input ?? 0) + output,
  };
}

/**
 * Convert upstream answers container (either map { [key]: ans } or array [{ name, ... }])
 * into a keyed map.
 * @param {unknown} rawAnswers
 * @returns {Record<string, any>}
 */
function indexRawAnswers(rawAnswers) {
  if (!rawAnswers) {
    throw new DecisionError(ERROR_CODES.MALFORMED_RESPONSE, "upstream response missing 'answers'");
  }
  if (Array.isArray(rawAnswers)) {
    /** @type {Record<string, any>} */
    const map = {};
    for (const item of rawAnswers) {
      if (item && typeof item === "object" && typeof item.name === "string") {
        map[item.name] = item;
      }
    }
    return map;
  }
  if (typeof rawAnswers === "object") {
    return /** @type {Record<string, any>} */ (rawAnswers);
  }
  throw new DecisionError(ERROR_CODES.MALFORMED_RESPONSE, "upstream 'answers' must be an object or array");
}

/**
 * Normalize an entire multi-question response from any backend.
 * @param {Record<string, any>} rawResponse
 * @param {Record<string, any>} canonicalQuestions
 * @param {{ backend: string, model: string, dataDestination: string, latencyMs: number, fallbackUsed?: boolean, fallbackInfo?: Record<string, any>, warnings?: string[] }} meta
 */
export function normalizeDecisionResponse(rawResponse, canonicalQuestions, meta) {
  if (!rawResponse || typeof rawResponse !== "object") {
    throw new DecisionError(ERROR_CODES.MALFORMED_RESPONSE, "upstream returned non-object JSON payload", {
      backend: meta.backend,
      model: meta.model,
    });
  }

  const rawMap = indexRawAnswers(rawResponse.answers);
  /** @type {Record<string, any>} */
  const answers = {};

  for (const [qKey, qDef] of Object.entries(canonicalQuestions)) {
    const rawAns = rawMap[qKey];
    if (!rawAns) {
      throw new DecisionError(
        ERROR_CODES.MALFORMED_RESPONSE,
        `upstream response omitted answer for question '${qKey}'`,
        { backend: meta.backend, model: meta.model },
      );
    }
    if (qDef.type === "noul") {
      answers[qKey] = normalizeNoulAnswer(rawAns, qKey);
    } else if (qDef.type === "choice") {
      answers[qKey] = normalizeChoiceAnswer(rawAns, qDef, qKey);
    } else {
      answers[qKey] = normalizeScoreAnswer(rawAns, qDef, qKey);
    }
  }

  const resolvedModel =
    typeof rawResponse.model === "string" && rawResponse.model.trim()
      ? rawResponse.model.trim()
      : meta.model;

  /** @type {Record<string, any>} */
  const out = {
    backend: meta.backend,
    model: resolvedModel,
    data_destination: meta.dataDestination,
    fallback_used: meta.fallbackUsed === true,
    answers,
    latency_ms: Math.round(meta.latencyMs * 10) / 10,
  };

  if (meta.fallbackUsed && meta.fallbackInfo) {
    out.fallback_info = meta.fallbackInfo;
  }
  const usage = normalizeUsage(rawResponse);
  if (usage) out.usage = usage;

  const warnings = [
    ...(Array.isArray(rawResponse.warnings) ? rawResponse.warnings : []),
    ...(Array.isArray(meta.warnings) ? meta.warnings : []),
  ];
  if (warnings.length > 0) out.warnings = warnings;

  return out;
}
