import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recommendModels } from "../src/wizard/recommend.mjs";

describe("hardware-tiered local model recommendations", () => {
  it("recommends MLX 4-bit primary + Ollama Q8_0 alternative on >=16GB Apple Silicon", () => {
    const rec = recommendModels({
      hardware: {
        platform: "darwin",
        arch: "arm64",
        cpu_cores: 10,
        total_ram_gb: 24,
        free_ram_gb: 10,
        free_disk_gb: 120,
        gpu: { vendor: "apple", accelerator: "metal", unified_memory: true, name: "Apple M4" },
      },
      tools: {
        magpie: { installed: true, gateway_running: true },
        opendecider: { installed: true, running: true, url: "http://127.0.0.1:8001" },
      },
    });

    assert.equal(rec.suggested_routing_mode, "api_with_local_fallback");
    assert.equal(rec.local_recommendations[0].model, "manjunathshiva/opendecider-small-mlx-4bit");
    assert.equal(rec.local_recommendations[1].tier, "alternative");
    assert.ok(rec.notes.some((n) => /already running/i.test(n)));
    assert.ok(rec.notes.some((n) => /LM Studio/i.test(n)));
  });

  it("recommends opendecider-nano when RAM or free disk is constrained", () => {
    const rec = recommendModels({
      hardware: {
        platform: "darwin",
        arch: "arm64",
        cpu_cores: 8,
        total_ram_gb: 6,
        free_ram_gb: 2,
        free_disk_gb: 2.5,
        gpu: { vendor: "apple", accelerator: "metal", unified_memory: true, name: "Apple M1" },
      },
      tools: {},
    });

    assert.equal(rec.local_recommendations[0].model, "manjunathshiva/opendecider-nano");
    assert.ok(rec.notes.some((n) => /Low free disk/i.test(n)));
  });

  it("recommends full opendecider-small on NVIDIA >=6GB VRAM and nano on CPU-only Linux", () => {
    const cudaRec = recommendModels({
      hardware: {
        platform: "linux",
        arch: "x64",
        cpu_cores: 16,
        total_ram_gb: 32,
        free_ram_gb: 20,
        free_disk_gb: 200,
        gpu: { vendor: "nvidia", accelerator: "cuda", unified_memory: false, name: "RTX 4070", vram_gb: 12 },
      },
      tools: {},
    });
    assert.equal(cudaRec.local_recommendations[0].model, "manjunathshiva/opendecider-small");

    const cpuRec = recommendModels({
      hardware: {
        platform: "linux",
        arch: "x64",
        cpu_cores: 4,
        total_ram_gb: 8,
        free_ram_gb: 4,
        free_disk_gb: 50,
        gpu: { vendor: "none", accelerator: "cpu", unified_memory: false, name: null, vram_gb: null },
      },
      tools: {},
    });
    assert.equal(cpuRec.local_recommendations[0].model, "manjunathshiva/opendecider-nano");
  });
});
