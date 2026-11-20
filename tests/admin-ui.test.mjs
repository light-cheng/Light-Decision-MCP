import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createAdminServer } from "../src/admin/server.mjs";

async function startMockLocal() {
  const srv = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    if (req.url === "/ready") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ready: true, model: "local-test-mlx" }));
      return;
    }
    const qKey = Object.keys(body.questions)[0];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        model: "local-test-mlx",
        answers: {
          [qKey]: {
            type: "noul",
            noul: 0.93,
            probabilities: { true: 0.93, false: 0.07 },
            confidence: 0.93,
          },
        },
      }),
    );
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${srv.address().port}`,
    close: () => new Promise((r) => srv.close(r)),
  };
}

describe("standalone local Web Admin UI (light-decision-mcp ui)", () => {
  let tmpDir;
  let configPath;
  let secretsPath;
  let localSrv;
  let adminSrv;
  let baseUrl;
  let csrfToken;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ldm-admin-"));
    configPath = path.join(tmpDir, "config.json");
    secretsPath = path.join(tmpDir, "secrets.json");
    localSrv = await startMockLocal();

    const created = createAdminServer({
      configPath,
      secretsPath,
      env: { OPENDECIDER_URL: localSrv.url },
      magpieAvailable: false,
      useKeychain: false,
    });
    adminSrv = created.server;
    csrfToken = created.csrfToken;
    await new Promise((r) => adminSrv.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${adminSrv.address().port}`;
  });

  after(async () => {
    await new Promise((r) => adminSrv.close(r));
    await localSrv.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("serves static HTML/CSS/JS/icon with strict CSP header", async () => {
    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    assert.match(htmlRes.headers.get("content-security-policy") || "", /default-src 'self'/);
    const html = await htmlRes.text();
    assert.ok(html.includes("Light Decision MCP"));
    assert.ok(html.includes("presetPicker"));
    assert.ok(html.includes('data-preset="openrouter"'));
    assert.ok(html.includes('data-client="cc-switch"'));

    for (const asset of ["/style.css", "/app.js", "/icon.png"]) {
      const r = await fetch(`${baseUrl}${asset}`);
      assert.equal(r.status, 200, `expected 200 for ${asset}`);
    }
  });

  it("blocks cross-origin requests and missing/wrong CSRF tokens on mutating endpoints", async () => {
    const evilOrigin = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(evilOrigin.status, 403);

    const noCsrf = await fetch(`${baseUrl}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routingMode: "local_only" }),
    });
    assert.equal(noCsrf.status, 403);

    const badCsrf = await fetch(`${baseUrl}/api/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "wrong-token" },
      body: JSON.stringify({ name: "PERPLEXITY_API_KEY", value: "secret" }),
    });
    assert.equal(badCsrf.status, 403);
  });

  it("saves config with custom gateway, strips plaintext apiKey, manages 0600 keys without echoing, and runs live test", async () => {
    const bootRes = await fetch(`${baseUrl}/api/bootstrap`);
    assert.equal(bootRes.status, 200);
    const boot = await bootRes.json();
    assert.equal(boot.csrfToken, csrfToken);
    assert.equal(boot.config.defaultBackend, "local-opendecider");
    assert.ok(boot.keys.some((k) => k.name === "OPENROUTER_API_KEY"));

    // 1. Save config with custom gateway + OpenRouter preset & attempted plaintext apiKey
    const nextCfg = structuredClone(boot.config);
    nextCfg.backends.openrouter = {
      type: "systemone",
      enabled: true,
      baseUrl: "https://openrouter.ai",
      endpointPath: "/api/alpha/decisions",
      defaultModel: "typesafe/jev-1.13",
      apiKeyEnv: "OPENROUTER_API_KEY",
      sendModel: true,
      dataDestination: "third-party",
    };
    nextCfg.backends["custom-gw"] = {
      type: "openai-decisions",
      enabled: true,
      baseUrl: "https://gw.internal.example",
      endpointPath: "/v1/decisions",
      defaultModel: "gemini-decision-1",
      apiKeyEnv: "CUSTOM_GW_API_KEY",
      apiKey: "should-be-stripped",
      dataDestination: "private-network",
    };

    const saveRes = await fetch(`${baseUrl}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify(nextCfg),
    });
    assert.equal(saveRes.status, 200);
    const savedOnDisk = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.equal(savedOnDisk.backends.openrouter.endpointPath, "/api/alpha/decisions");
    assert.equal(savedOnDisk.backends["custom-gw"].baseUrl, "https://gw.internal.example");
    assert.equal("apiKey" in savedOnDisk.backends["custom-gw"], false);

    // 2. Store a direct key -> never echoed in API responses
    const secretVal = "pplx-super-secret-value-999";
    const keyRes = await fetch(`${baseUrl}/api/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ name: "PERPLEXITY_API_KEY", value: secretVal, store: "file" }),
    });
    assert.equal(keyRes.status, 200);
    const keyText = await keyRes.text();
    assert.equal(keyText.includes(secretVal), false);
    const keyJson = JSON.parse(keyText);
    assert.equal(keyJson.keys.find((k) => k.name === "PERPLEXITY_API_KEY").source, "secrets.json");

    // Verify bootstrap also never leaks the secret
    const bootText2 = await (await fetch(`${baseUrl}/api/bootstrap`)).text();
    assert.equal(bootText2.includes(secretVal), false);

    // 3. Delete the key
    const delRes = await fetch(`${baseUrl}/api/keys/PERPLEXITY_API_KEY`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    });
    assert.equal(delRes.status, 200);
    const delJson = await delRes.json();
    assert.equal(delJson.keys.find((k) => k.name === "PERPLEXITY_API_KEY").source, null);

    // 4. Playground live test against local mock OpenDecider
    const testRes = await fetch(`${baseUrl}/api/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({
        tool: "yes_no",
        arguments: {
          state: "Server returning 502 errors",
          question: "Is this an outage?",
          mode: "local_only",
        },
      }),
    });
    assert.equal(testRes.status, 200);
    const testJson = await testRes.json();
    assert.equal(testJson.result.backend, "local-opendecider");
    assert.equal(testJson.result.answer, "yes");
    assert.equal(testJson.result.probability_yes, 0.93);
  });
});
