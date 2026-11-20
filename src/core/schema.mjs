/**
 * Pure JSON Schema tool definitions (zero zod / external deps) and strict
 * runtime argument validation & normalization.
 */

import { DecisionError, ERROR_CODES } from "./errors.mjs";

export const ROUTING_MODES = Object.freeze([
  "api_only",
  "local_only",
  "api_with_local_fallback",
]);

export const DATA_DESTINATIONS = Object.freeze([
  "on-device",
  "private-network",
  "third-party",
]);

export const DEFAULT_LIMITS = Object.freeze({
  questions: 64,
  maxQuestions: 256,
  options: 255,
  stateChars: 200_000,
  images: 4,
  imageMaxBytes: 10 * 1024 * 1024,
  batchStates: 64,
  batchItems: 512,
  batchConcurrency: 4,
  maxBatchConcurrency: 16,
  timeoutMs: 25_000,
  primaryTimeoutMs: 15_000,
  fallbackTimeoutMs: 10_000,
});

const DESTINATION_RANK = Object.freeze({
  "on-device": 0,
  "private-network": 1,
  "third-party": 2,
});

/**
 * @param {string} dest
 * @returns {number}
 */
export function dataDestinationRank(dest) {
  return Object.prototype.hasOwnProperty.call(DESTINATION_RANK, dest)
    ? DESTINATION_RANK[dest]
    : 2;
}

/**
 * @param {string} actual
 * @param {string} maxAllowed
 * @returns {boolean}
 */
export function exceedsDataDestination(actual, maxAllowed) {
  return dataDestinationRank(actual) > dataDestinationRank(maxAllowed);
}

const STATE_SCHEMA = {
  description: "The input context to evaluate: plain text string, JSON object, or JSON array.",
  anyOf: [
    { type: "string" },
    { type: "object", additionalProperties: true },
    { type: "array", items: {} },
  ],
};

const COMMON_ROUTING_PROPS = {
  mode: {
    type: "string",
    enum: [...ROUTING_MODES],
    description:
      "Routing strategy override: api_only, local_only, or api_with_local_fallback.",
  },
  backend: {
    type: "string",
    description:
      "Explicit backend id (e.g. 'magpie', 'local-opendecider', 'typesafe', 'perplexity', 'google-direct', 'openai-direct').",
  },
  model: {
    type: "string",
    description:
      "Model id override (e.g. 'google/gemini-decision-1', 'openai/gpt-6-luna', 'pplx-decider-v1.3', 'group/<name>').",
  },
  max_data_destination: {
    type: "string",
    enum: [...DATA_DESTINATIONS],
    description:
      "Maximum allowed data destination boundary for this call: 'on-device', 'private-network', or 'third-party'.",
  },
  web_grounding: {
    type: "boolean",
    description:
      "Enable web-grounded decisions when supported by the target backend (e.g. Perplexity Decisions API).",
  },
  allow_image_drop_on_fallback: {
    type: "boolean",
    description:
      "Default false. If true and images are passed, permits falling back to a text-only local backend by omitting images.",
  },
};

const IMAGES_PROP = {
  images: {
    type: "array",
    items: { type: "string" },
    description:
      "Optional image inputs (up to 4): local file path (png/jpeg/webp/gif, <=10MB), data:image/...;base64 URI, or https:// URL.",
  },
};

