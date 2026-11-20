import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config/load.mjs";
import { createTools } from "../src/core/tools.mjs";

async function startMock(handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = Buffer.concat(chunks).toString("utf8");
    const body = text ? JSON.parse(text) : null;
    await handler(req, res, body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

describe("standalone MCP (no Magpie) & custom third-party gateways", () => {
  let gatewaySrv;
  let localSrv;
  let tmpDir;
  let gatewayHits = [];

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ldm-standalone-"));

    gatewaySrv = await startMock(async (req, res, body) => {
      gatewayHits.push({
        url: req.url,
        auth: req.headers.authorization,
        tenant: req.headers["x-gateway-tenant"],
        model: body?.model,
      });
      if (body?.model === "fail-503") {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "gateway unavailable" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          model: body.model,
          answers: [
            {
              name: "choice",
              type: "choice",
              choice: "approve",
              confidence: 0.94,
              probabilities: [
                { value: "approve", probability: 0.94 },
                { value: "reject", probability: 0.06 },
              ],
            },
          ],
          usage: { prompt_tokens: 28, total_tokens: 28 },
        }),
      );
    });

    localSrv = await startMock(async (req, res, body) => {
      if (req.url === "/ready") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ready: true }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          model: "local-small",
          answers: {
            choice: {
              type: "choice",
              choice: "approve",
              probabilities: { approve: 0.82, reject: 0.18 },
              confidence: 0.82,
            },
          },
        }),
      );
    });
  });

  after(async () => {
    await Promise.all([gatewaySrv.close(), localSrv.close()]);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("auto-disables Magpie and defaults to local_only when running standalone with no Magpie and no cloud keys", () => {
    const cfg = loadConfig({
      configPath: path.join(tmpDir, "missing.json"),
      secretsPath: path.join(tmpDir, "missing-secrets.json"),
      magpieAvailable: false,
      env: { OPENDECIDER_URL: localSrv.url },
    });

    assert.equal(cfg.backends.magpie.enabled, false);
    assert.equal(cfg.defaultBackend, "local-opendecider");
    assert.equal(cfg.routingMode, "local_only");
  });

  it("auto-selects direct cloud backend (e.g. google-direct) with local fallback when Magpie is absent", () => {
    const cfg = loadConfig({
      configPath: path.join(tmpDir, "missing.json"),
      secretsPath: path.join(tmpDir, "missing-secrets.json"),
      magpieAvailable: false,
      env: { GEMINI_API_KEY: "test-gemini-key", OPENDECIDER_URL: localSrv.url },
    });

    assert.equal(cfg.backends.magpie.enabled, false);
    assert.equal(cfg.defaultBackend, "google-direct");
    assert.equal(cfg.defaultModel, "gemini-decision-1");
    assert.equal(cfg.routingMode, "api_with_local_fallback");
  });

  it("connects to custom third-party Decisions gateway (e.g. LiteLLM/TrueFoundry) with custom path/headers and local fallback", async () => {
    gatewayHits = [];
    const cfgPath = path.join(tmpDir, "custom-gw.json");
    await fs.writeFile(
      cfgPath,
      JSON.stringify({
        version: 1,
        routingMode: "api_with_local_fallback",
        defaultBackend: "litellm-gw",
        fallbackBackend: "local-opendecider",
        backends: {
          magpie: { type: "magpie", enabled: false },
          "litellm-gw": {
            type: "openai-decisions",
            enabled: true,
            baseUrl: gatewaySrv.url,
            endpointPath: "/proxy/v1/decisions",
            defaultModel: "gemini/gemini-decision-1",
            apiKeyEnv: "CUSTOM_GW_KEY",
            allowInsecureHttp: true,
            headers: { "x-gateway-tenant": "team-alpha" },
            dataDestination: "private-network",
          },
          "local-opendecider": {
            type: "systemone",
            enabled: true,
            baseUrl: localSrv.url,
            sendModel: false,
            dataDestination: "on-device",
          },
        },
      }),
    );

    const env = { CUSTOM_GW_KEY: "gw-secret-token" };
    const cfg = loadConfig({
      configPath: cfgPath,
      secretsPath: path.join(tmpDir, "missing-secrets.json"),
      magpieAvailable: false,
      env,
    });
    const { tools } = createTools({ config: cfg, env });

    const okRes = await tools.choose.execute({
      state: "PR passed all CI checks",
      question: "Merge?",
      options: ["approve", "reject"],
    });
    assert.equal(okRes.backend, "litellm-gw");
    assert.equal(okRes.model, "gemini/gemini-decision-1");
    assert.equal(okRes.data_destination, "private-network");
    assert.equal(okRes.choice, "approve");
    assert.equal(okRes.fallback_used, false);
    assert.equal(gatewayHits[0].url, "/proxy/v1/decisions");
    assert.equal(gatewayHits[0].auth, "Bearer gw-secret-token");
    assert.equal(gatewayHits[0].tenant, "team-alpha");

    // 503 on custom gateway -> instant local fallback
    const fbRes = await tools.choose.execute({
      state: "PR passed all CI checks",
      question: "Merge?",
      options: ["approve", "reject"],
      model: "fail-503",
    });
    assert.equal(fbRes.backend, "local-opendecider");
    assert.equal(fbRes.data_destination, "on-device");
    assert.equal(fbRes.fallback_used, true);
    assert.equal(fbRes.choice, "approve");
  });
});
