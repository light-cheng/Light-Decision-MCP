import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ERROR_CODES } from "../src/core/errors.mjs";
import {
  normalizeChoiceAnswer,
  normalizeDecisionResponse,
  normalizeNoulAnswer,
  normalizeScoreAnswer,
  normalizeUsage,
} from "../src/core/normalize.mjs";
import {
  validateChooseArgs,
  validateDecideArgs,
  validateDecideBatchArgs,
  validateScoreArgs,
  validateStatusArgs,
  validateYesNoArgs,
} from "../src/core/schema.mjs";

describe("schema validation", () => {
  it("validates decide with noul, choice, and score questions including aliases", () => {
    const res = validateDecideArgs({
      state: { ticket: "Charged twice", amount: 42 },
      questions: {
        refund: {
          type: "noul",
          instructions: "Does user want a refund?",
          true_description: "Explicit refund request",
        },
        team: {
          type: "choice",
          instructions: "Which team?",
          criteria: ["billing", "tech"],
        },
        urgency: {
          type: "score",
          instructions: "How urgent?",
          levels: [{ label: "low", description: "Can wait" }, { label: "high", description: "Immediate" }],
        },
      },
      mode: "api_with_local_fallback",
      max_data_destination: "third-party",
    });

    assert.equal(res.questions.refund.type, "noul");
    assert.equal(res.questions.refund.criteria.true, "Explicit refund request");
    assert.deepEqual(res.questions.team.options, ["billing", "tech"]);
    assert.deepEqual(
      res.questions.urgency.levels.map((l) => l.label),
      ["low", "high"],
    );
  });

  it("parses JSON-stringified options/levels passed by CLI runners such as magpie tool", () => {
    const ch = validateChooseArgs({
      state: "Billed twice",
      question: "Team?",
      options: '{"billing":"refunds","tech":"bugs"}',
    });
    assert.deepEqual(ch.questions[ch.question].options, ["billing", "tech"]);

    const sc = validateScoreArgs({
      state: "Minor typo",
      question: "Severity?",
      levels: '["low","medium","high"]',
    });
    assert.deepEqual(
      sc.questions[sc.question].levels.map((l) => l.label),
      ["low", "medium", "high"],
    );
  });

  it("rejects empty state, duplicate score levels, and <2 options", () => {
    assert.throws(
      () => validateYesNoArgs({ state: "   ", question: "Valid?" }),
      (e) => e.code === ERROR_CODES.INVALID_ARGUMENTS,
    );
    assert.throws(
      () => validateChooseArgs({ state: "hello", question: "Pick?", options: ["only_one"] }),
      (e) => e.code === ERROR_CODES.INVALID_ARGUMENTS,
    );
    assert.throws(
      () => validateScoreArgs({ state: "hello", question: "Rate?", levels: ["low", "low"] }),
      (e) => e.code === ERROR_CODES.INVALID_ARGUMENTS,
    );
  });

  it("enforces batch state x question item limits", () => {
    const states = Array.from({ length: 20 }, (_, i) => `item ${i}`);
    const questions = {};
    for (let i = 0; i < 30; i++) {
      questions[`q${i}`] = { type: "noul", instructions: `Question ${i}?` };
    }
    assert.throws(
      () => validateDecideBatchArgs({ states, questions }),
      (e) => e.code === ERROR_CODES.INVALID_ARGUMENTS && /512/.test(e.message),
    );
  });

  it("validates status filter arguments", () => {
    assert.deepEqual(validateStatusArgs({}), {
      backend: undefined,
      dataDestination: undefined,
      multimodal: undefined,
    });
    assert.deepEqual(
      validateStatusArgs({ backend: "magpie", data_destination: "third-party", multimodal: true }),
      { backend: "magpie", dataDestination: "third-party", multimodal: true },
    );
    assert.throws(
      () => validateStatusArgs({ data_destination: "mars" }),
      (e) => e.code === ERROR_CODES.INVALID_ARGUMENTS,
    );
  });
});

