/**
 * Real host hardware & local ecosystem measurement (never guesses from model names).
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveMagpieBaseUrl } from "../backends/magpie.mjs";

const execFileAsync = promisify(execFile);

async function runCmd(cmd, args = [], timeout = 3_000) {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, stdout: (stdout || "").trim() };
  } catch {
    return { ok: false, stdout: "" };
  }
}

async function commandExists(name, extraPaths = []) {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const r = await runCmd(whichCmd, [name], 2_000);
  if (r.ok && r.stdout) {
    return r.stdout.split(/\r?\n/)[0].trim();
  }
  for (const p of extraPaths) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

async function detectDiskFreeGb(targetDir) {
  if (process.platform === "win32") return null;
  const r = await runCmd("df", ["-k", targetDir], 2_000);
  if (!r.ok || !r.stdout) return null;
  const lines = r.stdout.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const cols = lines[lines.length - 1].trim().split(/\s+/);
  // POSIX df -k: Filesystem 1024-blocks Used Available Capacity ...
  const availKb = Number(cols[3]);
  if (!Number.isFinite(availKb) || availKb < 0) return null;
  return Math.round((availKb / (1024 * 1024)) * 10) / 10;
}

async function detectGpu(platform, arch) {
  if (platform === "darwin" && arch === "arm64") {
    const chipRes = await runCmd("sysctl", ["-n", "machdep.cpu.brand_string"], 2_000);
    return {
      vendor: "apple",
      accelerator: "metal",
      unified_memory: true,
      name: chipRes.ok && chipRes.stdout ? chipRes.stdout : "Apple Silicon",
      vram_gb: null,
    };
  }

  const nv = await runCmd(
    "nvidia-smi",
    ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
    2_500,
  );
  if (nv.ok && nv.stdout) {
    const first = nv.stdout.split(/\r?\n/)[0] || "";
    const [namePart, memPart] = first.split(",").map((s) => s.trim());
    const mb = Number(memPart);
    return {
      vendor: "nvidia",
      accelerator: "cuda",
      unified_memory: false,
      name: namePart || "NVIDIA GPU",
      vram_gb: Number.isFinite(mb) ? Math.round((mb / 1024) * 10) / 10 : null,
    };
  }

  return {
    vendor: "none",
    accelerator: "cpu",
    unified_memory: false,
    name: null,
    vram_gb: null,
  };
}

async function probeJson(url, timeoutMs = 2_000, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { reachable: true, ok: res.ok, status: res.status, data: json };
  } catch {
    return { reachable: false, ok: false, status: null, data: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Measure host hardware and detect installed tools / live local services.
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch }} [opts]
 */
export async function probeHostEnvironment(opts = {}) {
  const env = opts.env || process.env;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const platform = process.platform;
  const arch = process.arch;
  const cpus = os.cpus() || [];
  const totalRamGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  const freeRamGb = Math.round((os.freemem() / 1024 ** 3) * 10) / 10;
  const homeDir = os.homedir();

  const [
    gpu,
    freeDiskGb,
    magpieBin,
    openDeciderBin,
    ollamaBin,
    omlxBin,
    mlxServeBin,
    lmsBin,
    uvBin,
    pythonBin,
  ] = await Promise.all([
    detectGpu(platform, arch),
    detectDiskFreeGb(homeDir),
    commandExists("magpie", ["/Applications/magpie.app/Contents/MacOS/magpie"]),
    commandExists("opendecider", [
      path.join(homeDir, ".hermes", "environments", "opendecider", "bin", "opendecider"),
      path.join(homeDir, ".local", "bin", "opendecider"),
    ]),
    commandExists("ollama"),
    commandExists("omlx"),
    commandExists("mlx-serve"),
    commandExists("lms"),
    commandExists("uv"),
    commandExists("python3"),
  ]);

  const magpieUrl = resolveMagpieBaseUrl({ env });
  const openDeciderUrl = (env.OPENDECIDER_URL || "http://127.0.0.1:8001").replace(/\/+$/, "");

  const [magpieProbe, openDeciderProbe, ollamaProbe] = await Promise.all([
    probeJson(`${magpieUrl}/v1/models`, 2_000, fetchImpl),
    probeJson(`${openDeciderUrl}/ready`, 2_000, fetchImpl),
    probeJson("http://127.0.0.1:11434/api/tags", 1_500, fetchImpl),
  ]);

  return {
    hardware: {
      platform,
      arch,
      cpu_cores: cpus.length,
      total_ram_gb: totalRamGb,
      free_ram_gb: freeRamGb,
      free_disk_gb: freeDiskGb,
      gpu,
    },
    tools: {
      magpie: {
        installed: Boolean(magpieBin),
        path: magpieBin,
        gateway_url: magpieUrl,
        gateway_running: magpieProbe.ok,
      },
      opendecider: {
        installed: Boolean(openDeciderBin),
        path: openDeciderBin,
        url: openDeciderUrl,
        running: openDeciderProbe.ok && openDeciderProbe.data?.ready === true,
      },
      ollama: {
        installed: Boolean(ollamaBin),
        path: ollamaBin,
        running: ollamaProbe.ok,
      },
      omlx: { installed: Boolean(omlxBin), path: omlxBin },
      mlx_serve: { installed: Boolean(mlxServeBin), path: mlxServeBin },
      lmstudio: { installed: Boolean(lmsBin), path: lmsBin },
      uv: { installed: Boolean(uvBin), path: uvBin },
      python3: { installed: Boolean(pythonBin), path: pythonBin },
    },
    env_keys: {
      TYPESAFE_API_KEY: Boolean(env.TYPESAFE_API_KEY?.trim()),
      PERPLEXITY_API_KEY: Boolean(env.PERPLEXITY_API_KEY?.trim()),
      GEMINI_API_KEY: Boolean(env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()),
      OPENAI_API_KEY: Boolean(env.OPENAI_API_KEY?.trim()),
    },
  };
}
