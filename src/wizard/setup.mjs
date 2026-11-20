/**
 * CLI workflows:
 * - `doctor`: read-only hardware + recommendations + live backend health report
 * - `recommend`: read-only hardware measurement + tiered local/cloud recommendations
 * - `setup`: confirmation-gated interactive configuration wizard (never writes plaintext API keys)
 */

import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { getDefaultConfigPath, loadConfig, saveConfigFile } from "../config/load.mjs";
import { createSecretResolver } from "../config/secrets.mjs";
import { DecisionRouter } from "../core/router.mjs";
import { probeHostEnvironment } from "./hardware.mjs";
import { recommendModels } from "./recommend.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function formatHardwareLines(envReport) {
  const hw = envReport.hardware;
  const gpuText = hw.gpu?.name
    ? `${hw.gpu.name} (${hw.gpu.accelerator}${hw.gpu.vram_gb ? `, ${hw.gpu.vram_gb} GB VRAM` : hw.gpu.unified_memory ? ", unified memory" : ""})`
    : hw.gpu?.accelerator || "cpu";

  return [
    `OS / Arch     : ${hw.platform}/${hw.arch} (${hw.cpu_cores} cores)`,
    `Memory        : ${hw.total_ram_gb} GB total (${hw.free_ram_gb} GB free)`,
    `Free Disk     : ${hw.free_disk_gb !== null ? `${hw.free_disk_gb} GB` : "unknown"}`,
    `Accelerator   : ${gpuText}`,
  ];
}

function formatRecommendationsText(rec) {
  const lines = [];
  lines.push(`Suggested Routing Mode: ${rec.suggested_routing_mode}`);
  lines.push("");
  lines.push("Recommended Local Models:");
  for (const item of rec.local_recommendations) {
    lines.push(`  [${item.tier.toUpperCase()}] ${item.model} (${item.runtime})`);
    lines.push(`    Footprint : ~${item.approx_memory_gb} GB RAM, ~${item.approx_disk_gb} GB disk`);
    lines.push(`    Why       : ${item.reason}`);
    lines.push(`    Install   : ${item.install_steps.join(" && ")}`);
    lines.push(`    Serve     : ${item.serve_command}`);
  }
  if (rec.notes.length > 0) {
    lines.push("");
    lines.push("Notes:");
    for (const n of rec.notes) lines.push(`  - ${n}`);
  }
  lines.push("");
  lines.push("Cloud Decision API Options (data leaves device -> third-party):");
  for (const c of rec.cloud_options) {
    lines.push(`  - ${c.vendor}: ${c.model}`);
    lines.push(`    Strengths : ${c.strengths}`);
    lines.push(`    Setup     : ${c.setup}`);
  }
  return lines.join("\n");
}

/**
 * Read-only hardware measurement + model recommendation output.
 * @param {{ json?: boolean }} [opts]
 */
export async function runRecommend(opts = {}) {
  const envReport = await probeHostEnvironment();
  const rec = recommendModels(envReport);
  if (opts.json) {
    console.log(JSON.stringify({ environment: envReport, recommendations: rec }, null, 2));
    return { environment: envReport, recommendations: rec };
  }

  printSection("Measured Host Hardware");
  for (const line of formatHardwareLines(envReport)) console.log(line);

  printSection("Local & Cloud Recommendations");
  console.log(formatRecommendationsText(rec));
  return { environment: envReport, recommendations: rec };
}

/**
 * Read-only full diagnostic report (hardware + tools + live backend status).
 * @param {{ json?: boolean }} [opts]
 */