export const TOOL_DESCRIPTIONS = Object.freeze({
  decide:
    "Answer multiple independent typed questions (noul/yes-no, choice, score) over one shared state (and optional images) in a single pass, returning calibrated probabilities and confidence for every question.\n\n" +
    "questions: object mapping question ids to definitions:\n" +
    '  {"type": "noul", "instructions": "Is this urgent?"}\n' +
    '  {"type": "choice", "instructions": "Which team?", "criteria": {"billing": "charges/refunds", "tech": "bugs"}}\n' +
    '  {"type": "score", "instructions": "Severity?", "criteria": ["low", "medium", "high"]} (lowest first)\n' +
    "Supports multi-backend routing (api_only, local_only, api_with_local_fallback) across Magpie gateway, local OpenDecider, TypeSafe Jev, Perplexity, Google & OpenAI.",
  choose:
    "Pick one option from a fixed set for a question about the state (and optional images), returning calibrated probabilities for every option and confidence.\n\n" +
    'options: array of labels ["a", "b"], or object {"label": "short description"} (descriptions help with terse labels).',
  yes_no:
    "Answer a binary yes/no (noul) question about the state (and optional images), returning answer ('yes'|'no'), probability_yes, probabilities ({yes, no}), confidence, and provider_confidence.",
  score:
    "Rate the state (and optional images) on an ordered scale (levels lowest first), returning argmax level & label, probability-weighted expected_level/score, per-level probabilities, and confidence.",
  decide_batch:
    "Evaluate the same typed questions across multiple independent states with bounded concurrency (up to 64 states and 512 total state x question items). Returns one ordered result entry per state.",
  status:
    "Read-only health and capability check (never triggers billable inference). Reports active routing mode, configured & auto-discovered backends, live circuit-breaker states, available decision models, data destinations, multimodal support, limits, and setup hints.",
});

export const TOOL_SCHEMAS = Object.freeze({
  decide: {
    type: "object",
    properties: {
      state: STATE_SCHEMA,
      questions: {
        type: "object",
        description: "Non-empty map of named question definitions (noul, choice, or score).",
        additionalProperties: { type: "object", additionalProperties: true },
      },
      ...IMAGES_PROP,
      ...COMMON_ROUTING_PROPS,
    },
    required: ["state", "questions"],
  },
  choose: {
    type: "object",
    properties: {
      state: STATE_SCHEMA,
      question: { type: "string", description: "Classification prompt / instructions." },
      options: {
        description: 'At least 2 options: array of labels or {"label": "description"} map.',
        anyOf: [
          { type: "array", items: { type: "string" } },
          { type: "object", additionalProperties: { type: "string" } },
        ],
      },
      ...IMAGES_PROP,
      ...COMMON_ROUTING_PROPS,
    },
    required: ["state", "question", "options"],
  },
  yes_no: {
    type: "object",
    properties: {
      state: STATE_SCHEMA,
      question: { type: "string", description: "Yes/no condition or question to evaluate." },
      true_description: {
        type: "string",
        description: "Optional clarification of what counts as 'yes'.",
      },
      false_description: {
        type: "string",
        description: "Optional clarification of what counts as 'no'.",
      },
      ...IMAGES_PROP,
      ...COMMON_ROUTING_PROPS,
    },
    required: ["state", "question"],
  },
  score: {
    type: "object",
    properties: {
      state: STATE_SCHEMA,
      question: { type: "string", description: "Scoring prompt / evaluation rubric." },
      levels: {
        type: "array",
        description:
          "Ordered scale levels from lowest (0) to highest (N-1): strings or {label, description} objects.",
        items: {
          anyOf: [
            { type: "string" },
            {
              type: "object",
              properties: {
                label: { type: "string" },
                description: { type: "string" },
              },
              required: ["label"],
            },
          ],
        },
      },
      ...IMAGES_PROP,
      ...COMMON_ROUTING_PROPS,
    },
    required: ["state", "question", "levels"],
  },
  decide_batch: {
    type: "object",
    properties: {
      states: {
        type: "array",
        description: "Non-empty array of states (plain text or JSON), up to 64 states.",
        items: STATE_SCHEMA,
      },
      questions: {
        type: "object",
        description: "Named question definitions evaluated on every state.",
        additionalProperties: { type: "object", additionalProperties: true },
      },
      ...COMMON_ROUTING_PROPS,
    },
    required: ["states", "questions"],
  },
  status: {
    type: "object",
    properties: {
      backend: {
        type: "string",
        description: "Optional filter to inspect only one backend id.",
      },
      data_destination: {
        type: "string",
        enum: [...DATA_DESTINATIONS],
        description: "Optional filter by data destination boundary.",
      },
      multimodal: {
        type: "boolean",
        description: "Optional filter: true for image-capable backends only, false for text-only.",
      },
    },
  },
});

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Some CLI runners (e.g. `magpie tool`) pass `anyOf` JSON Schema parameters as
 * JSON-encoded strings. Safely parse when a string looks like a JSON array/object.
 * @param {unknown} v
 */
