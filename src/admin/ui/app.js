(() => {
  const $ = (id) => document.getElementById(id);

  const I18N = {
    zh: {
      subtitle: "独立本地后台管理 · 仅绑定 127.0.0.1 · 改完自动热加载",
      refresh: "刷新状态",
      tabOverview: "总览与后端",
      tabRouting: "路由与自定义网关",
      tabKeys: "密钥管理",
      tabPlayground: "在线试跑",
      tabClients: "硬件推荐与接入",
      liveBackendsTitle: "后端实时状态与熔断监控",
      routingModeTitle: "路由模式与默认策略",
      modeFallback: "API 主力 + 本地 Fallback",
      modeApi: "仅 API",
      modeLocal: "仅本地",
      modeHint_api_with_local_fallback:
        "云端 API 主力，遇连接异常、超时、429、5xx 或熔断窗口（0 ms 跳过）自动切本地兜底。",
      modeHint_api_only: "仅调用云端/API 后端，故障时直接报错，不切本地。",
      modeHint_local_only: "仅调用本机 on-device 模型，自动锁死数据不出本机。",
      defaultBackendLabel: "主力后端 (defaultBackend)",
      defaultModelLabel: "默认模型 (defaultModel)",
      fallbackBackendLabel: "本地 Fallback 后端",
      maxDestLabel: "最大数据边界",
      destDevice: "仅本机",
      destLan: "私网",
      destCloud: "允许云端",
      fallbackUnconfText: "云端未配置 Key / 模型缺失时，也自动降级到本地模型",
      timeoutLabel: "单后端超时 (ms)",
      primaryTimeoutLabel: "主力超时 (ms)",
      fallbackTimeoutLabel: "本地降级超时 (ms)",
      cbFailLabel: "熔断失败阈值",
      cbCooldownLabel: "熔断冷却 (ms)",
      gatewayOverrideLabel: "Magpie 网关覆盖 (可选)",
      backendsEditorTitle: "已配置后端与自定义网关",
      addGatewayBtn: "+ 添加供应商 / 网关",
      backendsEditorHint:
        "主力推荐 Magpie 网关（原生全协议、零存 Key）；也可启用/停用直连供应商，或一键添加 OpenRouter（云端聚合）、LiteLLM Proxy（自托管中转）、局域网 OpenDecider 及自定义 Decisions / System One 网关。",
      presetTitle: "选择预设模板或自定义添加",
      closeBtn: "收起",
      catCloudAgg: "云端聚合",
      catSelfHosted: "自托管网关",
      catLanNode: "局域网节点",
      recBadge: "推荐",
      presetOpenRouterDesc: "云端模型平台 · 原生 /api/alpha/decisions · 单个 OPENROUTER_API_KEY 调多家模型",
      presetLiteLLMDesc: "开源自建中转站（类似 New API）· 原生 /v1/decisions · 默认 :4000",
      presetLanDesc: "内网 Mac/GPU 机器运行的 opendecider serve · 仅私网通信不出外网",
      customIdLabel: "自定义 ID",
      customProtoLabel: "协议类型",
      addCustomBtn: "添加自定义",
      grpRecommended: "推荐本地网关",
      grpLocal: "本机离线模型",
      grpCloud: "云端直连与聚合",
      grpGateway: "自托管与自定义网关",
      magpieRecLabel: "Magpie 网关（推荐 · 零存 Key）",
      statusReady: "已就绪",
      statusNotReady: "未就绪",
      statusOffline: "未检测到",
      statusNoKey: "未配 Key",
      statusDisabled: "已停用",
      addedPreset: "已添加到草稿，请核对地址/密钥后点击保存。",
      existsPreset: "该后端已在列表中，已为你启用。",
      invalidId: "ID 格式无效（仅支持 1-48 位字母、数字、-、_）。",
      saveConfigBtn: "保存配置到 config.json",
      keysTitle: "直连供应商与自定义网关密钥（零明文回显）",
      keysHint:
        "走 Magpie 网关的供应商（Google / TypeSafe / OpenAI 等）请在 Magpie「供应商」页配置。此处仅管理脱离 Magpie 或 Perplexity / 自定义网关使用的直连密钥，以 0600 权限存入本地 secrets.json（或 macOS 钥匙串），绝不写入仓库或 config.json。",
      keyNameLabel: "密钥变量名 (apiKeyEnv)",
      keyValueLabel: "API Key（不会明文回显）",
      keyStoreLabel: "存储位置",
      keychainOptLabel: "macOS 钥匙串",
      saveKeyBtn: "安全保存密钥",
      keySetPrefix: "已配置",
      keyNotSet: "未配置",
      keySrc_env: "环境变量",
      keySrc_keychain: "钥匙串",
      pgTitle: "在线决策试跑",
      pgToolLabel: "工具",
      pgModeLabel: "路由模式覆盖",
      pgUseDefault: "使用默认配置",
      pgBackendLabel: "指定后端（可选）",
      pgStateLabel: "输入状态 (state)",
      pgQuestionLabel: "问题 (question)",
      pgRunBtn: "运行测试",
      hwTitle: "实测本机硬件与本地模型推荐",
      hwLoading: "正在检测…",
      hwOsLabel: "系统 / 架构",
      hwCoresUnit: "核",
      hwRamLabel: "内存",
      hwRamFmt: (tot, free) => `共 ${tot} GB（当前可用 ${free} GB）`,
      hwAccelLabel: "加速器",
      hwDiskLabel: "剩余磁盘",
      hwUnknown: "未知",
      hwMemUnit: (gb) => `约 ${gb} GB 内存`,
      tier_primary: "首选推荐",
      tier_alternative: "高精度备选",
      tier_lightweight: "极轻量",
      statRouting: "路由模式",
      statMaxDest: "边界上限：",
      statReadyBackends: "就绪后端",
      statDefaultPrefix: "主力：",
      statLocal: "本机离线模型",
      statLocalReady: "已就绪",
      statLocalOffline: "未运行",
      statDirectKeys: "直连密钥",
      statKeySources: "环境变量 / 0600 / 钥匙串",
      badgeReady: "已就绪",
      badgeNotReady: "未就绪",
      badgeUnavailable: "不可用",
      metaDest: "边界：",
      metaImages: "图片：",
      metaYes: "支持",
      metaNo: "不支持",
      metaCircuit: "熔断：",
      metaModels: "模型：",
      metaNone: "无",
      metaHint: "提示：",
      destName_on_device: "仅本机",
      destName_private_network: "私网",
      destName_third_party: "云端",
      cbState_closed: "正常",
      cbState_open: "已熔断",
      cbState_half_open: "半开探测",
      fieldBaseUrl: "接口地址 (baseUrl)",
      fieldDefaultModel: "默认模型 (defaultModel)",
      fieldApiKeyEnv: "密钥变量 (apiKeyEnv)",
      fieldApiKeyEnvPh: "环境变量名（可选）",
      fieldEndpointPath: "端点路径 (endpointPath)",
      fieldDataDest: "数据边界 (dataDestination)",
      fieldHeaders: "附加请求头 (headers JSON)",
      fieldGatewayUrl: "网关覆盖 (gatewayUrl)",
      fieldGatewayUrlPh: "留空自动读取 gateway.json",
      clientMagpie: "Magpie 插件",
      reprobeBtn: "重新检测",
      snippetsTitle: "独立 MCP 客户端接入配置（零 Magpie 依赖）",
      copy: "复制",
      copied: "已复制",
      savedConfig: "已保存到 config.json，运行中的 MCP/插件将在下个请求自动热加载。",
      savedKey: "密钥已安全保存（下个请求自动生效）。",
      removedKey: "已删除密钥。",
      remove: "移除",
      enabled: "启用",
      running: "试跑中…",
    },
    en: {
      subtitle: "Standalone local admin · 127.0.0.1 only · Zero-restart hot reload",
      refresh: "Refresh",
      tabOverview: "Overview & Backends",
      tabRouting: "Routing & Gateways",
      tabKeys: "API Keys",
      tabPlayground: "Playground",
      tabClients: "Hardware & Clients",
      liveBackendsTitle: "Live Backend Health & Circuit Breakers",
      routingModeTitle: "Routing Mode & Defaults",
      modeFallback: "API Primary + Local Fallback",
      modeApi: "API Only",
      modeLocal: "Local Only",
      modeHint_api_with_local_fallback:
        "Cloud API primary with instant local fallback on network errors, timeouts, 429, 5xx, or an open circuit window (0 ms bypass).",
      modeHint_api_only: "Calls cloud/API backend only; fails fast without falling back.",
      modeHint_local_only: "Runs on-device local models only and locks data destination to on-device.",
      defaultBackendLabel: "Primary Backend (defaultBackend)",
      defaultModelLabel: "Default Model (defaultModel)",
      fallbackBackendLabel: "Fallback Local Backend",
      maxDestLabel: "Max Data Destination",
      destDevice: "On-device",
      destLan: "Private LAN",
      destCloud: "Cloud OK",
      fallbackUnconfText: "Also fall back to local model when cloud key/model is not configured yet",
      timeoutLabel: "Single Timeout (ms)",
      primaryTimeoutLabel: "Primary Timeout (ms)",
      fallbackTimeoutLabel: "Fallback Timeout (ms)",
      cbFailLabel: "Circuit Failure Threshold",
      cbCooldownLabel: "Circuit Cooldown (ms)",
      gatewayOverrideLabel: "Magpie Gateway Override (optional)",
      backendsEditorTitle: "Backends & Custom Gateways",
      addGatewayBtn: "+ Add Provider / Gateway",
      backendsEditorHint:
        "Magpie Gateway is recommended as primary (native full protocol, zero stored keys). Enable direct vendors or add OpenRouter (cloud aggregator), LiteLLM Proxy (self-hosted), LAN OpenDecider, or any custom Decisions / System One gateway.",
      presetTitle: "Pick a Preset Template or Add Custom",
      closeBtn: "Close",
      catCloudAgg: "Cloud Aggregator",
      catSelfHosted: "Self-Hosted Gateway",
      catLanNode: "LAN Node",
      recBadge: "Recommended",
      presetOpenRouterDesc: "Cloud model aggregator · native /api/alpha/decisions · one OPENROUTER_API_KEY",
      presetLiteLLMDesc: "Self-hosted open-source proxy · native /v1/decisions · default :4000",
      presetLanDesc: "Local opendecider serve on a LAN Mac/GPU host · private-network only",
      customIdLabel: "Custom ID",
      customProtoLabel: "Protocol",
      addCustomBtn: "Add Custom",
      grpRecommended: "Recommended Local Gateway",
      grpLocal: "On-Device Local Models",
      grpCloud: "Cloud Direct & Aggregators",
      grpGateway: "Self-Hosted & Custom Gateways",
      magpieRecLabel: "Magpie Gateway (Recommended · Zero Stored Keys)",
      statusReady: "READY",
      statusNotReady: "NOT READY",
      statusOffline: "Offline",
      statusNoKey: "No Key",
      statusDisabled: "Disabled",
      addedPreset: "Added to draft—review URL/key and click Save.",
      existsPreset: "Backend already exists—enabled it in the list.",
      invalidId: "Invalid ID (use 1-48 chars matching [A-Za-z0-9_-]).",
      saveConfigBtn: "Save to config.json",
      keysTitle: "Direct & Custom Gateway Keys (Never Echoed)",
      keysHint:
        "For Magpie-managed providers (Google, TypeSafe, OpenAI), configure keys in Magpie → Providers. Use this panel for standalone/direct keys (e.g. Perplexity or custom gateways); keys are stored in 0600 secrets.json or macOS Keychain—never in config.json.",
      keyNameLabel: "Env Variable Name (apiKeyEnv)",
      keyValueLabel: "API Key (never shown again)",
      keyStoreLabel: "Storage",
      keychainOptLabel: "macOS Keychain",
      saveKeyBtn: "Save Secret",
      keySetPrefix: "set",
      keyNotSet: "not set",
      keySrc_env: "env",
      keySrc_keychain: "keychain",
      pgTitle: "Live Decision Playground",
      pgToolLabel: "Tool",
      pgModeLabel: "Routing Mode Override",
      pgUseDefault: "Use configured default",
      pgBackendLabel: "Backend Override (optional)",
      pgStateLabel: "Input State (state)",
      pgQuestionLabel: "Question",
      pgRunBtn: "Run Decision",
      hwTitle: "Measured Host Hardware & Local Model Advisor",
      hwLoading: "Probing…",
      hwOsLabel: "OS / Arch",
      hwCoresUnit: "cores",
      hwRamLabel: "RAM",
      hwRamFmt: (tot, free) => `${tot} GB total (${free} GB free)`,
      hwAccelLabel: "Accelerator",
      hwDiskLabel: "Free Disk",
      hwUnknown: "unknown",
      hwMemUnit: (gb) => `~${gb} GB RAM`,
      tier_primary: "PRIMARY",
      tier_alternative: "ALTERNATIVE",
      tier_lightweight: "LIGHTWEIGHT",
      statRouting: "Routing Mode",
      statMaxDest: "max: ",
      statReadyBackends: "Ready Backends",
      statDefaultPrefix: "default: ",
      statLocal: "On-Device Local",
      statLocalReady: "READY",
      statLocalOffline: "OFFLINE",
      statDirectKeys: "Direct Keys",
      statKeySources: "env / 0600 / keychain",
      badgeReady: "READY",
      badgeNotReady: "NOT READY",
      badgeUnavailable: "UNAVAILABLE",
      metaDest: "dest: ",
      metaImages: "images: ",
      metaYes: "yes",
      metaNo: "no",
      metaCircuit: "circuit: ",
      metaModels: "models: ",
      metaNone: "none",
      metaHint: "Hint: ",
      destName_on_device: "on-device",
      destName_private_network: "private-network",
      destName_third_party: "third-party",
      cbState_closed: "closed",
      cbState_open: "open",
      cbState_half_open: "half_open",
      fieldBaseUrl: "baseUrl",
      fieldDefaultModel: "defaultModel",
      fieldApiKeyEnv: "apiKeyEnv",
      fieldApiKeyEnvPh: "ENV_VAR (optional)",
      fieldEndpointPath: "endpointPath",
      fieldDataDest: "dataDestination",
      fieldHeaders: "headers (JSON)",
      fieldGatewayUrl: "gatewayUrl",
      fieldGatewayUrlPh: "auto from gateway.json",
      clientMagpie: "Magpie Plugin",
      reprobeBtn: "Re-probe",
      snippetsTitle: "Standalone MCP Client Config (Zero Magpie Required)",
      copy: "Copy",
      copied: "Copied",
      savedConfig: "Saved config.json. Running MCP / Magpie plugin will hot-reload on next call.",
      savedKey: "Secret stored securely (active on next call).",
      removedKey: "Secret removed.",
      remove: "Remove",
      enabled: "Enabled",
      running: "Running…",
    },
  };

  let lang = /^zh/i.test(navigator.language || "zh") ? "zh" : "en";
  let boot = null;
  let liveStatus = null;
  let envData = null;
  let draftConfig = null;
  let activeClient = "claude-desktop";

  const t = (k) => I18N[lang][k] || k;

  function showToast(msg, isErr = false) {
    const el = $("toast");
    el.textContent = msg;
    el.className = "toast" + (isErr ? " err" : "");
    el.hidden = false;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => { el.hidden = true; }, 4000);
  }

  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.method && opts.method !== "GET") {
      headers["X-CSRF-Token"] = boot?.csrfToken || "";
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    }
    const res = await fetch(path, {
      ...opts,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  const PG_DEFAULTS = {
    zh: {
      state: "生产环境结账接口已经连续 15 分钟返回 502 错误。",
      question: "这是否属于生产故障？",
      items: "低, 中, 高, 严重",
    },
    en: {
      state: "Our production checkout API has been returning 502 errors for 15 minutes.",
      question: "Does this report a production outage?",
      items: "low, medium, high, critical",
    },
  };

  function syncPlaygroundDefaults() {
    const curState = $("pgState").value;
    if (curState === PG_DEFAULTS.zh.state || curState === PG_DEFAULTS.en.state) {
      $("pgState").value = PG_DEFAULTS[lang].state;
    }
    const curQ = $("pgQuestion").value;
    if (curQ === PG_DEFAULTS.zh.question || curQ === PG_DEFAULTS.en.question) {
      $("pgQuestion").value = PG_DEFAULTS[lang].question;
    }
    const curItems = $("pgItems").value;
    if (curItems === PG_DEFAULTS.zh.items || curItems === PG_DEFAULTS.en.items) {
      $("pgItems").value = PG_DEFAULTS[lang].items;
    }
    const tool = $("pgTool").value;
    $("pgItemsLabel").textContent =
      tool === "choose"
        ? lang === "zh" ? "候选选项（逗号分隔）" : "Options (comma-separated)"
        : lang === "zh" ? "有序档位，从低到高（逗号分隔）" : "Ordered levels, lowest first (comma-separated)";
  }

  function localizeSetupHint(hint) {
    if (!hint || lang !== "zh") return hint;
    let m;
    if ((m = /^Set environment variable (\S+) to enable Perplexity Decisions API\.$/.exec(hint))) {
      return `请配置密钥 ${m[1]} 以启用 Perplexity Decisions API。`;
    }
    if ((m = /^Set environment variable (\S+) to enable '([^']+)'\.$/.exec(hint))) {
      return `请配置密钥 ${m[1]} 以启用后端 '${m[2]}'。`;
    }
    if ((m = /^Set (\S+) \(or (\S+)\) for direct Google Gemini Decisions, or use Magpie gateway\.$/.exec(hint))) {
      return `请配置 ${m[1]}（或 ${m[2]}）以直连 Google Gemini Decisions，或改走 Magpie 网关。`;
    }
    if (/^Start Magpie or set MAGPIE_GATEWAY/.test(hint)) {
      return "请启动 Magpie 或通过 MAGPIE_GATEWAY / gatewayUrl 指定运行中的网关地址。";
    }
    if (/^Start local opendecider server/.test(hint)) {
      return "请启动本地 opendecider 服务，或运行 'light-decision-mcp setup' 安装并配置本地模型。";
    }
    if ((m = /^Add your Google AI Studio key in Magpie/.exec(hint))) {
      return "请在 Magpie 左侧「供应商」页添加 Google AI Studio 密钥（或执行 magpie provider add google <API_KEY>）。";
    }
    if ((m = /^Backend '([^']+)' at (\S+) responded to \/ready with ready=false\.$/.exec(hint))) {
      return `后端 '${m[1]}'（${m[2]}）的 /ready 接口返回 ready=false。`;
    }
    if ((m = /^Ensure System One server '([^']+)' is reachable at (\S+)\.$/.exec(hint))) {
      return `请确认 System One 服务 '${m[1]}' 在 ${m[2]} 可访问。`;
    }
    return hint;
  }

  function applyI18n() {
    $("langBtn").textContent = lang === "zh" ? "EN" : "中文";
    document.querySelectorAll("[data-t]").forEach((el) => {
      const k = el.dataset.t;
      if (typeof I18N[lang][k] === "string") el.textContent = I18N[lang][k];
    });
    syncPlaygroundDefaults();
    if (draftConfig) renderRouting();
    if (liveStatus) renderOverview();
    if (boot) {
      renderKeys();
      renderClientSnippet();
    }
    if (envData) renderHardware();
  }

  function formatDestName(dest) {
    const key = `destName_${String(dest || "").replace(/-/g, "_")}`;
    return I18N[lang][key] || dest || "-";
  }

  function formatCircuitState(st) {
    const key = `cbState_${st || "closed"}`;
    return I18N[lang][key] || st || "closed";
  }

  function renderOverview() {
    if (!boot || !liveStatus) return;
    const backends = liveStatus.backends || [];
    const readyCount = backends.filter((b) => b.ready).length;
    const localReady = backends.some((b) => b.data_destination === "on-device" && b.ready);
    const setKeys = (boot.keys || []).filter((k) => k.source).length;

    const tiles = [
      { k: t("statRouting"), v: liveStatus.routing_mode, s: `${t("statMaxDest")}${formatDestName(liveStatus.max_data_destination)}` },
      { k: t("statReadyBackends"), v: `${readyCount} / ${backends.length}`, s: `${t("statDefaultPrefix")}${liveStatus.default_backend}` },
      { k: t("statLocal"), v: localReady ? t("statLocalReady") : t("statLocalOffline"), s: liveStatus.fallback_backend || "-" },
      { k: t("statDirectKeys"), v: String(setKeys), s: t("statKeySources") },
    ];
    $("statTiles").replaceChildren(
      ...tiles.map((item) => {
        const d = document.createElement("div");
        d.className = "stat";
        d.innerHTML = `<div class="k"></div><div class="v"></div><div class="s"></div>`;
        d.querySelector(".k").textContent = item.k;
        d.querySelector(".v").textContent = item.v;
        d.querySelector(".s").textContent = item.s;
        return d;
      }),
    );

    $("configPathLabel").textContent = boot.configPath;
    $("liveBackends").replaceChildren(
      ...backends.map((b) => {
        const box = document.createElement("div");
        box.className = "backend-item";
        const top = document.createElement("div");
        top.className = "backend-top";

        const left = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = `${b.id} `;
        const typ = document.createElement("span");
        typ.className = "mono muted";
        typ.textContent = `[${b.type}]`;
        left.append(title, typ);

        const statusBadge = document.createElement("span");
        statusBadge.className =
          "badge " + (b.ready ? "ok" : b.reachable ? "warn" : "err");
        statusBadge.textContent = b.ready ? t("badgeReady") : b.reachable ? t("badgeNotReady") : t("badgeUnavailable");
        top.append(left, statusBadge);

        const meta = document.createElement("div");
        meta.className = "backend-meta";
        const tags = [
          `${t("metaDest")}${formatDestName(b.data_destination)}`,
          `${t("metaImages")}${b.capabilities?.images ? t("metaYes") : t("metaNo")}`,
          `${t("metaCircuit")}${formatCircuitState(b.circuit?.state)}`,
          `${t("metaModels")}${(b.available_models || []).join(", ") || t("metaNone")}`,
        ];
        for (const text of tags) {
          const span = document.createElement("span");
          span.className = "badge neutral";
          span.textContent = text;
          meta.append(span);
        }

        box.append(top, meta);
        if (b.setup_hint) {
          const p = document.createElement("p");
          p.className = "hint";
          p.textContent = `${t("metaHint")}${localizeSetupHint(b.setup_hint)}`;
          box.append(p);
        }
        return box;
      }),
    );
  }

  const GATEWAY_PRESETS = {
    openrouter: {
      id: "openrouter",
      cfg: {
        type: "systemone",
        enabled: true,
        baseUrl: "https://openrouter.ai",
        endpointPath: "/api/alpha/decisions",
        defaultModel: "typesafe/jev-1.13",
        apiKeyEnv: "OPENROUTER_API_KEY",
        sendModel: true,
        dataDestination: "third-party",
      },
    },
    litellm: {
      id: "litellm",
      cfg: {
        type: "openai-decisions",
        enabled: true,
        baseUrl: "http://127.0.0.1:4000",
        endpointPath: "/v1/decisions",
        defaultModel: "openai/gpt-6-luna",
        apiKeyEnv: "LITELLM_API_KEY",
        dataDestination: "private-network",
      },
    },
    "lan-opendecider": {
      id: "lan-opendecider",
      cfg: {
        type: "systemone",
        enabled: true,
        baseUrl: "http://192.168.1.100:8001",
        endpointPath: "/v1/systemone",
        defaultModel: "local-opendecider",
        apiKeyEnv: null,
        sendModel: false,
        dataDestination: "private-network",
      },
    },
  };

  function classifyBackendGroup(id, cfg) {
    if (id === "magpie" || cfg.type === "magpie") return "recommended";
    if (id === "local-opendecider" || cfg.dataDestination === "on-device") return "local";
    if (
      id === "openrouter" ||
      id === "typesafe" ||
      id === "perplexity" ||
      id === "google-direct" ||
      id === "openai-direct" ||
      cfg.type === "perplexity" ||
      cfg.type === "google-direct" ||
      cfg.type === "openai-direct"
    ) {
      return "cloud";
    }
    return "gateway";
  }

  function backendStatusTag(id, cfg) {
    if (cfg.enabled === false) return ` [${t("statusDisabled")}]`;
    const st = (liveStatus?.backends || []).find((b) => b.id === id);
    if (!st) return "";
    if (st.ready) return ` [${t("statusReady")}]`;
    if (st.reachable) return ` [${t("statusNotReady")}]`;
    if (id === "magpie" || cfg.dataDestination === "on-device") return ` [${t("statusOffline")}]`;
    if (cfg.apiKeyEnv) return ` [${t("statusNoKey")}]`;
    return ` [${t("statusOffline")}]`;
  }

  function formatBackendOptionLabel(id, cfg) {
    const tag = backendStatusTag(id, cfg);
    if (id === "magpie") return `${t("magpieRecLabel")}${tag}`;
    if (id === "openrouter") return `openrouter (${t("catCloudAgg")})${tag}`;
    return `${id} (${cfg.type})${tag}`;
  }

  function renderBackendSelects() {
    if (!draftConfig) return;
    const backends = draftConfig.backends || {};
    const groupOrder = [
      { key: "recommended", label: t("grpRecommended") },
      { key: "local", label: t("grpLocal") },
      { key: "cloud", label: t("grpCloud") },
      { key: "gateway", label: t("grpGateway") },
    ];
    const buckets = { recommended: [], local: [], cloud: [], gateway: [] };
    for (const [id, cfg] of Object.entries(backends)) {
      buckets[classifyBackendGroup(id, cfg)].push([id, cfg]);
    }

    const fillSelect = (el, val, includeBlank = false) => {
      const nodes = [];
      if (includeBlank) {
        const o = document.createElement("option");
        o.value = "";
        o.textContent = t("pgUseDefault");
        nodes.push(o);
      }
      for (const g of groupOrder) {
        if (buckets[g.key].length === 0) continue;
        const og = document.createElement("optgroup");
        og.label = g.label;
        for (const [id, cfg] of buckets[g.key]) {
          const o = document.createElement("option");
          o.value = id;
          o.textContent = formatBackendOptionLabel(id, cfg);
          og.append(o);
        }
        nodes.push(og);
      }
      if (val && !(val in backends)) {
        const extra = document.createElement("option");
        extra.value = val;
        extra.textContent = val;
        nodes.push(extra);
      }
      el.replaceChildren(...nodes);
      el.value = val || "";
    };

    fillSelect($("defaultBackendSelect"), draftConfig.defaultBackend);
    fillSelect($("fallbackBackendSelect"), draftConfig.fallbackBackend);
    fillSelect($("pgBackend"), $("pgBackend").value, true);
  }

  function renderRouting() {
    if (!draftConfig) return;
    $("modeBadge").textContent = draftConfig.routingMode;
    $("modeHint").textContent = t(`modeHint_${draftConfig.routingMode}`);
    $("modeSeg").querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.mode === draftConfig.routingMode));
    });
    const effDest = draftConfig.routingMode === "local_only" ? "on-device" : draftConfig.maxDataDestination;
    $("destSeg").querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.dest === effDest));
      b.disabled = draftConfig.routingMode === "local_only" && b.dataset.dest !== "on-device";
    });

    renderBackendSelects();

    $("defaultModelInput").value = draftConfig.defaultModel || "";
    $("fallbackUnconfCheck").checked = Boolean(draftConfig.fallbackOnNotConfigured);
    $("timeoutMsInput").value = draftConfig.timeoutMs ?? 25000;
    $("primaryTimeoutMsInput").value = draftConfig.primaryTimeoutMs ?? 15000;
    $("fallbackTimeoutMsInput").value = draftConfig.fallbackTimeoutMs ?? 10000;
    $("cbThresholdInput").value = draftConfig.circuitBreaker?.failureThreshold ?? 2;
    $("cbCooldownInput").value = draftConfig.circuitBreaker?.cooldownMs ?? 30000;
    $("gatewayUrlInput").value = draftConfig.gatewayUrl || "";

    renderBackendsEditor();
  }

  function renderBackendsEditor() {
    const BUILTIN = new Set(["magpie", "local-opendecider", "typesafe", "perplexity", "google-direct", "openai-direct"]);
    const entries = Object.entries(draftConfig.backends || {});
    $("backendsEditor").replaceChildren(
      ...entries.map(([id, b]) => {
        const card = document.createElement("div");
        card.className = "editor-item";

        const head = document.createElement("div");
        head.className = "editor-item-head";
        const left = document.createElement("label");
        left.className = "toggle";
        left.style.marginTop = "0";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = b.enabled !== false;
        cb.addEventListener("change", () => {
          b.enabled = cb.checked;
          renderBackendSelects();
        });
        const nameSpan = document.createElement("strong");
        nameSpan.textContent = id;
        const typeTag = document.createElement("span");
        typeTag.className = "badge neutral";
        typeTag.textContent = b.type;
        left.append(cb, nameSpan, typeTag);
        if (id === "magpie") {
          const rec = document.createElement("span");
          rec.className = "badge";
          rec.textContent = t("recBadge");
          left.append(rec);
        } else if (id === "openrouter") {
          const role = document.createElement("span");
          role.className = "badge ok";
          role.textContent = t("catCloudAgg");
          left.append(role);
        }
        head.append(left);

        if (!BUILTIN.has(id)) {
          const del = document.createElement("button");
          del.type = "button";
          del.className = "btn small danger";
          del.textContent = t("remove");
          del.addEventListener("click", () => {
            delete draftConfig.backends[id];
            renderRouting();
          });
          head.append(del);
        }
        card.append(head);

        const grid = document.createElement("div");
        grid.className = "grid3";

        const mkInput = (labelText, value, placeholder, onChange) => {
          const f = document.createElement("label");
          f.className = "field";
          const s = document.createElement("span");
          s.className = "label";
          s.textContent = labelText;
          const inp = document.createElement("input");
          inp.type = "text";
          inp.value = value || "";
          inp.placeholder = placeholder;
          inp.spellcheck = false;
          inp.addEventListener("input", () => onChange(inp.value.trim()));
          f.append(s, inp);
          return f;
        };

        if (b.type !== "magpie") {
          grid.append(
            mkInput(t("fieldBaseUrl"), b.baseUrl, "https://...", (v) => { b.baseUrl = v; }),
            mkInput(t("fieldDefaultModel"), b.defaultModel, "model-id", (v) => { b.defaultModel = v; }),
            mkInput(t("fieldApiKeyEnv"), b.apiKeyEnv, t("fieldApiKeyEnvPh"), (v) => { b.apiKeyEnv = v || null; }),
          );
          const grid2 = document.createElement("div");
          grid2.className = "grid3 mt";
          grid2.append(
            mkInput(t("fieldEndpointPath"), b.endpointPath, b.type === "systemone" ? "/v1/systemone" : "/v1/decisions", (v) => { b.endpointPath = v || undefined; }),
            mkInput(t("fieldDataDest"), b.dataDestination, "on-device | private-network | third-party", (v) => { b.dataDestination = v || undefined; }),
            mkInput(t("fieldHeaders"), b.headers ? JSON.stringify(b.headers) : "", '{"X-Tenant":"abc"}', (v) => {
              if (!v) { delete b.headers; return; }
              try { b.headers = JSON.parse(v); } catch {}
            }),
          );
          card.append(grid, grid2);
        } else {
          grid.append(
            mkInput(t("fieldDefaultModel"), b.defaultModel, "google/gemini-decision-1", (v) => { b.defaultModel = v; }),
            mkInput(t("fieldGatewayUrl"), b.gatewayUrl, t("fieldGatewayUrlPh"), (v) => { b.gatewayUrl = v || undefined; }),
          );
          card.append(grid);
        }
        return card;
      }),
    );
  }

  function renderKeys() {
    if (!boot) return;
    $("secretsPathLabel").textContent = boot.secretsPath;
    $("keychainOpt").disabled = !boot.keychainSupported;
    $("keyList").replaceChildren(
      ...(boot.keys || []).map((k) => {
        const row = document.createElement("div");
        row.className = "key-row";
        const left = document.createElement("div");
        const nm = document.createElement("strong");
        nm.className = "mono";
        nm.textContent = k.name;
        left.append(nm);

        const right = document.createElement("div");
        right.style.display = "flex";
        right.style.alignItems = "center";
        right.style.gap = "8px";
        const badge = document.createElement("span");
        badge.className = "badge " + (k.source ? "ok" : "neutral");
        const srcLabel = k.source ? (I18N[lang][`keySrc_${k.source}`] || k.source) : "";
        badge.textContent = k.source ? `${t("keySetPrefix")} (${srcLabel})` : t("keyNotSet");
        right.append(badge);

        if (k.source === "secrets.json" || k.source === "keychain") {
          const rm = document.createElement("button");
          rm.type = "button";
          rm.className = "btn small danger";
          rm.textContent = t("remove");
          rm.addEventListener("click", async () => {
            try {
              const res = await api(`/api/keys/${encodeURIComponent(k.name)}`, { method: "DELETE" });
              boot.keys = res.keys;
              renderKeys();
              showToast(t("removedKey"));
              refreshStatus();
            } catch (err) {
              showToast(err.message, true);
            }
          });
          right.append(rm);
        }

        row.append(left, right);
        return row;
      }),
    );
  }

  function renderHardware() {
    if (!envData) return;
    const hw = envData.environment.hardware;
    const rec = envData.recommendations;
    const wrap = document.createElement("div");
    const grid = document.createElement("div");
    grid.className = "hw-grid";
    const specs = [
      [t("hwOsLabel"), `${hw.platform}/${hw.arch} (${hw.cpu_cores} ${t("hwCoresUnit")})`],
      [t("hwRamLabel"), I18N[lang].hwRamFmt(hw.total_ram_gb, hw.free_ram_gb)],
      [t("hwAccelLabel"), hw.gpu?.name || hw.gpu?.accelerator || "CPU"],
      [t("hwDiskLabel"), hw.free_disk_gb !== null ? `${hw.free_disk_gb} GB` : t("hwUnknown")],
    ];
    for (const [k, v] of specs) {
      const box = document.createElement("div");
      box.className = "stat";
      box.innerHTML = `<div class="k"></div><div class="v" style="font-size:14px"></div>`;
      box.querySelector(".k").textContent = k;
      box.querySelector(".v").textContent = v;
      grid.append(box);
    }
    wrap.append(grid);

    const activeNotes = lang === "zh" && Array.isArray(rec.notes_zh) && rec.notes_zh.length
      ? rec.notes_zh
      : rec.notes || [];
    for (const note of activeNotes) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = note;
      wrap.append(p);
    }

    for (const r of rec.local_recommendations || []) {
      const item = document.createElement("div");
      item.className = "rec-item";
      const h = document.createElement("div");
      const tierText = I18N[lang][`tier_${r.tier}`] || r.tier.toUpperCase();
      const runtimeText = lang === "zh" && r.runtime_zh ? r.runtime_zh : r.runtime;
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = tierText;
      const modelEl = document.createElement("strong");
      modelEl.textContent = ` ${r.model} `;
      const metaEl = document.createElement("span");
      metaEl.className = "muted";
      metaEl.textContent = `(${runtimeText} · ${I18N[lang].hwMemUnit(r.approx_memory_gb)})`;
      h.append(badge, modelEl, metaEl);
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = lang === "zh" && r.reason_zh ? r.reason_zh : r.reason;
      const pre = document.createElement("pre");
      pre.className = "code-out";
      pre.textContent = `${r.install_steps.join("\n")}\n${r.serve_command}`;
      item.append(h, p, pre);
      wrap.append(item);
    }
    $("hwContent").replaceChildren(wrap);
  }

  function renderClientSnippet() {
    if (!boot) return;
    const stdio = boot.stdioPath;
    const repo = boot.repoRoot;
    const snippets = {
      "claude-desktop": JSON.stringify(
        {
          mcpServers: {
            "light-decision-mcp": {
              command: "node",
              args: [stdio],
            },
          },
        },
        null,
        2,
      ),
      "claude-code": `claude mcp add light-decision-mcp -- node "${stdio}"`,
      cursor: JSON.stringify(
        {
          mcpServers: {
            "light-decision-mcp": {
              command: "node",
              args: [stdio],
            },
          },
        },
        null,
        2,
      ),
      "cc-switch":
        (lang === "zh"
          ? "# 在 CC Switch → MCP 管理中添加 stdio 服务器，可一键同步到 Claude Code / Codex / Gemini CLI / Hermes：\n"
          : "# Add this stdio server in CC Switch → MCP Servers to sync across Claude Code / Codex / Gemini CLI / Hermes:\n") +
        JSON.stringify(
          {
            "light-decision-mcp": {
              type: "stdio",
              command: "node",
              args: [stdio],
            },
          },
          null,
          2,
        ),
      magpie: `# ${lang === "zh" ? "推荐：自动注册 6 个工具 + 可视化配置页，零存 Key" : "Recommended: registers 6 tools + visual page, zero stored keys"}\nmagpie plugin add "${repo}"\n# Optional stdio entry for claude-desktop:\nmagpie library mcp add light-decision-mcp node "${stdio}" agents=claude-desktop`,
    };
    $("clientSnippet").textContent = snippets[activeClient] || "";
  }

  async function refreshStatus() {
    try {
      liveStatus = await api("/api/status");
      renderOverview();
      renderBackendSelects();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function loadEnvironment() {
    try {
      envData = await api("/api/environment");
      renderHardware();
    } catch (err) {
      $("hwContent").textContent = err.message;
    }
  }

  async function init() {
    try {
      boot = await api("/api/bootstrap");
      $("verTag").textContent = `v${boot.version}`;
      draftConfig = structuredClone(boot.config);
      applyI18n();
      await refreshStatus();
      loadEnvironment();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // Tab navigation
  $("navTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (!btn) return;
    const target = btn.dataset.tab;
    $("navTabs").querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.tab === target));
    });
    document.querySelectorAll(".panel").forEach((p) => {
      p.hidden = p.dataset.panel !== target;
    });
  });

  $("langBtn").addEventListener("click", () => {
    lang = lang === "zh" ? "en" : "zh";
    applyI18n();
  });

  $("refreshBtn").addEventListener("click", () => refreshStatus());
  $("reprobeHwBtn").addEventListener("click", () => loadEnvironment());

  $("modeSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-mode]");
    if (!btn || !draftConfig) return;
    draftConfig.routingMode = btn.dataset.mode;
    renderRouting();
  });

  $("destSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-dest]");
    if (!btn || btn.disabled || !draftConfig) return;
    draftConfig.maxDataDestination = btn.dataset.dest;
    renderRouting();
  });

  $("defaultBackendSelect").addEventListener("change", (e) => { draftConfig.defaultBackend = e.target.value; });
  $("defaultModelInput").addEventListener("input", (e) => { draftConfig.defaultModel = e.target.value; });
  $("fallbackBackendSelect").addEventListener("change", (e) => { draftConfig.fallbackBackend = e.target.value; });
  $("fallbackUnconfCheck").addEventListener("change", (e) => { draftConfig.fallbackOnNotConfigured = e.target.checked; });
  $("timeoutMsInput").addEventListener("input", (e) => { draftConfig.timeoutMs = Number(e.target.value); });
  $("primaryTimeoutMsInput").addEventListener("input", (e) => { draftConfig.primaryTimeoutMs = Number(e.target.value); });
  $("fallbackTimeoutMsInput").addEventListener("input", (e) => { draftConfig.fallbackTimeoutMs = Number(e.target.value); });
  $("cbThresholdInput").addEventListener("input", (e) => {
    draftConfig.circuitBreaker = draftConfig.circuitBreaker || {};
    draftConfig.circuitBreaker.failureThreshold = Number(e.target.value);
  });
  $("cbCooldownInput").addEventListener("input", (e) => {
    draftConfig.circuitBreaker = draftConfig.circuitBreaker || {};
    draftConfig.circuitBreaker.cooldownMs = Number(e.target.value);
  });
  $("gatewayUrlInput").addEventListener("input", (e) => { draftConfig.gatewayUrl = e.target.value; });

  $("addBackendBtn").addEventListener("click", () => {
    const box = $("presetPicker");
    box.hidden = !box.hidden;
  });

  $("closePresetBtn").addEventListener("click", () => {
    $("presetPicker").hidden = true;
  });

  $("presetPicker").addEventListener("click", (e) => {
    const card = e.target.closest("button[data-preset]");
    if (!card || !draftConfig) return;
    const preset = GATEWAY_PRESETS[card.dataset.preset];
    if (!preset) return;
    draftConfig.backends = draftConfig.backends || {};
    if (draftConfig.backends[preset.id]) {
      draftConfig.backends[preset.id].enabled = true;
      $("presetPicker").hidden = true;
      renderRouting();
      showToast(t("existsPreset"));
      return;
    }
    draftConfig.backends[preset.id] = structuredClone(preset.cfg);
    $("presetPicker").hidden = true;
    renderRouting();
    showToast(t("addedPreset"));
  });

  $("addCustomGwBtn").addEventListener("click", () => {
    if (!draftConfig) return;
    const id = ($("customGwId").value || "").trim();
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(id)) {
      showToast(t("invalidId"), true);
      return;
    }
    const resolvedType = $("customGwType").value || "openai-decisions";
    const defaultPath =
      resolvedType === "systemone"
        ? "/v1/systemone"
        : resolvedType === "gemini-decisions"
          ? "/v1beta/decisions"
          : "/v1/decisions";
    draftConfig.backends = draftConfig.backends || {};
    draftConfig.backends[id] = {
      type: resolvedType,
      enabled: true,
      baseUrl: "https://gateway.example.com",
      endpointPath: defaultPath,
      defaultModel: "gemini-decision-1",
      apiKeyEnv: `${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`,
      dataDestination: "private-network",
    };
    $("customGwId").value = "";
    $("presetPicker").hidden = true;
    renderRouting();
    showToast(t("addedPreset"));
  });

  $("saveConfigBtn").addEventListener("click", async () => {
    try {
      const res = await api("/api/config", { method: "PUT", body: draftConfig });
      draftConfig = structuredClone(res.config);
      boot.config = res.config;
      boot.keys = res.keys;
      renderRouting();
      renderKeys();
      showToast(t("savedConfig"));
      await refreshStatus();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  $("keyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const name = $("keyNameInput").value.trim().toUpperCase();
      const value = $("keyValueInput").value.trim();
      const store = $("keyStoreSelect").value;
      const res = await api("/api/keys", { method: "POST", body: { name, value, store } });
      $("keyValueInput").value = "";
      boot.keys = res.keys;
      renderKeys();
      showToast(t("savedKey"));
      await refreshStatus();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  $("pgTool").addEventListener("change", () => {
    const tool = $("pgTool").value;
    $("pgItemsField").hidden = tool === "yes_no";
    $("pgItemsLabel").textContent =
      tool === "choose"
        ? lang === "zh" ? "候选选项（逗号分隔）" : "Options (comma-separated)"
        : lang === "zh" ? "有序档位，从低到高（逗号分隔）" : "Ordered levels, lowest first (comma-separated)";
  });

  $("runTestBtn").addEventListener("click", async () => {
    const tool = $("pgTool").value;
    const args = {
      state: $("pgState").value,
      question: $("pgQuestion").value,
    };
    if ($("pgMode").value) args.mode = $("pgMode").value;
    if ($("pgBackend").value) args.backend = $("pgBackend").value;
    if (tool === "choose") {
      args.options = $("pgItems").value.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (tool === "score") {
      args.levels = $("pgItems").value.split(",").map((s) => s.trim()).filter(Boolean);
    }

    $("pgSummary").textContent = t("running");
    $("pgOutput").hidden = false;
    $("pgOutput").textContent = "...";
    try {
      const res = await api("/api/test", { method: "POST", body: { tool, arguments: args } });
      const r = res.result;
      if (r?.error) {
        $("pgSummary").textContent = `ERROR: ${r.error.code}`;
      } else {
        const picked = r.answer ?? r.choice ?? r.label ?? "";
        $("pgSummary").textContent = `${r.backend} (${r.model}) · ${picked} · conf=${r.confidence} · ${r.latency_ms}ms${r.fallback_used ? " · FALLBACK" : ""}`;
      }
      $("pgOutput").textContent = JSON.stringify(r, null, 2);
      refreshStatus();
    } catch (err) {
      $("pgSummary").textContent = "ERROR";
      $("pgOutput").textContent = err.message;
    }
  });

  $("clientSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-client]");
    if (!btn) return;
    activeClient = btn.dataset.client;
    $("clientSeg").querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.client === activeClient));
    });
    renderClientSnippet();
  });

  $("copySnippetBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("clientSnippet").textContent || "");
      $("copySnippetBtn").textContent = t("copied");
      setTimeout(() => { $("copySnippetBtn").textContent = t("copy"); }, 1200);
    } catch {}
  });

  init();
})();