export async function runDoctor(opts = {}) {
  const [envReport, config] = await Promise.all([
    probeHostEnvironment(),
    Promise.resolve(loadConfig()),
  ]);
  const router = new DecisionRouter(config);
  const statusReport = await router.status();
  const rec = recommendModels(envReport);

  if (opts.json) {
    const payload = {
      environment: envReport,
      status: statusReport,
      recommendations: rec,
    };
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  printSection("Measured Host Hardware");
  for (const line of formatHardwareLines(envReport)) console.log(line);

  printSection("Detected Local Ecosystem");
  const t = envReport.tools;
  console.log(
    `Magpie        : ${t.magpie.installed ? `installed (${t.magpie.path})` : "not found"} | gateway ${t.magpie.gateway_running ? `UP (${t.magpie.gateway_url})` : `DOWN (${t.magpie.gateway_url})`}`,
  );
  console.log(
    `OpenDecider   : ${t.opendecider.installed ? `installed (${t.opendecider.path})` : "not found"} | server ${t.opendecider.running ? `READY (${t.opendecider.url})` : `not running (${t.opendecider.url})`}`,
  );
  console.log(
    `Other runtimes: ollama=${t.ollama.installed ? (t.ollama.running ? "running" : "installed") : "no"}, omlx=${t.omlx.installed ? "yes" : "no"}, mlx-serve=${t.mlx_serve.installed ? "yes" : "no"}, uv=${t.uv.installed ? "yes" : "no"}, python3=${t.python3.installed ? "yes" : "no"}`,
  );

  printSection("Configured Backends & Live Health");
  console.log(
    `Routing Mode  : ${statusReport.routing_mode} (default=${statusReport.default_backend}, fallback=${statusReport.fallback_backend}, max_data=${statusReport.max_data_destination})`,
  );
  console.log(
    `Config File   : ${config.configPath} (${config.configFileExists ? "exists" : "using defaults + auto-discovery"})`,
  );
  for (const b of statusReport.backends) {
    const stateBadge = b.ready ? "READY" : b.reachable ? "REACHABLE (NOT READY)" : "UNAVAILABLE";
    console.log(
      `  - ${b.id} [${b.type}] -> ${stateBadge} | destination=${b.data_destination} | images=${b.capabilities?.images ? "yes" : "no"} | models=${(b.available_models || []).join(", ") || "none"}`,
    );
    if (b.setup_hint) console.log(`    hint: ${b.setup_hint}`);
  }

  printSection("Recommended Next Steps");
  const primaryRec = rec.local_recommendations[0];
  if (primaryRec && !t.opendecider.running) {
    console.log(`  Local : ${primaryRec.model}`);
    console.log(`          ${primaryRec.install_steps.join(" && ")}`);
    console.log(`          ${primaryRec.serve_command}`);
  }
  const magpieStatus = statusReport.backends.find((b) => b.id === "magpie");
  if (magpieStatus && !magpieStatus.default_model_available && t.magpie.installed) {
    console.log(`  Cloud : magpie provider add google <GOOGLE_AI_STUDIO_API_KEY>`);
  }
  const secretResolver = createSecretResolver();
  const keyRows = ["PERPLEXITY_API_KEY", "TYPESAFE_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"]
    .map((k) => `${k}=${secretResolver.sourceOf(k) || "unset"}`)
    .join(", ");
  console.log(`  Keys  : ${keyRows} (use 'light-decision-mcp key set <NAME>' for direct GUI providers)`);
  console.log(`  Wizard: light-decision-mcp setup`);

  return { environment: envReport, status: statusReport, recommendations: rec };
}

/**
 * Interactive, confirmation-gated setup wizard.
 * Never silently modifies host services or writes plaintext API keys.
 */
export async function runSetup() {
  if (!process.stdin.isTTY) {
    console.error("Interactive setup requires a TTY. Run 'light-decision-mcp doctor' or 'light-decision-mcp recommend' in non-interactive shells.");
    process.exitCode = 1;
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = async (prompt, fallback = "") => {
    const suffix = fallback ? ` [${fallback}]` : "";
    const ans = (await rl.question(`${prompt}${suffix}: `)).trim();
    return ans || fallback;
  };

  const askYesNo = async (prompt, defaultYes = true) => {
    const hint = defaultYes ? "Y/n" : "y/N";
    const ans = (await rl.question(`${prompt} (${hint}): `)).trim().toLowerCase();
    if (!ans) return defaultYes;
    return ans === "y" || ans === "yes";
  };

  try {
    console.log("Light Decision MCP — Interactive Setup Wizard");
    console.log("Inspecting host hardware and installed decision backends...\n");

    const envReport = await probeHostEnvironment();
    const rec = recommendModels(envReport);
    const current = loadConfig();

    printSection("1. Hardware & Local Ecosystem");
    for (const line of formatHardwareLines(envReport)) console.log(line);
    console.log(
      `Magpie Gateway: ${envReport.tools.magpie.gateway_running ? `running (${envReport.tools.magpie.gateway_url})` : "not detected"}`,
    );
    console.log(
      `OpenDecider   : ${envReport.tools.opendecider.running ? `ready (${envReport.tools.opendecider.url})` : envReport.tools.opendecider.installed ? "installed (not running)" : "not installed"}`,
    );

    printSection("2. Choose Routing Mode");
    console.log("  1) api_with_local_fallback  — Cloud API primary + automatic local fallback on timeout/429/5xx/circuit-open (recommended)");
    console.log("  2) api_only                 — Cloud API only (fail fast on upstream errors)");
    console.log("  3) local_only               — On-device local model only (zero data leaves this machine)");
    const defaultChoice =
      current.routingMode === "api_only" ? "2" : current.routingMode === "local_only" ? "3" : "1";
    const modePick = await ask("Select mode (1/2/3)", defaultChoice);
    const routingMode =
      modePick === "2" ? "api_only" : modePick === "3" ? "local_only" : "api_with_local_fallback";

    /** @type {Record<string, any>} */
    const nextBackends = structuredClone(current.backends);

    printSection("3. Local Model Setup (On-Device)");
    if (envReport.tools.opendecider.running) {
      console.log(`Detected live local opendecider at ${envReport.tools.opendecider.url} (/ready = true).`);
      nextBackends["local-opendecider"] = {
        type: "systemone",
        enabled: true,
        baseUrl: envReport.tools.opendecider.url,
        sendModel: false,
        defaultModel: "local-opendecider",
        dataDestination: "on-device",
      };
    } else {
      const top = rec.local_recommendations[0];
      console.log(`Recommended local model for your measured hardware:`);
      console.log(`  Model   : ${top.model} (${top.runtime})`);
      console.log(`  Why     : ${top.reason}`);
      console.log(`  Install : ${top.install_steps.join(" && ")}`);
      console.log(`  Serve   : ${top.serve_command}`);
      const enableLocal = await askYesNo("Enable local-opendecider backend in config?", routingMode !== "api_only");
      const localUrl = enableLocal
        ? await ask("Local System One URL", current.backends["local-opendecider"]?.baseUrl || "http://127.0.0.1:8001")
        : current.backends["local-opendecider"]?.baseUrl || "http://127.0.0.1:8001";
      nextBackends["local-opendecider"] = {
        type: "systemone",
        enabled: enableLocal,
        baseUrl: localUrl,
        sendModel: false,
        defaultModel: "local-opendecider",
        dataDestination: "on-device",
      };
    }

    let defaultBackend = routingMode === "local_only" ? "local-opendecider" : current.defaultBackend;
    let defaultModel = current.defaultModel;

    if (routingMode !== "local_only") {
      printSection("4. Cloud / API Providers (Zero Plaintext Keys Stored)");
      console.log("  Note: Keys are NEVER written to config.json. Magpie manages keys natively,");
      console.log("        and direct providers reference environment variable names only (apiKeyEnv).\n");

      const useMagpie = await askYesNo("Enable local Magpie gateway backend?", true);
      if (useMagpie) {
        const magpieModel = await ask(
          "Default Magpie decision model (e.g. google/gemini-decision-1, typesafe/jev-latest, openai/gpt-6-luna)",
          current.backends.magpie?.defaultModel || "google/gemini-decision-1",
        );
        nextBackends.magpie = {
          type: "magpie",
          enabled: true,
          defaultModel: magpieModel,
        };
        defaultBackend = "magpie";
        defaultModel = magpieModel;
        console.log("  -> If Google AI Studio is not yet configured in Magpie, run:");
        console.log("     magpie provider add google <YOUR_GOOGLE_AI_STUDIO_API_KEY>");
      } else {
        nextBackends.magpie = { ...(nextBackends.magpie || { type: "magpie" }), enabled: false };
      }

      const useTypeSafe = await askYesNo("Enable direct TypeSafe Jev backend (uses TYPESAFE_API_KEY env)?", Boolean(nextBackends.typesafe?.enabled));
      nextBackends.typesafe = {
        type: "systemone",
        enabled: useTypeSafe,
        baseUrl: nextBackends.typesafe?.baseUrl || "https://api.typesafe.ai",
        sendModel: true,
        defaultModel: nextBackends.typesafe?.defaultModel || "jev-latest",
        apiKeyEnv: "TYPESAFE_API_KEY",
        dataDestination: "third-party",
      };

      const usePerplexity = await askYesNo("Enable direct Perplexity Decisions backend (uses PERPLEXITY_API_KEY env)?", Boolean(nextBackends.perplexity?.enabled));
      nextBackends.perplexity = {
        type: "perplexity",
        enabled: usePerplexity,
        baseUrl: nextBackends.perplexity?.baseUrl || "https://api.perplexity.ai",
        defaultModel: nextBackends.perplexity?.defaultModel || "pplx-decider-v1.3",
        apiKeyEnv: "PERPLEXITY_API_KEY",
        dataDestination: "third-party",
      };

      const useGoogleDirect = await askYesNo("Enable direct Google Gemini Decisions backend (uses GEMINI_API_KEY env)?", Boolean(nextBackends["google-direct"]?.enabled));
      nextBackends["google-direct"] = {
        type: "google-direct",
        enabled: useGoogleDirect,
        baseUrl: "https://generativelanguage.googleapis.com",
        defaultModel: "gemini-decision-1",
        apiKeyEnv: "GEMINI_API_KEY",
        fallbackApiKeyEnv: "GOOGLE_API_KEY",
        dataDestination: "third-party",
      };

      const useOpenAIDirect = await askYesNo("Enable direct OpenAI Decisions backend (uses OPENAI_API_KEY env)?", Boolean(nextBackends["openai-direct"]?.enabled));
      nextBackends["openai-direct"] = {
        type: "openai-direct",
        enabled: useOpenAIDirect,
        baseUrl: "https://api.openai.com",
        defaultModel: "gpt-6-luna",
        apiKeyEnv: "OPENAI_API_KEY",
        dataDestination: "third-party",
      };

      if (!useMagpie) {
        const enabledCloud = Object.entries(nextBackends)
          .filter(([, b]) => b.enabled && b.dataDestination !== "on-device")
          .map(([id]) => id);
        if (enabledCloud.length > 0) {
          defaultBackend = await ask(
            `Primary backend (${enabledCloud.join(" / ")})`,
            enabledCloud[0],
          );
          defaultModel = nextBackends[defaultBackend]?.defaultModel || defaultModel;
        }
      }
    }

    const fallbackOnNotConfigured =
      routingMode === "api_with_local_fallback"
        ? await askYesNo(
            "Also fall back to local model when cloud provider/key is not configured yet?",
            current.fallbackOnNotConfigured,
          )
        : false;

    const configPath = getDefaultConfigPath();
    const configToWrite = {
      version: 1,
      routingMode,
      defaultBackend,
      fallbackBackend: "local-opendecider",
      defaultModel,
      timeoutMs: current.limits.timeoutMs,
      primaryTimeoutMs: current.limits.primaryTimeoutMs,
      fallbackTimeoutMs: current.limits.fallbackTimeoutMs,
      fallbackOnNotConfigured,
      circuitBreaker: current.circuitBreaker,
      maxDataDestination: routingMode === "local_only" ? "on-device" : "third-party",
      backends: nextBackends,
    };

    printSection("5. Review & Save Configuration");
    console.log(`Target path: ${configPath}`);
    console.log(JSON.stringify(configToWrite, null, 2));

    const confirmWrite = await askYesNo("Write this configuration file now?", true);
    if (confirmWrite) {
      saveConfigFile(configPath, configToWrite);
      console.log(`Saved ${configPath} (permissions 0600, zero secrets stored).`);
    } else {
      console.log("Skipped writing configuration file.");
    }

    printSection("6. Agent Registration Commands");
    console.log("  Magpie Plugin (for all HTTP/Hub agents: agy, claude, codex, cursor, zed, pi, etc.):");
    console.log(`    magpie plugin add ${REPO_ROOT}`);
    console.log("  Optional stdio MCP (for claude-desktop or direct MCP clients):");
    console.log(`    magpie library mcp add light-decision-mcp node ${path.join(REPO_ROOT, "bin", "stdio.mjs")} agents=claude-desktop`);

    printSection("7. Verification Check");
    await runDoctor();
  } finally {
    rl.close();
  }
}