function maybeParseJsonContainer(v) {
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // fall through to normal validation error
    }
  }
  return v;
}

function invalid(message) {
  throw new DecisionError(ERROR_CODES.INVALID_ARGUMENTS, message);
}

function requireNonEmptyString(val, fieldName) {
  if (typeof val !== "string" || !val.trim()) {
    invalid(`'${fieldName}' must be a non-empty string`);
  }
  return val.trim();
}

/**
 * Validate and extract shared routing arguments.
 * @param {Record<string, unknown>} args
 */
export function validateCommonOptions(args) {
  if (!isPlainObject(args)) invalid("arguments must be a JSON object");

  let mode;
  if (args.mode !== undefined && args.mode !== null && args.mode !== "") {
    if (typeof args.mode !== "string" || !ROUTING_MODES.includes(args.mode)) {
      invalid(`'mode' must be one of ${ROUTING_MODES.join(", ")}`);
    }
    mode = args.mode;
  }

  let backend;
  if (args.backend !== undefined && args.backend !== null && args.backend !== "") {
    if (typeof args.backend !== "string" || !args.backend.trim()) {
      invalid("'backend' must be a non-empty string");
    }
    backend = args.backend.trim();
  }

  let model;
  if (args.model !== undefined && args.model !== null && args.model !== "") {
    if (typeof args.model !== "string" || !args.model.trim()) {
      invalid("'model' must be a non-empty string");
    }
    model = args.model.trim();
  }

  let maxDataDestination;
  if (
    args.max_data_destination !== undefined &&
    args.max_data_destination !== null &&
    args.max_data_destination !== ""
  ) {
    if (
      typeof args.max_data_destination !== "string" ||
      !DATA_DESTINATIONS.includes(args.max_data_destination)
    ) {
      invalid(`'max_data_destination' must be one of ${DATA_DESTINATIONS.join(", ")}`);
    }
    maxDataDestination = args.max_data_destination;
  }

  let webGrounding = false;
  if (args.web_grounding !== undefined) {
    if (typeof args.web_grounding !== "boolean") {
      invalid("'web_grounding' must be a boolean");
    }
    webGrounding = args.web_grounding;
  }

  let allowImageDropOnFallback = false;
  if (args.allow_image_drop_on_fallback !== undefined) {
    if (typeof args.allow_image_drop_on_fallback !== "boolean") {
      invalid("'allow_image_drop_on_fallback' must be a boolean");
    }
    allowImageDropOnFallback = args.allow_image_drop_on_fallback;
  }

  return {
    mode,
    backend,
    model,
    maxDataDestination,
    webGrounding,
    allowImageDropOnFallback,
  };
}

/**
 * Validate state (plain text string or JSON object/array) and enforce character budget.
 * @param {unknown} state
 * @param {typeof DEFAULT_LIMITS} [limits]
 * @param {string} [label="state"]
 * @returns {string | object | Array<unknown>}
 */
