/**
 * Pure, deterministic local decision model recommendation engine driven by
 * real measured host hardware (OS, arch, RAM, GPU/VRAM, free disk, existing tools).
 */

/**
 * Recommend local decision models and deployment strategies for the measured environment.
 * @param {Awaited<ReturnType<import("./hardware.mjs").probeHostEnvironment>>} envReport
 */
export function recommendModels(envReport) {
  const hw = envReport.hardware;
  const tools = envReport.tools || {};
  const isAppleSilicon = hw.platform === "darwin" && hw.arch === "arm64";
  const isNvidia = hw.gpu?.vendor === "nvidia";
  const vramGb = hw.gpu?.vram_gb ?? 0;
  const ramGb = hw.total_ram_gb ?? 0;
  const freeDiskGb = hw.free_disk_gb;

  /** @type {Array<{
   *   tier: "primary" | "alternative" | "lightweight",
   *   model: string,
   *   runtime: string,
   *   approx_memory_gb: number,
   *   approx_disk_gb: number,
   *   reason: string,
   *   install_steps: string[],
   *   serve_command: string,
   * }>} */
  const localRecommendations = [];
  /** @type {string[]} */
  const notes = [];
  /** @type {string[]} */
  const notesZh = [];

  if (freeDiskGb !== null && freeDiskGb < 4) {
    notes.push(
      `Low free disk space measured (${freeDiskGb} GB). Prefer opendecider-nano (~1 GB) or cloud APIs until space is freed.`,
    );
    notesZh.push(
      `当前剩余磁盘空间较少（${freeDiskGb} GB），在释放空间前建议优先使用 opendecider-nano（约 1 GB）或云端 API。`,
    );
  }

  if (isAppleSilicon) {
    if (ramGb >= 16 && (freeDiskGb === null || freeDiskGb >= 6)) {
      localRecommendations.push({
        tier: "primary",
        model: "manjunathshiva/opendecider-small-mlx-4bit",
        runtime: "opendecider (MLX on Apple Silicon)",
        runtime_zh: "opendecider（Apple Silicon MLX 加速）",
        approx_memory_gb: 2.5,
        approx_disk_gb: 2.2,
        reason:
          "Best balance of latency, memory headroom, and calibrated probability quality on >=16 GB Apple Silicon; runs smoothly in the background alongside coding agents.",
        reason_zh:
          "在 ≥16 GB 统一内存的 Apple Silicon 上延迟、内存余量与概率校准精度最均衡；可与各类编程 Agent 长期后台并行运行。",
        install_steps: [
          'uv tool install "opendecider[mlx,serve]"  # or: pip install "opendecider[mlx,serve]"',
        ],
        serve_command:
          "opendecider serve --model manjunathshiva/opendecider-small-mlx-4bit --host 127.0.0.1 --port 8001",
      });
      localRecommendations.push({
        tier: "alternative",
        model: "ollama:opendecider-small (Q8_0 GGUF)",
        runtime: "opendecider serve over Ollama / llama.cpp",
        runtime_zh: "opendecider serve（经由 Ollama / llama.cpp）",
        approx_memory_gb: 4.5,
        approx_disk_gb: 4.3,
        reason:
          "Higher-precision 8-bit quantization (~99% top-answer agreement with PyTorch) when you have >=16 GB unified memory and prefer Ollama model management.",
        reason_zh:
          "更高精度的 8-bit 量化（与 PyTorch 最高答案一致率约 99%），适合 ≥16 GB 统一内存且偏好用 Ollama 统一管理模型的场景。",
        install_steps: [
          "ollama pull hf.co/manjunathshiva/opendecider-small-gguf:Q8_0",
          'uv tool install "opendecider[serve]"',
        ],
        serve_command:
          "opendecider serve --model ollama:opendecider-small --host 127.0.0.1 --port 8001",
      });
      localRecommendations.push({
        tier: "lightweight",
        model: "manjunathshiva/opendecider-nano",
        runtime: "opendecider (ultra-lightweight)",
        runtime_zh: "opendecider（超轻量）",
        approx_memory_gb: 1.0,
        approx_disk_gb: 0.9,
        reason: "Minimal memory footprint (<1 GB) for ultra-low latency or tight disk budgets.",
        reason_zh: "极低内存占用（<1 GB），适合追求极致低延迟或磁盘/内存预算紧张的场景。",
        install_steps: ['uv tool install "opendecider[serve]"'],
        serve_command:
          "opendecider serve --model manjunathshiva/opendecider-nano --host 127.0.0.1 --port 8001",
      });
    } else if (ramGb >= 8 && (freeDiskGb === null || freeDiskGb >= 3.5)) {
      localRecommendations.push({
        tier: "primary",
        model: "manjunathshiva/opendecider-small-mlx-4bit",
        runtime: "opendecider (MLX 4-bit on Apple Silicon)",
        runtime_zh: "opendecider（Apple Silicon MLX 4-bit）",
        approx_memory_gb: 2.5,
        approx_disk_gb: 2.2,
        reason:
          "Fits comfortably in 8–16 GB unified memory via 4-bit MLX quantization while delivering strong classification calibration.",
        reason_zh:
          "4-bit MLX 量化在 8–16 GB 统一内存下运行轻松，同时保留出色的分类概率校准质量。",
        install_steps: ['uv tool install "opendecider[mlx,serve]"'],
        serve_command:
          "opendecider serve --model manjunathshiva/opendecider-small-mlx-4bit --host 127.0.0.1 --port 8001",
      });
      localRecommendations.push({
        tier: "lightweight",
        model: "manjunathshiva/opendecider-nano",
        runtime: "opendecider (ultra-lightweight)",
        runtime_zh: "opendecider（超轻量）",
        approx_memory_gb: 1.0,
        approx_disk_gb: 0.9,
        reason: "Use when multitasking heavily on an 8 GB Mac to avoid swap pressure.",
        reason_zh: "8 GB 内存 Mac 重度多任务时优先选用，避免频繁触发内存交换。",
        install_steps: ['uv tool install "opendecider[serve]"'],
        serve_command:
          "opendecider serve --model manjunathshiva/opendecider-nano --host 127.0.0.1 --port 8001",
      });
    } else {
      localRecommendations.push({
        tier: "primary",
        model: "manjunathshiva/opendecider-nano",
        runtime: "opendecider (lightweight)",
        runtime_zh: "opendecider（轻量版）",
        approx_memory_gb: 1.0,
        approx_disk_gb: 0.9,
        reason:
          "Safest on-device choice when RAM (<8 GB) or free disk space is constrained.",
        reason_zh: "内存小于 8 GB 或剩余磁盘受限时最稳妥的本机运行方案。",
        install_steps: ['uv tool install "opendecider[serve]"'],
        serve_command:
          "opendecider serve --model manjunathshiva/opendecider-nano --host 127.0.0.1 --port 8001",
      });
    }
    notes.push(
      "Note: If using LM Studio as a model server, select its llama.cpp engine (LM Studio's MLX engine does not return top_logprobs).",
    );
    notesZh.push(
      "提示：若通过 LM Studio 托管本地模型，请选择 llama.cpp 引擎（LM Studio 的 MLX 引擎暂不返回 top_logprobs）。",
    );
  } else if (isNvidia && vramGb >= 6) {
    localRecommendations.push({
      tier: "primary",
      model: "manjunathshiva/opendecider-small",
      runtime: "opendecider (CUDA / PyTorch) or Ollama Q8_0",
      runtime_zh: "opendecider（CUDA / PyTorch）或 Ollama Q8_0",
      approx_memory_gb: 4.5,
      approx_disk_gb: 4.5,
      reason: `Measured NVIDIA GPU (${hw.gpu.name || "CUDA"}, ${vramGb} GB VRAM) comfortably runs opendecider-small at high precision and sub-100ms latency.`,
      reason_zh: `实测 NVIDIA 显卡（${hw.gpu.name || "CUDA"}，${vramGb} GB 显存）可轻松以高精度运行 opendecider-small，延迟低于 100 ms。`,
      install_steps: ['uv tool install "opendecider[serve]"'],
      serve_command:
        "opendecider serve --model manjunathshiva/opendecider-small --host 127.0.0.1 --port 8001",
    });
    localRecommendations.push({
      tier: "lightweight",
      model: "manjunathshiva/opendecider-nano",
      runtime: "opendecider (CUDA / CPU)",
      runtime_zh: "opendecider（CUDA / CPU）",
      approx_memory_gb: 1.0,
      approx_disk_gb: 0.9,
      reason: "Saves VRAM for other local workloads.",
      reason_zh: "节省显存，为其他本地推理任务留出余量。",
      install_steps: ['uv tool install "opendecider[serve]"'],
      serve_command:
        "opendecider serve --model manjunathshiva/opendecider-nano --host 127.0.0.1 --port 8001",
    });
  } else {
    localRecommendations.push({
      tier: "primary",
      model: "manjunathshiva/opendecider-nano",
      runtime: "opendecider (CPU / Ollama GGUF)",
      runtime_zh: "opendecider（CPU / Ollama GGUF）",
      approx_memory_gb: 1.0,
      approx_disk_gb: 0.9,
      reason:
        "No Metal/CUDA GPU with >=6 GB VRAM detected; opendecider-nano keeps CPU inference responsive without saturating memory.",
      reason_zh:
        "未检测到 ≥6 GB 显存的 Metal/CUDA GPU；使用 opendecider-nano 可在纯 CPU 下保持流畅响应且不占满内存。",
      install_steps: ['uv tool install "opendecider[serve]"'],
      serve_command:
        "opendecider serve --model manjunathshiva/opendecider-nano --host 127.0.0.1 --port 8001",
    });
    if (ramGb >= 12) {
      localRecommendations.push({
        tier: "alternative",
        model: "ollama:opendecider-small (Q4_K_M / Q8_0 GGUF)",
        runtime: "opendecider serve over Ollama",
        runtime_zh: "opendecider serve（经由 Ollama）",
        approx_memory_gb: 3.5,
        approx_disk_gb: 3.5,
        reason: "Viable on >=12 GB CPU hosts when higher accuracy matters more than latency.",
        reason_zh: "适合 ≥12 GB 内存的纯 CPU 主机，在更看重精度而非速度时可选用。",
        install_steps: [
          "ollama pull hf.co/manjunathshiva/opendecider-small-gguf:Q8_0",
          'uv tool install "opendecider[serve]"',
        ],
        serve_command:
          "opendecider serve --model ollama:opendecider-small --host 127.0.0.1 --port 8001",
      });
    }
  }

  if (tools.opendecider?.running) {
    notes.unshift(
      `Local opendecider is already running and ready at ${tools.opendecider.url} — light-decision-mcp can use it immediately without reinstalling.`,
    );
    notesZh.unshift(
      `本机 opendecider 已在 ${tools.opendecider.url} 运行就绪，light-decision-mcp 可直接使用，无需重复安装。`,
    );
  }

  const cloudOptions = [
    {
      vendor: "Google AI Studio (via Magpie or direct)",
      model: "google/gemini-decision-1",
      strengths: "Multimodal (images), up to 1000 questions/pass, zero output tokens, fast (~150-250ms)",
      data_destination: "third-party",
      setup: tools.magpie?.installed
        ? "magpie provider add google <API_KEY>"
        : "export GEMINI_API_KEY=<API_KEY>",
    },
    {
      vendor: "TypeSafe Jev (via Magpie or direct)",
      model: "typesafe/jev-latest",
      strengths: "Purpose-built System One model, strong JSON state & calibration",
      data_destination: "third-party",
      setup: tools.magpie?.installed
        ? "magpie provider add typesafe <API_KEY>"
        : "export TYPESAFE_API_KEY=<API_KEY>",
    },
    {
      vendor: "Perplexity Decisions API (direct)",
      model: "pplx-decider-v1.3 / pplx-decider-flash-v1.3",
      strengths: "Native Decisions API with optional live web_grounding mode",
      data_destination: "third-party",
      setup: "export PERPLEXITY_API_KEY=<API_KEY>",
    },
    {
      vendor: "OpenAI Decisions API (via Magpie or direct)",
      model: "openai/gpt-6-luna",
      strengths: "Native /v1/decisions with image support and high throughput",
      data_destination: "third-party",
      setup: tools.magpie?.installed
        ? "magpie provider add openai <API_KEY>"
        : "export OPENAI_API_KEY=<API_KEY>",
    },
  ];

  const suggestedRoutingMode =
    tools.opendecider?.running && tools.magpie?.gateway_running
      ? "api_with_local_fallback"
      : tools.opendecider?.running
        ? "local_only"
        : "api_with_local_fallback";

  return {
    hardware_summary: {
      os: `${hw.platform}/${hw.arch}`,
      cpu_cores: hw.cpu_cores,
      ram_gb: hw.total_ram_gb,
      free_disk_gb: hw.free_disk_gb,
      gpu: hw.gpu?.name || hw.gpu?.accelerator || "cpu",
    },
    suggested_routing_mode: suggestedRoutingMode,
    local_recommendations: localRecommendations,
    cloud_options: cloudOptions,
    notes,
    notes_zh: notesZh,
  };
}