describe("cross-protocol normalization", () => {
  it("normalizes noul from Gemini, OpenDecider, and OpenAI predicate identically", () => {
    const gemini = normalizeNoulAnswer({ type: "noul", noul: 0.94, confidence: 0.98 }, "q");
    const openDecider = normalizeNoulAnswer(
      { type: "noul", noul: 0.94, probabilities: { true: 0.94, false: 0.06 }, confidence: 0.94 },
      "q",
    );
    const openai = normalizeNoulAnswer({ type: "predicate", result: 0.94, confidence: 0.95 }, "q");

    for (const r of [gemini, openDecider, openai]) {
      assert.equal(r.answer, "yes");
      assert.equal(r.probability_yes, 0.94);
      assert.deepEqual(r.probabilities, { yes: 0.94, no: 0.06 });
      assert.equal(r.confidence, 0.94);
    }
    assert.equal(gemini.provider_confidence, 0.98);
    assert.equal(openDecider.provider_confidence, 0.94);
    assert.equal(openai.provider_confidence, 0.95);
  });

  it("aligns Gemini score (expected float + legend) and OpenDecider score (int argmax + index probs) identically", () => {
    const q = {
      type: "score",
      instructions: "Urgency?",
      levels: [
        { label: "low", description: "low" },
        { label: "medium", description: "medium" },
        { label: "high", description: "high" },
      ],
    };

    const geminiRaw = {
      type: "score",
      score: 1.85,
      legend: { "0": "low", "1": "medium", "2": "high" },
      probabilities: { low: 0.02, medium: 0.11, high: 0.87 },
      confidence: 0.91,
    };

    const openDeciderRaw = {
      type: "score",
      score: 2,
      expected: 1.85,
      legend: { "0": "low", "1": "medium", "2": "high" },
      probabilities: { "0": 0.02, "1": 0.11, "2": 0.87 },
      confidence: 0.87,
    };

    const gNorm = normalizeScoreAnswer(geminiRaw, q, "urgency");
    const oNorm = normalizeScoreAnswer(openDeciderRaw, q, "urgency");

    assert.equal(gNorm.level, 2);
    assert.equal(gNorm.label, "high");
    assert.equal(gNorm.expected_level, 1.85);
    assert.equal(gNorm.score, 1.85);
    assert.deepEqual(gNorm.probabilities, { low: 0.02, medium: 0.11, high: 0.87 });
    assert.equal(gNorm.confidence, 0.87);
    assert.equal(gNorm.provider_confidence, 0.91);

    assert.equal(oNorm.level, gNorm.level);
    assert.equal(oNorm.label, gNorm.label);
    assert.equal(oNorm.expected_level, gNorm.expected_level);
    assert.equal(oNorm.score, gNorm.score);
    assert.deepEqual(oNorm.probabilities, gNorm.probabilities);
    assert.equal(oNorm.confidence, gNorm.confidence);
    assert.equal(oNorm.provider_confidence, 0.87);
  });

  it("normalizes OpenAI array-shaped answers and usageMetadata with 0 output tokens", () => {
    const canonical = {
      damaged: { type: "noul", instructions: "Damaged?", criteria: {} },
      queue: {
        type: "choice",
        instructions: "Queue?",
        options: ["billing", "replacements"],
        criteria: { billing: "billing", replacements: "replacements" },
      },
    };
    const raw = {
      model: "google/gemini-decision-1",
      answers: [
        { name: "damaged", type: "predicate", result: 0.98, confidence: 0.99 },
        {
          name: "queue",
          type: "choice",
          result: "replacements",
          probabilities: { billing: 0.01, replacements: 0.99 },
          confidence: 0.99,
        },
      ],
      usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 0, totalTokenCount: 42 },
    };

    const out = normalizeDecisionResponse(raw, canonical, {
      backend: "magpie",
      model: "google/gemini-decision-1",
      dataDestination: "third-party",
      latencyMs: 123.45,
    });

    assert.equal(out.backend, "magpie");
    assert.equal(out.fallback_used, false);
    assert.equal(out.answers.damaged.answer, "yes");
    assert.equal(out.answers.queue.choice, "replacements");
    assert.deepEqual(out.usage, { input_tokens: 42, output_tokens: 0, total_tokens: 42 });
  });

  it("normalizes choice and flags malformed upstream responses", () => {
    const q = { type: "choice", options: ["a", "b"] };
    const ok = normalizeChoiceAnswer({ choice: "b", probabilities: { a: 0.2, b: 0.8 }, confidence: 0.82 }, q, "c");
    assert.equal(ok.choice, "b");
    assert.equal(ok.confidence, 0.8);
    assert.equal(ok.provider_confidence, 0.82);

    assert.throws(
      () => normalizeChoiceAnswer({ choice: "unknown" }, q, "c"),
      (e) => e.code === ERROR_CODES.MALFORMED_RESPONSE,
    );
    assert.equal(normalizeUsage({}), undefined);
  });

  it("normalizes Magpie/OpenAI /v1/decisions array-shaped probabilities for choice and score", () => {
    const choiceQ = { type: "choice", options: ["rotary_dial", "bird", "bar_chart"] };
    const choiceNorm = normalizeChoiceAnswer(
      {
        type: "choice",
        choice: "rotary_dial",
        confidence: 0.9867,
        probabilities: [
          { value: "rotary_dial", probability: 0.9867 },
          { value: "bird", probability: 0.0085 },
          { value: "bar_chart", probability: 0.0048 },
        ],
      },
      choiceQ,
      "obj",
    );
    assert.equal(choiceNorm.choice, "rotary_dial");
    assert.equal(choiceNorm.probabilities.rotary_dial, 0.9867);
    assert.equal(choiceNorm.probabilities.bird, 0.0085);
    assert.equal(choiceNorm.confidence, 0.9867);

    const scoreQ = {
      type: "score",
      levels: [
        { label: "busy", description: "busy" },
        { label: "balanced", description: "balanced" },
        { label: "minimal", description: "minimal" },
      ],
    };
    const scoreNorm = normalizeScoreAnswer(
      {
        type: "score",
        score: 0.9313,
        confidence: 0.4176,
        probabilities: [
          { label: "busy", value: 0, probability: 0.3256 },
          { label: "balanced", value: 1, probability: 0.4176 },
          { label: "minimal", value: 2, probability: 0.2569 },
        ],
      },
      scoreQ,
      "minimalism",
    );
    assert.equal(scoreNorm.level, 1);
    assert.equal(scoreNorm.label, "balanced");
    assert.equal(scoreNorm.probabilities.balanced, 0.4176);
    assert.equal(scoreNorm.confidence, 0.4176);
    assert.equal(scoreNorm.provider_confidence, 0.4176);
  });
});
