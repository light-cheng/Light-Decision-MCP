// Magpie visual configuration page for light-decision-mcp.
// Persists selections via magpie.options.set(...) with 1.1s debounce;
// the plugin hot-reloads plugins.json & config.json automatically on the next request.
(async () => {
  const $ = (id) => document.getElementById(id);

  const I18N = {
    zh: {
      title: "Light Decision MCP",
      subtitle: "多后端 System One 决策路由 · 可视化配置",
      statusIdle: "已加载",
      statusDirty: "待保存…",
      statusSaving: "保存中…",
      statusSaved: "已保存 · 下个请求生效",
      statusError: "保存失败",
      routingTitle: "路由模式",
      modeFallback: "API 主力 + 本地 Fallback",
      modeApi: "仅 API",
      modeLocal: "仅本地",
      modeDesc_api_with_local_fallback:
        "云端 API 作为主力；遇连接失败、超时、429 限流、5xx 或熔断窗口时，秒切本地模型兜底（0 ms 跳过已熔断主力）。",
      modeDesc_api_only:
        "严格仅调用云端/API 主力后端，故障时直接返回结构化错误，不触发本地降级。",
      modeDesc_local_only:
        "严格仅调用本机 on-device 模型（如 OpenDecider :8001），自动锁死数据不出本机。",
      primaryTitle: "主力后端与默认模型",
      backendLabel: "主力后端 (defaultBackend)",
      modelLabel: "默认模型 (defaultModel)",
      optMagpie: "Magpie 网关（推荐 · 零存 Key）",
      optLocal: "本地 OpenDecider (127.0.0.1:8001)",
      optTypeSafe: "TypeSafe Jev（直连）",
      optPerplexity: "Perplexity Decisions（直连）",
      optGoogleDirect: "Google Gemini Decisions（直连）",
      optOpenAIDirect: "OpenAI Decisions（直连）",
      optOpenRouter: "OpenRouter（云端聚合）",
      optCustom: "自定义后端 ID（来自 config.json）…",
      ogRec: "推荐本地网关",
      ogLocal: "本机离线模型",
      ogCloud: "云端直连与聚合",
      ogCustom: "自定义后端",
      guardTitle: "本地降级与数据边界",
      fallbackBackendLabel: "本地 Fallback 后端",
      boundaryLabel: "最大数据边界 (maxDataDestination)",
      destDevice: "仅本机",
      destLan: "私网",
      destCloud: "允许云端",
      fallbackUnconfLabel: "云端未配置 Key / 模型缺失时，也自动降级到本地模型",
      multimodalNote: "含图片的请求遇到纯文本本地后端时，默认拒绝静默丢弃图片降级，防止模型盲猜。",
      timingTitle: "超时预算与网关覆盖",
      timeoutLabel: "单后端超时 (ms)",
      primaryTimeoutLabel: "主力超时 (ms)",
      fallbackTimeoutLabel: "本地降级超时 (ms)",
      gatewayLabel: "自定义网关地址（留空自动读取 gateway.json）",
      resetBtn: "清空覆盖（回退到 config.json）",
      saveBtn: "立即保存",
      keysTitle: "API Key 配在哪里 & 本地向导",
      guideMagpieTitle: "Google / TypeSafe / OpenAI / 百炼 / 方舟",
      guideMagpieDesc: "直接在 Magpie 左侧「供应商 / Providers」页面配置，或终端执行（插件零存 Key）：",
      guideDirectTitle: "Perplexity 等 Magpie 暂未内置的直连 Key",
      guideDirectDesc: "写入本机 0600 凭据文件（或加 --keychain 存 macOS 钥匙串），Magpie 桌面端同样自动生效：",
      guideWizardTitle: "本地模型硬件推荐、诊断与安装向导",
      guideWizardDesc: "实测 CPU/内存/GPU/磁盘并检查所有后端健康状态：",
      copy: "复制",
      copied: "已复制",
    },
    en: {
      title: "Light Decision MCP",
      subtitle: "Multi-backend System One routing & preferences",
      statusIdle: "Loaded",
      statusDirty: "Unsaved…",
      statusSaving: "Saving…",
      statusSaved: "Saved · active next call",
      statusError: "Save failed",
      routingTitle: "Routing Mode",
      modeFallback: "API Primary + Local Fallback",
      modeApi: "API Only",
      modeLocal: "Local Only",
      modeDesc_api_with_local_fallback:
        "Cloud API primary with instant local fallback on network errors, timeouts, 429, 5xx, or an open circuit window (0 ms primary bypass).",
      modeDesc_api_only:
        "Strictly calls the configured cloud/API backend and fails fast on errors without touching local models.",
      modeDesc_local_only:
        "Strictly runs on-device local models (e.g. OpenDecider :8001) and locks max_data_destination to on-device.",
      primaryTitle: "Primary Backend & Default Model",
      backendLabel: "Primary Backend (defaultBackend)",
      modelLabel: "Default Model (defaultModel)",
      optMagpie: "Magpie Gateway (Recommended · Zero Stored Keys)",
      optLocal: "Local OpenDecider (127.0.0.1:8001)",
      optTypeSafe: "TypeSafe Jev (Direct)",
      optPerplexity: "Perplexity Decisions (Direct)",
      optGoogleDirect: "Google Gemini Decisions (Direct)",
      optOpenAIDirect: "OpenAI Decisions (Direct)",
      optOpenRouter: "OpenRouter (Cloud Aggregator)",
      optCustom: "Custom backend ID (from config.json)…",
      ogRec: "Recommended Local Gateway",
      ogLocal: "On-Device Local Models",
      ogCloud: "Cloud Direct & Aggregators",
      ogCustom: "Custom Backend",
      guardTitle: "Local Fallback & Data Boundary",
      fallbackBackendLabel: "Fallback Local Backend",
      boundaryLabel: "Max Data Destination",
      destDevice: "On-device",
      destLan: "Private LAN",
      destCloud: "Cloud OK",
      fallbackUnconfLabel: "Also fall back to local model when cloud key/model is not configured yet",
      multimodalNote:
        "Image requests refuse silent fallback to text-only local models by default unless explicitly opted in.",
      timingTitle: "Timeout Budget & Gateway Override",
      timeoutLabel: "Single Timeout (ms)",
      primaryTimeoutLabel: "Primary Timeout (ms)",
      fallbackTimeoutLabel: "Fallback Timeout (ms)",
      gatewayLabel: "Custom Gateway URL (leave blank to auto-read gateway.json)",
      resetBtn: "Clear Overrides (use config.json)",
      saveBtn: "Save Now",
      keysTitle: "Where API Keys Live & Local Wizard",
      guideMagpieTitle: "Google / TypeSafe / OpenAI / Bailian / Ark",
      guideMagpieDesc: "Configure directly in Magpie → Providers (or CLI below). This plugin stores zero Magpie keys:",
      guideDirectTitle: "Direct-only providers (e.g. Perplexity Decisions)",
      guideDirectDesc: "Store in 0600 local secrets.json (or add --keychain on macOS) so both GUI Magpie and stdio can read it:",
      guideWizardTitle: "Hardware-Aware Local Model Advisor & Diagnostics",
      guideWizardDesc: "Measure CPU/RAM/GPU/disk and inspect all live backends:",
      copy: "Copy",
      copied: "Copied",
    },
  };

  const DEFAULTS = {
    routingMode: "api_with_local_fallback",
    defaultBackend: "magpie",
    defaultModel: "google/gemini-decision-1",
    fallbackBackend: "local-opendecider",
    fallbackOnNotConfigured: false,
    maxDataDestination: "third-party",
    timeoutMs: 25000,
    primaryTimeoutMs: 15000,
    fallbackTimeoutMs: 10000,
    gatewayUrl: "",
  };

  const bridge = globalThis.magpie;
  let lang = "zh";
  if (bridge?.ready) {
    try {
      const theme = await bridge.ready;
      if (theme?.lang) lang = String(theme.lang);
    } catch {}
  }

  let savedOpts = {};
  if (bridge?.options?.get) {
    try {
      savedOpts = (await bridge.options.get()) || {};
    } catch {}
  }

  const state = {
    routingMode: savedOpts.routingMode || DEFAULTS.routingMode,
    defaultBackend: savedOpts.defaultBackend || DEFAULTS.defaultBackend,
    defaultModel: savedOpts.defaultModel || DEFAULTS.defaultModel,
    fallbackBackend: savedOpts.fallbackBackend || DEFAULTS.fallbackBackend,
    fallbackOnNotConfigured:
      typeof savedOpts.fallbackOnNotConfigured === "boolean"
        ? savedOpts.fallbackOnNotConfigured
        : DEFAULTS.fallbackOnNotConfigured,
    maxDataDestination: savedOpts.maxDataDestination || DEFAULTS.maxDataDestination,
    timeoutMs: savedOpts.timeoutMs || DEFAULTS.timeoutMs,
    primaryTimeoutMs: savedOpts.primaryTimeoutMs || DEFAULTS.primaryTimeoutMs,
    fallbackTimeoutMs: savedOpts.fallbackTimeoutMs || DEFAULTS.fallbackTimeoutMs,
    gatewayUrl: savedOpts.gatewayUrl || "",
  };

  function dict() {
    return /^zh/i.test(lang) ? I18N.zh : I18N.en;
  }

  function setPill(stateKey, textKey) {
    const el = $("savePill");
    el.dataset.state = stateKey;
    el.textContent = dict()[textKey] || textKey;
  }

  const KNOWN_BACKENDS = new Set([
    "magpie",
    "local-opendecider",
    "google-direct",
    "typesafe",
    "perplexity",
    "openai-direct",
    "openrouter",
  ]);
  let customBackendMode = !KNOWN_BACKENDS.has(state.defaultBackend);

  function applyWords() {
    const t = dict();
    document.querySelectorAll("[data-t]").forEach((el) => {
      const k = el.dataset.t;
      if (k && t[k]) el.textContent = t[k];
    });
    for (const ogId of ["ogRec", "ogLocal", "ogCloud", "ogCustom"]) {
      const og = $(ogId);
      if (og && t[ogId]) og.label = t[ogId];
    }
    paint();
  }

  function paint() {
    const t = dict();
    $("modeBadge").textContent = state.routingMode;
    $("modeDesc").textContent = t[`modeDesc_${state.routingMode}`] || "";

    $("modeSeg").querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.mode === state.routingMode));
    });

    const effectiveDest = state.routingMode === "local_only" ? "on-device" : state.maxDataDestination;
    $("destSeg").querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.dest === effectiveDest));
      b.disabled = state.routingMode === "local_only" && b.dataset.dest !== "on-device";
    });

    const customInput = $("customBackendId");
    if (customBackendMode || !KNOWN_BACKENDS.has(state.defaultBackend)) {
      $("defaultBackend").value = "__custom__";
      customInput.hidden = false;
      if (customInput.value !== state.defaultBackend) {
        customInput.value = KNOWN_BACKENDS.has(state.defaultBackend) ? "" : state.defaultBackend;
      }
    } else {
      $("defaultBackend").value = state.defaultBackend;
      customInput.hidden = true;
    }
    $("defaultModel").value = state.defaultModel;
    $("fallbackBackend").value = state.fallbackBackend;
    $("fallbackOnNotConfigured").checked = Boolean(state.fallbackOnNotConfigured);
    $("timeoutMs").value = String(state.timeoutMs || "");
    $("primaryTimeoutMs").value = String(state.primaryTimeoutMs || "");
    $("fallbackTimeoutMs").value = String(state.fallbackTimeoutMs || "");
    $("gatewayUrl").value = state.gatewayUrl || "";

    $("modelChips").querySelectorAll(".chip").forEach((c) => {
      c.dataset.active = String(c.dataset.model === state.defaultModel && c.dataset.backend === state.defaultBackend);
    });
  }

  function buildPayload() {
    const toNum = (v, fallback) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : fallback;
    };
    return {
      routingMode: state.routingMode,
      defaultBackend: state.defaultBackend.trim() || DEFAULTS.defaultBackend,
      defaultModel: state.defaultModel.trim() || DEFAULTS.defaultModel,
      fallbackBackend: state.fallbackBackend.trim() || DEFAULTS.fallbackBackend,
      fallbackOnNotConfigured: Boolean(state.fallbackOnNotConfigured),
      maxDataDestination: state.routingMode === "local_only" ? "on-device" : state.maxDataDestination,
      timeoutMs: toNum(state.timeoutMs, DEFAULTS.timeoutMs),
      primaryTimeoutMs: toNum(state.primaryTimeoutMs, DEFAULTS.primaryTimeoutMs),
      fallbackTimeoutMs: toNum(state.fallbackTimeoutMs, DEFAULTS.fallbackTimeoutMs),
      gatewayUrl: state.gatewayUrl.trim(),
    };
  }

  let saveTimer = null;
  async function persistNow(payload) {
    if (!bridge?.options?.set) return;
    setPill("dirty", "statusSaving");
    $("errorBox").hidden = true;
    try {
      savedOpts = (await bridge.options.set(payload)) || payload;
      setPill("saved", "statusSaved");
    } catch (e) {
      const msg = String(e?.message || e);
      if (/429|too many/i.test(msg)) {
        scheduleSave();
      } else {
        setPill("error", "statusError");
        $("errorBox").hidden = false;
        $("errorBox").textContent = msg;
      }
    }
  }

  function scheduleSave() {
    setPill("dirty", "statusDirty");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistNow(buildPayload());
    }, 1100);
  }

  $("modeSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn?.dataset.mode) return;
    state.routingMode = btn.dataset.mode;
    paint();
    scheduleSave();
  });

  $("destSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn?.dataset.dest || btn.disabled) return;
    state.maxDataDestination = btn.dataset.dest;
    paint();
    scheduleSave();
  });

  $("defaultBackend").addEventListener("change", (e) => {
    if (e.target.value === "__custom__") {
      customBackendMode = true;
      state.defaultBackend = $("customBackendId").value.trim();
      paint();
      $("customBackendId").focus();
      return;
    }
    customBackendMode = false;
    state.defaultBackend = e.target.value;
    paint();
    scheduleSave();
  });

  $("customBackendId").addEventListener("input", (e) => {
    customBackendMode = true;
    state.defaultBackend = e.target.value.trim();
    scheduleSave();
  });

  $("defaultModel").addEventListener("input", (e) => {
    state.defaultModel = e.target.value;
    paint();
    scheduleSave();
  });

  $("fallbackBackend").addEventListener("input", (e) => {
    state.fallbackBackend = e.target.value;
    scheduleSave();
  });

  $("fallbackOnNotConfigured").addEventListener("change", (e) => {
    state.fallbackOnNotConfigured = e.target.checked;
    scheduleSave();
  });

  for (const id of ["timeoutMs", "primaryTimeoutMs", "fallbackTimeoutMs", "gatewayUrl"]) {
    $(id).addEventListener("input", (e) => {
      state[id] = e.target.value;
      scheduleSave();
    });
  }

  $("modelChips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    customBackendMode = false;
    state.defaultBackend = chip.dataset.backend;
    state.defaultModel = chip.dataset.model;
    if (state.defaultBackend === "local-opendecider") {
      state.routingMode = "local_only";
    } else if (state.routingMode === "local_only") {
      state.routingMode = "api_with_local_fallback";
    }
    paint();
    scheduleSave();
  });

  $("saveBtn").addEventListener("click", () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    persistNow(buildPayload());
  });

  $("resetBtn").addEventListener("click", async () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    customBackendMode = false;
    Object.assign(state, DEFAULTS);
    paint();
    await persistNow({
      routingMode: "",
      defaultBackend: "",
      defaultModel: "",
      fallbackBackend: "",
      fallbackOnNotConfigured: null,
      maxDataDestination: "",
      timeoutMs: null,
      primaryTimeoutMs: null,
      fallbackTimeoutMs: null,
      gatewayUrl: "",
    });
  });

  document.querySelectorAll(".copy").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = $(btn.dataset.copy);
      if (!target) return;
      try {
        await navigator.clipboard.writeText(target.textContent || "");
        const prev = btn.textContent;
        btn.textContent = dict().copied;
        setTimeout(() => {
          btn.textContent = dict().copy || prev;
        }, 1200);
      } catch {}
    });
  });

  if (bridge?.onTheme) {
    bridge.onTheme((t) => {
      if (t?.lang) lang = String(t.lang);
      applyWords();
    });
  }

  applyWords();
})();
