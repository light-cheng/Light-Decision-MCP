import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config/load.mjs";
import {
  createSecretResolver,
  removeFileSecret,
  setFileSecret,
} from "../src/config/secrets.mjs";
import { createTools } from "../src/core/tools.mjs";

describe("config precedence, hot-reload, and 0600 local secrets", () => {
  let tmpDir;
  let configPath;
  let secretsPath;
  let magpieDir;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ldm-hot-"));
    configPath = path.join(tmpDir, "config.json");
    secretsPath = path.join(tmpDir, "secrets.json");
    magpieDir = path.join(tmpDir, "magpie");
    await fs.mkdir(magpieDir, { recursive: true });
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("empty magpie.options placeholders do NOT clobber ~/.config/light-decision-mcp/config.json", async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        routingMode: "local_only",
        defaultBackend: "local-opendecider",
        fallbackOnNotConfigured: true,
        timeoutMs: 12000,
      }),
    );

    const cfg = loadConfig({
      configPath,
      secretsPath,
      env: {},
      pluginOptions: {
        routingMode: "",
        defaultBackend: "",
        defaultModel: "",
        fallbackBackend: "",
        fallbackOnNotConfigured: null,
        maxDataDestination: "",
        timeoutMs: null,
      },
    });

    assert.equal(cfg.routingMode, "local_only");
    assert.equal(cfg.defaultBackend, "local-opendecider");
    assert.equal(cfg.fallbackOnNotConfigured, true);
    assert.equal(cfg.limits.timeoutMs, 12000);
  });

  it("hot-reloads config.json, secrets.json, and live Magpie plugins.json without restart", async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({ version: 1, routingMode: "api_only", defaultBackend: "magpie" }),
    );
    await fs.writeFile(
      path.join(magpieDir, "plugins.json"),
      JSON.stringify({
        plugins: [
          {
            spec: "/path/to/Light-Decision-MCP",
            options: { routingMode: "" },
          },
        ],
      }),
    );

    const instance = createTools({
      configPath,
      secretsPath,
      magpieDir,
      useLiveMagpieOptions: true,
      hotReload: true,
      env: {},
    });

    assert.equal(instance.config.routingMode, "api_only");
    assert.equal(instance.config.backends.perplexity.enabled, false);

    // Wait 20ms to guarantee mtime bump on coarse filesystems, then edit plugins.json + secrets.json
    await new Promise((r) => setTimeout(r, 20));
    await fs.writeFile(
      path.join(magpieDir, "plugins.json"),
      JSON.stringify({
        plugins: [
          {
            spec: "/path/to/Light-Decision-MCP",
            options: { routingMode: "local_only", fallbackOnNotConfigured: true },
          },
        ],
      }),
    );
    setFileSecret("PERPLEXITY_API_KEY", "pplx-local-secret-123", secretsPath);

    assert.equal(instance.config.routingMode, "local_only");
    assert.equal(instance.config.fallbackOnNotConfigured, true);
    assert.equal(instance.config.backends.perplexity.enabled, true);

    const resolver = createSecretResolver({ env: {}, secretsPath, useKeychain: false });
    assert.equal(resolver.get("PERPLEXITY_API_KEY"), "pplx-local-secret-123");
    assert.equal(resolver.sourceOf("PERPLEXITY_API_KEY"), "secrets.json");

    // Env var takes precedence over secrets.json
    const envResolver = createSecretResolver({
      env: { PERPLEXITY_API_KEY: "pplx-from-env" },
      secretsPath,
      useKeychain: false,
    });
    assert.equal(envResolver.get("PERPLEXITY_API_KEY"), "pplx-from-env");
    assert.equal(envResolver.sourceOf("PERPLEXITY_API_KEY"), "env");

    assert.equal(removeFileSecret("PERPLEXITY_API_KEY", secretsPath), true);
    resolver.clearCache();
    assert.equal(resolver.get("PERPLEXITY_API_KEY"), undefined);
  });
});
