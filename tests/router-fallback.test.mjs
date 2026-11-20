import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config/load.mjs";
import { ERROR_CODES } from "../src/core/errors.mjs";
import { createTools } from "../src/core/tools.mjs";

const TINY_PNG_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2dIAAAAASUVORK5CYII=";

async function startMockServer(handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const body = bodyText ? JSON.parse(bodyText) : null;
    await handler(req, res, body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

describe("multi-backend router, circuit breaker, fallback & protocol adapters", () => {
  let magpieState = { mode: "ok", calls: 0, lastBody: null, lastPath: null };
  let localState = { calls: 0, lastBody: null };
  let pplxState = { calls: 0, lastBody: null, lastAuth: null };
  let magpieSrv;
  let localSrv;
  let pplxSrv;
  let tmpDir;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ldm-router-"));

    magpieSrv = await startMockServer(async (req, res, body) => {
      if (req.method === "GET" && req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data:
              magpieState.mode === "unconfigured"
                ? []
                : [
                    {
                      id: "google/gemini-decision-1",
                      native_endpoints: ["/v1/systemone", "/v1/decisions"],
                      modalities: { input: ["text", "image"], output: ["decisions"] },
                    },
                  ],
          }),
        );
        return;
      }

      magpieState.calls += 1;
      magpieState.lastPath = req.url;
      magpieState.lastBody = body;

      if (magpieState.mode === "500") {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "upstream overloaded" } }));
        return;
      }
      if (magpieState.mode === "429") {
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "10" });
        res.end(JSON.stringify({ error: { message: "rate limit exceeded" } }));
        return;
      }
      if (magpieState.mode === "400") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "bad question payload" } }));
        return;
      }
      if (magpieState.mode === "unconfigured") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "magpie has no Jev provider" } }));
        return;
      }
      if (magpieState.mode === "slow") {
        await new Promise((r) => setTimeout(r, 800));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ model: "google/gemini-decision-1", answers: {} }));
        return;
      }

      // Normal response: support both /v1/systemone and /v1/decisions
      if (req.url === "/v1/decisions") {
        const answers = body.questions.map((q) => {
          if (q.type === "predicate") return { name: q.name, type: "predicate", result: 0.92, confidence: 0.95 };
          if (q.type === "choice") {
            const first = q.choices[0].value;
            const probs = Object.fromEntries(
              q.choices.map((c, idx) => [c.value, idx === 0 ? 0.85 : 0.15 / (q.choices.length - 1)]),
            );
            return { name: q.name, type: "choice", result: first, probabilities: probs, confidence: 0.9 };
          }
          const probs = Object.fromEntries(
            q.levels.map((l, idx) => [l.label, idx === q.levels.length - 1 ? 0.8 : 0.2 / (q.levels.length - 1)]),
          );
          return { name: q.name, type: "score", score: 1.75, probabilities: probs, confidence: 0.88 };
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            model: body.model,
            answers,
            usage: { prompt_tokens: 50, total_tokens: 50 },
          }),
        );
        return;
      }

      // /v1/systemone (Gemini-like score with expected score + legend)
      const answers = {};
      for (const [k, q] of Object.entries(body.questions)) {
        if (q.type === "noul") {
          answers[k] = { type: "noul", noul: 0.91, confidence: 0.96 };
        } else if (q.type === "choice") {
          const keys = Object.keys(q.criteria);
          answers[k] = {
            type: "choice",
            choice: keys[0],
            probabilities: Object.fromEntries(keys.map((key, idx) => [key, idx === 0 ? 0.88 : 0.12 / (keys.length - 1)])),
            confidence: 0.93,
          };
        } else {
          const legend = Object.fromEntries(q.criteria.map((c, i) => [String(i), c]));
          answers[k] = {
            type: "score",
            score: 1.85,
            legend,
            probabilities: Object.fromEntries(
              q.criteria.map((c, i) => [c, i === q.criteria.length - 1 ? 0.87 : i === 1 ? 0.11 : 0.02]),
            ),
            confidence: 0.91,
          };
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          model: body.model,
          answers,
          usageMetadata: { promptTokenCount: 33, candidatesTokenCount: 0, totalTokenCount: 33 },
        }),
      );
    });

    localSrv = await startMockServer(async (req, res, body) => {
      if (req.method === "GET" && req.url === "/ready") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ready: true, model: "manjunathshiva/opendecider-small-mlx-4bit" }));
        return;
      }
      localState.calls += 1;
      localState.lastBody = body;

      // OpenDecider wire shape: integer argmax score + expected + index-keyed probs + no model required
      const answers = {};
      for (const [k, q] of Object.entries(body.questions)) {
        if (q.type === "noul") {
          answers[k] = { type: "noul", noul: 0.83, probabilities: { true: 0.83, false: 0.17 }, confidence: 0.83 };
        } else if (q.type === "choice") {
          const keys = Object.keys(q.criteria);
          answers[k] = {
            type: "choice",
            choice: keys[0],
            probabilities: Object.fromEntries(keys.map((key, idx) => [key, idx === 0 ? 0.81 : 0.19 / (keys.length - 1)])),
            confidence: 0.81,
          };
        } else {
          const legend = Object.fromEntries(q.criteria.map((c, i) => [String(i), c]));
          answers[k] = {
            type: "score",
            score: 2,
            expected: 1.85,
            legend,
            probabilities: { "0": 0.02, "1": 0.11, "2": 0.87 },
            confidence: 0.87,
          };
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ model: "manjunathshiva/opendecider-small-mlx-4bit", answers }));
    });

    pplxSrv = await startMockServer(async (req, res, body) => {
      pplxState.calls += 1;
      pplxState.lastBody = body;
      pplxState.lastAuth = req.headers.authorization;
      const firstKey = Object.keys(body.questions)[0];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          model: body.model,
          answers: {
            [firstKey]: { type: "noul", noul: 0.97, confidence: 0.97 },
          },
        }),
      );
    });

    await fs.writeFile(
      path.join(tmpDir, "gateway.json"),
      JSON.stringify({ addr: magpieSrv.url.replace("http://", "") }),
    );
  });

  after(async () => {
    await Promise.all([magpieSrv.close(), localSrv.close(), pplxSrv.close()]);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeEnv(extra = {}) {
    return {
      OPENDECIDER_URL: localSrv.url,
      PERPLEXITY_API_KEY: "pplx-test-token",
      ...extra,
    };
  }

  function makeTools(pluginOptions = {}, extraConfig = {}, clock) {
    const configPath = path.join(tmpDir, `cfg-${Math.random().toString(36).slice(2)}.json`);
    const cfg = loadConfig({
      configPath,
      magpieDir: tmpDir,
      env: makeEnv(),
      pluginOptions,
    });
    if (cfg.backends.perplexity) {
      cfg.backends.perplexity.baseUrl = pplxSrv.url;
      cfg.backends.perplexity.allowInsecureHttp = true;
    }
    Object.assign(cfg, extraConfig);
    return createTools({
      config: cfg,
      magpieDir: tmpDir,
      env: makeEnv(),
      now: clock,
    });
  }

  it("routes text to Magpie /v1/systemone and images to Magpie /v1/decisions (input_image)", async () => {
    magpieState = { mode: "ok", calls: 0, lastBody: null, lastPath: null };
    const { tools } = makeTools({ routingMode: "api_only" });

    const textRes = await tools.score.execute({
      state: { msg: "Server down!" },
      question: "Urgency?",
      levels: ["low", "medium", "high"],
    });
    assert.equal(magpieState.lastPath, "/v1/systemone");
    assert.equal(textRes.backend, "magpie");
    assert.equal(textRes.fallback_used, false);
    assert.equal(textRes.level, 2);
    assert.equal(textRes.label, "high");
    assert.equal(textRes.expected_level, 1.85);
    assert.equal(textRes.usage.output_tokens, 0);

    const imgRes = await tools.yes_no.execute({
      state: "Inspect this screenshot",
      question: "Does it show an error?",
      images: [TINY_PNG_URI],
    });
    assert.equal(magpieState.lastPath, "/v1/decisions");
    assert.equal(magpieState.lastBody.input[0].role, "user");
    assert.equal(magpieState.lastBody.input[0].content[0].type, "input_text");
    assert.equal(magpieState.lastBody.input[0].content[1].type, "input_image");
    assert.equal(imgRes.answer, "yes");
    assert.equal(imgRes.probability_yes, 0.92);
  });

  it("falls back instantly to local OpenDecider on 429, opens circuit, skips primary in 0ms, and recovers after cooldown", async () => {
    let now = 1_000_000;
    magpieState = { mode: "429", calls: 0, lastBody: null, lastPath: null };
    localState = { calls: 0, lastBody: null };

    const { tools } = makeTools(
      { routingMode: "api_with_local_fallback" },
      {},
      () => now,
    );

    // 1st call hits 429 with Retry-After: 10 -> opens circuit immediately & falls back to local
    const r1 = await tools.score.execute({
      state: { text: "Refund please" },
      question: "Urgency?",
      levels: ["low", "medium", "high"],
    });
    assert.equal(magpieState.calls, 1);
    assert.equal(localState.calls, 1);
    assert.equal(localState.lastBody.model, undefined); // sendModel: false for local opendecider
    assert.equal(r1.backend, "local-opendecider");
    assert.equal(r1.data_destination, "on-device");
    assert.equal(r1.fallback_used, true);
    assert.equal(r1.fallback_info.reason, ERROR_CODES.RATE_LIMITED);
    assert.equal(r1.fallback_info.primary_status, 429);
    assert.equal(r1.fallback_info.circuit_state, "open");
    assert.equal(r1.level, 2);
    assert.equal(r1.label, "high");

    // 2nd call during 10s cooldown -> 0ms skip (magpieState.calls stays 1!)
    now += 2_000;
    const r2 = await tools.yes_no.execute({
      state: "Hello",
      question: "Is greeting?",
    });
    assert.equal(magpieState.calls, 1);
    assert.equal(localState.calls, 2);
    assert.equal(r2.fallback_used, true);
    assert.equal(r2.fallback_info.reason, ERROR_CODES.CIRCUIT_OPEN);

    // Status exposes live open circuit
    const st = await tools.status.execute({});
    const magpieStatus = st.backends.find((b) => b.id === "magpie");
    assert.equal(magpieStatus.circuit.state, "open");

    // Advance past 10s cooldown & restore upstream -> half-open probe succeeds and closes circuit
    now += 15_000;
    magpieState.mode = "ok";
    const r3 = await tools.yes_no.execute({ state: "Back online", question: "Online?" });
    assert.equal(magpieState.calls, 2);
    assert.equal(r3.backend, "magpie");
    assert.equal(r3.fallback_used, false);
  });

  it("falls back on primary timeout and refuses silent image drop unless explicitly opted in", async () => {
    magpieState = { mode: "slow", calls: 0, lastBody: null, lastPath: null };
    localState = { calls: 0, lastBody: null };

    const { tools } = makeTools({
      routingMode: "api_with_local_fallback",
      primaryTimeoutMs: 150,
      fallbackTimeoutMs: 2_000,
    });

    // Text request times out on primary -> local answers
    const textRes = await tools.yes_no.execute({ state: "timeout test", question: "Fallback works?" });
    assert.equal(textRes.backend, "local-opendecider");
    assert.equal(textRes.fallback_used, true);
    assert.equal(textRes.fallback_info.reason, ERROR_CODES.TIMEOUT);

    // Image request on primary timeout -> REFUSES silent image drop by default
    magpieState.mode = "500";
    const imgErr = await tools.yes_no.execute({
      state: "Check image",
      question: "Has hazard?",
      images: [TINY_PNG_URI],
    });
    assert.ok(imgErr.error);
    assert.equal(imgErr.error.fallback.attempted, false);
    assert.equal(imgErr.error.fallback.skipped_reason, ERROR_CODES.IMAGES_UNSUPPORTED);

    // Explicit opt-in allows falling back without images with warning
    const imgOptIn = await tools.yes_no.execute({
      state: "Check image",
      question: "Has hazard?",
      images: [TINY_PNG_URI],
      allow_image_drop_on_fallback: true,
    });
    assert.equal(imgOptIn.backend, "local-opendecider");
    assert.equal(imgOptIn.fallback_used, true);
    assert.ok(imgOptIn.warnings.some((w) => /images omitted/i.test(w)));
  });

  it("never falls back on 400 invalid_arguments or caller abort, and enforces local_only / data_boundary_exceeded", async () => {
    magpieState = { mode: "400", calls: 0, lastBody: null, lastPath: null };
    localState = { calls: 0, lastBody: null };
    const { tools } = makeTools({ routingMode: "api_with_local_fallback" });

    const err400 = await tools.yes_no.execute({ state: "bad", question: "Bad?" });
    assert.equal(err400.error.code, ERROR_CODES.INVALID_ARGUMENTS);
    assert.equal(localState.calls, 0);

    // Caller abort -> immediate caller_aborted, zero fallback
    const ac = new AbortController();
    ac.abort();
    const aborted = await tools.yes_no.execute({ state: "cancel", question: "Cancel?" }, { abort: ac.signal });
    assert.equal(aborted.error.code, ERROR_CODES.CALLER_ABORTED);
    assert.equal(localState.calls, 0);

    // local_only forces on-device and blocks cloud backend override
    const localRes = await tools.choose.execute({
      state: "Local only test",
      question: "Route?",
      options: ["a", "b"],
      mode: "local_only",
    });
    assert.equal(localRes.backend, "local-opendecider");
    assert.equal(localRes.data_destination, "on-device");

    const blocked = await tools.yes_no.execute({
      state: "Secret code",
      question: "Leak?",
      backend: "magpie",
      max_data_destination: "on-device",
    });
    assert.equal(blocked.error.code, ERROR_CODES.DATA_BOUNDARY_EXCEEDED);
  });

  it("supports Perplexity Decisions with web_grounding and batch mid-flight circuit fallback", async () => {
    pplxState = { calls: 0, lastBody: null, lastAuth: null };
    const { tools } = makeTools({ routingMode: "api_with_local_fallback" });

    const pplxRes = await tools.yes_no.execute({
      state: "Did company X ship v2?",
      question: "Is live?",
      backend: "perplexity",
      web_grounding: true,
    });
    assert.equal(pplxRes.backend, "perplexity");
    assert.equal(pplxRes.answer, "yes");
    assert.equal(pplxState.lastBody.mode, "web_grounding");
    assert.equal(pplxState.lastAuth, "Bearer pplx-test-token");

    // Batch fallback on 503
    magpieState = { mode: "500", calls: 0, lastBody: null, lastPath: null };
    localState = { calls: 0, lastBody: null };
    const batchRes = await tools.decide_batch.execute({
      states: ["s1", "s2", "s3", "s4"],
      questions: { ok: { type: "noul", instructions: "OK?" } },
    });
    assert.equal(batchRes.results.length, 4);
    assert.equal(batchRes.fallback_used, true);
    assert.equal(batchRes.fallback_count, 4);
    assert.equal(batchRes.results.every((r) => r.answers.ok.answer === "yes"), true);
  });

  it("handles Magpie unconfigured 404 with setup hint and respects fallbackOnNotConfigured", async () => {
    magpieState = { mode: "unconfigured", calls: 0, lastBody: null, lastPath: null };
    localState = { calls: 0, lastBody: null };

    const { tools: strictTools } = makeTools({
      routingMode: "api_with_local_fallback",
      fallbackOnNotConfigured: false,
    });
    const res1 = await strictTools.yes_no.execute({ state: "hi", question: "Hi?" });
    assert.equal(res1.error.code, ERROR_CODES.NOT_CONFIGURED);
    assert.match(res1.error.hint, /magpie provider add google/i);
    assert.equal(localState.calls, 0);

    const { tools: softTools } = makeTools({
      routingMode: "api_with_local_fallback",
      fallbackOnNotConfigured: true,
    });
    const res2 = await softTools.yes_no.execute({ state: "hi", question: "Hi?" });
    assert.equal(res2.backend, "local-opendecider");
    assert.equal(res2.fallback_used, true);
    assert.equal(res2.fallback_info.reason, ERROR_CODES.NOT_CONFIGURED);
  });

  it("strips accidental plaintext apiKey from user config with warning", async () => {
    const cfgFile = path.join(tmpDir, "bad-key-config.json");
    await fs.writeFile(
      cfgFile,
      JSON.stringify({
        version: 1,
        backends: {
          perplexity: { type: "perplexity", enabled: true, apiKey: "sk-plaintext-leak", apiKeyEnv: "PERPLEXITY_API_KEY" },
        },
      }),
    );
    const loaded = loadConfig({ configPath: cfgFile, env: {} });
    assert.equal("apiKey" in loaded.backends.perplexity, false);
    assert.ok(loaded.configWarnings.some((w) => /plaintext 'apiKey'/i.test(w)));
  });

  it("transparently aliases non-ASCII/spaced question IDs to wire-safe [A-Za-z0-9_-]+ and restores keys", async () => {
    magpieState = { mode: "ok", calls: 0, lastBody: null, lastPath: null };
    const { tools } = makeTools({ routingMode: "api_only" });

    const res = await tools.decide.execute({
      state: "支付接口超时 5 分钟",
      questions: {
        "是否紧急？": { type: "noul", instructions: "是否需要立刻响应？" },
        "team routing": { type: "choice", instructions: "分给谁？", criteria: ["sre", "billing"] },
      },
    });

    const wireKeys = Object.keys(magpieState.lastBody.questions);
    assert.ok(wireKeys.every((k) => /^[A-Za-z0-9_-]{1,64}$/.test(k)));
    assert.equal(res.answers["是否紧急？"].answer, "yes");
    assert.equal(res.answers["team routing"].choice, "sre");
  });
});