export function validateState(state, limits = DEFAULT_LIMITS, label = "state") {
  if (state === undefined || state === null) {
    invalid(`'${label}' is required and must be a string, object, or array`);
  }
  if (typeof state === "string") {
    if (!state.trim()) invalid(`'${label}' must not be an empty string`);
    if (state.length > limits.stateChars) {
      invalid(`'${label}' exceeds maximum length of ${limits.stateChars} characters (got ${state.length})`);
    }
    return state;
  }
  if (typeof state !== "object") {
    invalid(`'${label}' must be a string, JSON object, or JSON array`);
  }
  let serialized;
  try {
    serialized = JSON.stringify(state);
  } catch (err) {
    invalid(`'${label}' must be JSON-serializable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (serialized === "{}" || serialized === "[]") {
    invalid(`'${label}' must not be an empty object or array`);
  }
  if (serialized.length > limits.stateChars) {
    invalid(`'${label}' exceeds maximum serialized length of ${limits.stateChars} characters (got ${serialized.length})`);
  }
  return state;
}

/**
 * Normalize a single choice options collection (string[] or Record<string, string>).
 * @param {unknown} raw
 * @param {number} maxOptions
 * @param {string} contextLabel
 * @returns {{ options: string[], criteria: Record<string, string> }}
 */
function normalizeChoiceOptions(raw, maxOptions, contextLabel) {
  raw = maybeParseJsonContainer(raw);
  /** @type {string[]} */
  const options = [];
  /** @type {Record<string, string>} */
  const criteria = {};

  if (Array.isArray(raw)) {
    const seen = new Set();
    for (const item of raw) {
      if (typeof item !== "string" || !item.trim()) {
        invalid(`${contextLabel}: every option label must be a non-empty string`);
      }
      const key = item.trim();
      if (seen.has(key)) {
        invalid(`${contextLabel}: duplicate option label '${key}'`);
      }
      seen.add(key);
      options.push(key);
      criteria[key] = key;
    }
  } else if (isPlainObject(raw)) {
    for (const [rawKey, rawVal] of Object.entries(raw)) {
      const key = rawKey.trim();
      if (!key) invalid(`${contextLabel}: option key must be a non-empty string`);
      if (Object.prototype.hasOwnProperty.call(criteria, key)) {
        invalid(`${contextLabel}: duplicate option key '${key}'`);
      }
      if (rawVal !== null && rawVal !== undefined && typeof rawVal !== "string") {
        invalid(`${contextLabel}: description for option '${key}' must be a string`);
      }
      options.push(key);
      criteria[key] = typeof rawVal === "string" && rawVal.trim() ? rawVal.trim() : key;
    }
  } else {
    invalid(`${contextLabel}: options/criteria must be a non-empty array of strings or object map`);
  }

  if (options.length < 2) {
    invalid(`${contextLabel}: choice requires at least 2 options (got ${options.length})`);
  }
  if (options.length > maxOptions) {
    invalid(`${contextLabel}: at most ${maxOptions} options allowed (got ${options.length})`);
  }
  return { options, criteria };
}

/**
 * Normalize ordered score levels from string[] or {label, description}[].
 * @param {unknown} raw
 * @param {number} maxOptions
 * @param {string} contextLabel
 * @returns {Array<{ label: string, description: string }>}
 */
function normalizeScoreLevels(raw, maxOptions, contextLabel) {
  raw = maybeParseJsonContainer(raw);
  if (!Array.isArray(raw)) {
    invalid(`${contextLabel}: score levels/criteria must be an ordered array of at least 2 items`);
  }
  if (raw.length < 2) {
    invalid(`${contextLabel}: score requires at least 2 ordered levels (got ${raw.length})`);
  }
  if (raw.length > maxOptions) {
    invalid(`${contextLabel}: at most ${maxOptions} levels allowed (got ${raw.length})`);
  }

  const seen = new Set();
  /** @type {Array<{ label: string, description: string }>} */
  const levels = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    let label;
    let description;
    if (typeof item === "string") {
      label = item.trim();
      description = label;
    } else if (isPlainObject(item)) {
      if (typeof item.label !== "string" || !item.label.trim()) {
        invalid(`${contextLabel}: level ${i} must have a non-empty string 'label'`);
      }
      label = item.label.trim();
      if (item.description !== undefined && item.description !== null && typeof item.description !== "string") {
        invalid(`${contextLabel}: level ${i} 'description' must be a string`);
      }
      description =
        typeof item.description === "string" && item.description.trim()
          ? item.description.trim()
          : label;
    } else {
      invalid(`${contextLabel}: level ${i} must be a string or { label, description } object`);
    }

    if (!label) invalid(`${contextLabel}: level ${i} must not be empty`);
    if (seen.has(label)) {
      invalid(`${contextLabel}: score levels must have distinct labels (duplicate '${label}')`);
    }
    seen.add(label);
    levels.push({ label, description });
  }
  return levels;
}

/**
 * Normalize one question definition into the canonical internal format.
 * @param {string} name
 * @param {unknown} rawQ
 * @param {typeof DEFAULT_LIMITS} [limits]
 */
export function normalizeQuestion(name, rawQ, limits = DEFAULT_LIMITS) {
  const ctx = `question '${name}'`;
  if (!isPlainObject(rawQ)) invalid(`${ctx} must be an object`);

  const rawType = rawQ.type === "predicate" ? "noul" : rawQ.type;
  if (rawType !== "noul" && rawType !== "choice" && rawType !== "score") {
    invalid(`${ctx}: 'type' must be 'noul', 'choice', or 'score' (got ${JSON.stringify(rawQ.type)})`);
  }

  const instructionsRaw = rawQ.instructions ?? rawQ.question;
  if (typeof instructionsRaw !== "string" || !instructionsRaw.trim()) {
    invalid(`${ctx}: 'instructions' must be a non-empty string`);
  }
  const instructions = instructionsRaw.trim();

  if (rawType === "noul") {
    /** @type {{ true?: string, false?: string }} */
    const criteria = {};
    if (isPlainObject(rawQ.criteria)) {
      if (typeof rawQ.criteria.true === "string" && rawQ.criteria.true.trim()) {
        criteria.true = rawQ.criteria.true.trim();
      }
      if (typeof rawQ.criteria.false === "string" && rawQ.criteria.false.trim()) {
        criteria.false = rawQ.criteria.false.trim();
      }
    }
    if (typeof rawQ.true_description === "string" && rawQ.true_description.trim()) {
      criteria.true = rawQ.true_description.trim();
    }
    if (typeof rawQ.false_description === "string" && rawQ.false_description.trim()) {
      criteria.false = rawQ.false_description.trim();
    }
    return { type: "noul", instructions, criteria };
  }

  if (rawType === "choice") {
    const rawOpts = rawQ.criteria ?? rawQ.options ?? rawQ.choices;
    const { options, criteria } = normalizeChoiceOptions(rawOpts, limits.options, ctx);
    return { type: "choice", instructions, options, criteria };
  }

  // score
  const rawLevels = rawQ.criteria ?? rawQ.levels;
  const levels = normalizeScoreLevels(rawLevels, limits.options, ctx);
  return { type: "score", instructions, levels };
}

/**
 * Validate a map of named questions.
 * @param {unknown} rawQuestions
 * @param {typeof DEFAULT_LIMITS} [limits]
 */
export function validateQuestionsMap(rawQuestions, limits = DEFAULT_LIMITS) {
  if (!isPlainObject(rawQuestions)) {
    invalid("'questions' must be a non-empty object mapping question ids to question objects");
  }
  const entries = Object.entries(rawQuestions);
  if (entries.length === 0) {
    invalid("'questions' must contain at least 1 question");
  }
  if (entries.length > limits.questions) {
    invalid(`at most ${limits.questions} questions allowed per call (got ${entries.length})`);
  }
  /** @type {Record<string, ReturnType<typeof normalizeQuestion>>} */
  const out = {};
  for (const [key, q] of entries) {
    if (!key.trim()) invalid("question id keys must be non-empty strings");
    out[key] = normalizeQuestion(key, q, limits);
  }
  return out;
}

/**
 * Validate optional images array.
 * @param {unknown} rawImages
 * @param {typeof DEFAULT_LIMITS} [limits]
 * @returns {string[]}
 */
export function validateImageArgs(rawImages, limits = DEFAULT_LIMITS) {
  if (rawImages === undefined || rawImages === null) return [];
  if (!Array.isArray(rawImages)) {
    invalid("'images' must be an array of file paths, data URIs, or https:// URLs");
  }
  if (rawImages.length > limits.images) {
    invalid(`at most ${limits.images} images allowed per call (got ${rawImages.length})`);
  }
  const out = [];
  for (let i = 0; i < rawImages.length; i++) {
    if (typeof rawImages[i] !== "string" || !rawImages[i].trim()) {
      invalid(`images[${i}] must be a non-empty string`);
    }
    out.push(rawImages[i].trim());
  }
  return out;
}

export function validateDecideArgs(args, limits = DEFAULT_LIMITS) {
  const common = validateCommonOptions(args);
  const state = validateState(args.state, limits);
  const questions = validateQuestionsMap(args.questions, limits);
  const images = validateImageArgs(args.images, limits);
  return { state, questions, images, ...common };
}

export function validateChooseArgs(args, limits = DEFAULT_LIMITS) {
  const common = validateCommonOptions(args);
  const state = validateState(args.state, limits);
  const question = requireNonEmptyString(args.question, "question");
  const { options, criteria } = normalizeChoiceOptions(args.options, limits.options, "choose");
  const images = validateImageArgs(args.images, limits);
  return {
    state,
    question: "choice",
    questions: {
      choice: { type: "choice", instructions: question, options, criteria },
    },
    images,
    ...common,
  };
}

export function validateYesNoArgs(args, limits = DEFAULT_LIMITS) {
  const common = validateCommonOptions(args);
  const state = validateState(args.state, limits);
  const question = requireNonEmptyString(args.question, "question");
  /** @type {{ true?: string, false?: string }} */
  const criteria = {};
  if (args.true_description !== undefined && args.true_description !== null) {
    if (typeof args.true_description !== "string") invalid("'true_description' must be a string");
    if (args.true_description.trim()) criteria.true = args.true_description.trim();
  }
  if (args.false_description !== undefined && args.false_description !== null) {
    if (typeof args.false_description !== "string") invalid("'false_description' must be a string");
    if (args.false_description.trim()) criteria.false = args.false_description.trim();
  }
  const images = validateImageArgs(args.images, limits);
  return {
    state,
    question: "yes_no",
    questions: {
      yes_no: { type: "noul", instructions: question, criteria },
    },
    images,
    ...common,
  };
}

export function validateScoreArgs(args, limits = DEFAULT_LIMITS) {
  const common = validateCommonOptions(args);
  const state = validateState(args.state, limits);
  const question = requireNonEmptyString(args.question, "question");
  const levels = normalizeScoreLevels(args.levels, limits.options, "score");
  const images = validateImageArgs(args.images, limits);
  return {
    state,
    question: "score",
    questions: {
      score: { type: "score", instructions: question, levels },
    },
    images,
    ...common,
  };
}

export function validateDecideBatchArgs(args, limits = DEFAULT_LIMITS) {
  const common = validateCommonOptions(args);
  if (!Array.isArray(args.states) || args.states.length === 0) {
    invalid("'states' must be a non-empty array");
  }
  if (args.states.length > limits.batchStates) {
    invalid(`at most ${limits.batchStates} states allowed per batch (got ${args.states.length})`);
  }
  const questions = validateQuestionsMap(args.questions, limits);
  const qCount = Object.keys(questions).length;
  const totalItems = args.states.length * qCount;
  if (totalItems > limits.batchItems) {
    invalid(
      `at most ${limits.batchItems} total state x question items allowed per batch (got ${args.states.length} x ${qCount} = ${totalItems})`,
    );
  }
  const states = args.states.map((s, i) => validateState(s, limits, `states[${i}]`));
  return { states, questions, ...common };
}

export function validateStatusArgs(args = {}) {
  const safe = args === undefined || args === null ? {} : args;
  if (!isPlainObject(safe)) invalid("arguments must be a JSON object");

  let backend;
  if (safe.backend !== undefined && safe.backend !== null && safe.backend !== "") {
    if (typeof safe.backend !== "string" || !safe.backend.trim()) {
      invalid("'backend' must be a non-empty string");
    }
    backend = safe.backend.trim();
  }

  let dataDestination;
  if (
    safe.data_destination !== undefined &&
    safe.data_destination !== null &&
    safe.data_destination !== ""
  ) {
    if (
      typeof safe.data_destination !== "string" ||
      !DATA_DESTINATIONS.includes(safe.data_destination)
    ) {
      invalid(`'data_destination' must be one of ${DATA_DESTINATIONS.join(", ")}`);
    }
    dataDestination = safe.data_destination;
  }

  let multimodal;
  if (safe.multimodal !== undefined && safe.multimodal !== null) {
    if (typeof safe.multimodal !== "boolean") {
      invalid("'multimodal' must be a boolean");
    }
    multimodal = safe.multimodal;
  }

  return { backend, dataDestination, multimodal };
}
