# Light Decision MCP — Technical Specification (SPEC)

> **Project / Package / Plugin Name**: `light-decision-mcp`
> **Repository**: `light-cheng/Light-Decision-MCP`
> **Status**: v0.1.0 (Implemented & Verified — Ready for Release)
> **License**: MIT (Zero runtime external dependencies, pure Node.js / Bun ESM)

---

## 1. Positioning & Goals

`light-decision-mcp` is a standalone, zero-dependency **multi-backend Decision MCP server and Magpie Plugin** that exposes fast, typed, probability-calibrated "System One" decision models (`noul` / yes-no, `choice`, `score`) to AI agents.

### 1.1 Core Goals
1. **Multi-Backend & Vendor-Agnostic**: Support multiple cloud decision APIs (Google AI Studio `gemini-decision-1`, TypeSafe `Jev`, Perplexity Decisions API `pplx-decider-*`, OpenAI `gpt-6-luna`, Cloudflare Clef, Bailian/Qwen/Ark, etc.) **and** local on-device decision models (local `opendecider serve`, Magpie-managed Ollama / MLX-Serve / oMLX) through a unified interface.
2. **Magpie-Native First, Host-Agnostic Always**:
   - Load cleanly into **Magpie Plugin Tools → Library MCP** (auto-exposing to all HTTP/Hub-capable agents managed by Magpie: `agy`, `claude`, `codex`, `cursor`, `dsh`, `grok`, `hermes`, `pi`, `zed`).
   - Ship a thin **stdio MCP entry** (`bin/stdio.mjs`) sharing the exact same core, enabling full compatibility with `claude-desktop` and any non-Magpie MCP client.
3. **Zero Plaintext Secrets**:
   - When routing through the local Magpie gateway, store **zero API keys** and automatically inherit Magpie's provider credentials, rotation, quotas, and privacy redaction (`redact` / `redactPersonal`).
   - When connecting directly to third-party APIs (e.g., Perplexity, direct TypeSafe/Google/OpenAI), reference keys strictly via environment variable names (`apiKeyEnv`) — never persist raw keys in the repository or config file.
4. **Hardware-Aware Local Model Advisor & Setup Wizard**: Provide an interactive CLI (`light-decision-mcp setup`, plus read-only `doctor` and `recommend`) that measures actual host hardware (CPU/arch, RAM, GPU, disk) and guides users through choosing, installing, and verifying local models and/or cloud providers without destructive edits.
5. **Strict Independence & Safe Coexistence**:
   - Completely independent of any external agent skill (including `light-decide`); default execution never invokes external skills. Downstream skill integration is out of scope for V1 and can consume the structured `status` and decision outputs later without breaking changes.
   - Coexist safely alongside existing local `opendecider` MCP installations with zero tool-name collisions or service disruption.

### 1.2 Non-Goals (V1)
- No generative chat completions or prompt-and-parse fallback over general-purpose LLMs.
- No automatic skill invocation or workflow policy enforcement inside the MCP server.
- No audio, video, or large PDF upload pipelines in V1 (V1 multimodal scope is images only).
- No infinite or hidden retry loops on upstream failures.

---

## 2. Architecture Overview

```text
light-decision-mcp/
├── SPEC.md                     # This specification
├── AGENTS.md                   # Coding invariants, wire-protocol rules & verification steps
├── README.md                   # Default English README (links to README.zh-CN.md)
├── README.zh-CN.md             # Chinese README (links back to README.md)
├── LICENSE                     # MIT
├── package.json                # type: "module", main, exports, bin, magpie.{icon,page,options}
├── assets/
│   ├── icon.png                # Selected project icon (also embedded as resized base64 in package.json)
│   └── screenshots/            # Sanitized bilingual UI screenshots (excluded from npm tarball)
├── page/                       # Magpie sandboxed visual plugin settings page (CSP connect-src 'none')
│   ├── index.html              # Loads _magpie/bridge.js first; no inline scripts
│   ├── style.css               # Uses --magpie-* theme variables
│   ├── app.js                  # Debounced (>= 1.1s) magpie.options.get/set + custom backend ID support
│   └── icon.png                # 128x128 page sidebar icon
├── src/
│   ├── core/
│   │   ├── errors.mjs          # Standardized DecisionError codes & availability fault classification
│   │   ├── schema.mjs          # Pure JSON Schema tool definitions, JSON-string container coercion & runtime validators
│   │   ├── normalize.mjs       # Unified response normalization (array/map probabilities, confidence, score/level alignment)
│   │   ├── images.mjs          # Safe local file / data URI / HTTPS image loader & limits
│   │   ├── circuit-breaker.mjs # Per-backend circuit breaker (closed / open / half_open) & cooldown tracking
│   │   ├── router.mjs          # Backend registry, question-ID wire aliasing, routing modes & data-boundary guard
│   │   └── tools.mjs           # 6 core tool handlers + mtime-based zero-restart config/secrets/plugins.json hot reload
│   ├── backends/
│   │   ├── http.mjs            # Shared fetch transport, AbortSignal budgeting & wire-format payload builders
│   │   ├── magpie.mjs          # Local Magpie gateway (/v1/systemone & /v1/decisions + 0-token validation probe)
│   │   ├── systemone.mjs       # Universal System One adapter (local opendecider, TypeSafe Jev, OpenRouter /api/alpha/decisions, LAN nodes)
│   │   ├── perplexity.mjs      # Direct Perplexity Decisions API (/v1/decisions + optional web_grounding)
│   │   └── direct-cloud.mjs    # Direct Google (/v1beta/decisions), OpenAI (/v1/decisions) & custom Decisions gateways
│   ├── config/
│   │   ├── load.mjs            # Layered config loader, non-clobbering plugin options & standalone non-Magpie discovery
│   │   └── secrets.mjs         # Direct-key resolver (env -> 0600 ~/.config/light-decision-mcp/secrets.json -> macOS Keychain)
│   ├── admin/                  # Standalone loopback-only Web Admin UI (`light-decision-mcp ui`)
│   │   ├── server.mjs          # 127.0.0.1 HTTP server (Host/Origin check, per-session CSRF token, strict CSP, zero key echo)
│   │   └── ui/                 # Bilingual SPA (index.html, style.css, app.js) — live health, presets, keys, playground, clients
│   ├── wizard/
│   │   ├── hardware.mjs        # Real host measurements (OS/arch, RAM, GPU/Metal/CUDA, disk, installed CLIs)
│   │   ├── recommend.mjs       # Hardware-tiered local model recommendations & local-vs-cloud trade-offs
│   │   └── setup.mjs           # Interactive, confirmation-gated setup & read-only doctor/recommend CLI
│   └── magpie-plugin.mjs       # Magpie OpenCode v1 plugin entry: export default { id, server }
├── bin/
│   ├── cli.mjs                 # CLI dispatcher: ui | setup | doctor | recommend | key | stdio
│   └── stdio.mjs               # Zero-dependency NDJSON JSON-RPC 2.0 MCP server over stdio (sequential framing)
└── tests/                      # node --test unit, mock-gateway, hot-reload, admin-ui, plugin-host, stdio & wizard suites
```

---

## 3. Magpie Plugin Host Contract & Critical Guardrails

Verified against the local Magpie plugin host (`host-*.js`):

1. **Module Format & Entrypoint**:
   - `package.json` MUST set `"type": "module"` and `"main": "./src/magpie-plugin.mjs"` (must retain `main` even when `bin` is declared; `bin`-only packages are rejected as plugins).
   - Export via `export default { id: "light-decision-mcp", server: async (input, options) => ({ tool: { ... } }) }`. Do **not** export stray top-level helper functions on the entry module.
   - Do **not** register `auth` or `config` provider hooks (prevents ghost "Not signed in" provider cards in Magpie UI).
2. **Zero External Dependencies & Pure JSON Schema**:
   - **Never** import `@opencode-ai/plugin` (not bundled by the Magpie Bun host).
   - Define every tool's `args` as a plain JSON Schema object (`{ type: "object", properties: {...}, required: [...] }`).
   - Because the host skips schema validation for plain JSON Schema, perform strict runtime validation, type coercion checks, and default-filling inside `execute(args, ctx)`.
3. **Tool Naming & Execution**:
   - Tool names MUST match `/^[A-Za-z0-9_-]{1,48}$/`.
   - Respect `ctx.abort` (host enforces a 60s hard timeout); apply plugin-level `timeoutMs` (default `25000ms`) linked with `ctx.abort` via `AbortSignal.any`.
   - Never write logs to `stdout` (breaks plugin host RPC and stdio MCP transport). Use `input?.client?.app?.log` when available or `stderr`.
4. **Dynamic Gateway, Visual Page & Hot-Reload Handling**:
   - Discover local Magpie gateway dynamically from `<input.directory>/gateway.json` (`addr` field), overridable via `options.gatewayUrl` or `MAGPIE_GATEWAY`.
   - Keep `package.json`'s `magpie.options` defaults as empty/null placeholders (`""` / `null`) and treat empty/null values as unset in `src/config/load.mjs` so package defaults never overwrite `~/.config/light-decision-mcp/config.json`.
   - Register `magpie.page` (`page/index.html`, CSP `connect-src 'none'`, no inline scripts, `_magpie/bridge.js` loaded first, debounced `>= 1.1s` `magpie.options.set()`, `--magpie-*` theme tokens).
   - Watch `mtime` across `config.json`, `secrets.json`, and `<magpieDir>/plugins.json` inside `src/core/tools.mjs` to hot-reload configuration changes on the next tool call without restarting Magpie or stdio MCP (preserving the live circuit breaker state).
   - Magpie omits decision-only models (e.g., `google/gemini-decision-1`) from `GET /v1/models`; `magpie.mjs` `status()` performs a local 0-token validation probe on `POST /v1/decisions` (`400` missing `"input"` = registered & ready; `404` = model not configured).

---

## 4. Multi-Backend Adapter & Routing Design

### 4.1 Supported Backend Adapters

| Adapter ID | Protocol & Endpoint | Covered Providers / Models | Image Input | Data Destination |
| :--- | :--- | :--- | :--- | :--- |
| `magpie` | `POST /v1/systemone` & `POST /v1/decisions` (0-token `POST /v1/decisions` validation probe + `GET /v1/models`) | **Recommended local gateway** (zero stored keys): Google `google/gemini-decision-1`, TypeSafe/Vercel/Cloudflare Jev & Clef, OpenAI/Azure `gpt-6-luna`, Bailian/Qwen/Ark, Ollama/MLX-Serve/oMLX, Magpie Decision Groups | Yes for `google/gemini-decision-1` & Cloudflare Clef (routed via `/v1/decisions` `[{ role: "user", content: [{ type: "input_text" }, { type: "input_image" }] }]`) | Derived per model (`ollama`/`mlx-serve`/`omlx` → `on-device`; cloud/unknown → `third-party`) |
| `systemone` | `POST <baseUrl><endpointPath>` (default `/v1/systemone`; `GET /ready` when loopback) | Local `opendecider serve` (`http://127.0.0.1:8001`), direct TypeSafe Jev (`https://api.typesafe.ai`), **OpenRouter cloud aggregator** (`https://openrouter.ai`, `endpointPath: "/api/alpha/decisions"`, `OPENROUTER_API_KEY`), private-network servers | Optional (`supportsImages` + optional `imagesHeader`) | Loopback → `on-device`; LAN/configured → `private-network`; TypeSafe/OpenRouter → `third-party` |
| `perplexity` | `POST https://api.perplexity.ai/v1/decisions` (`Authorization: Bearer`) | `pplx-decider-v1.3`, `pplx-decider-flash-v1.3` (plus optional `web_grounding`) | Per model support | `third-party` |
| `google-direct` / `gemini-decisions` | `POST <baseUrl><endpointPath>` (default `https://generativelanguage.googleapis.com/v1beta/decisions`) | `gemini-decision-1` (via `GEMINI_API_KEY` / `GOOGLE_API_KEY`) or custom Gemini Decisions proxies | Yes (inline base64 / URL parts) | `third-party` (overridable via `dataDestination`) |
| `openai-direct` / `openai-decisions` / `decisions-gateway` | `POST <baseUrl><endpointPath>` (default `https://api.openai.com/v1/decisions`) | `gpt-6-luna` (via `OPENAI_API_KEY`), self-hosted **LiteLLM Proxy** (`http://127.0.0.1:4000/v1/decisions`), or custom Decisions gateways with custom `headers` & `apiKeyEnv` | Yes (`input_image`, configurable via `supportsImages`) | `third-party` (overridable via `dataDestination`) |

### 4.2 Routing Modes (`routingMode`)
Users can choose among three explicit routing modes in config, plugin options, or per-call `mode` override:

1. **`api_only`**: Route strictly to the configured API/cloud backend (e.g., `magpie` → `google/gemini-decision-1`, `typesafe`, `perplexity`, `openai-direct`). Fail fast on upstream error without touching local models.
2. **`local_only`**: Route strictly to local `on-device` backends (e.g., `local-opendecider` at `127.0.0.1:8001` or Magpie local `ollama`/`mlx-serve`/`omlx`). Automatically locks `maxDataDestination` to `"on-device"`; zero payload leaves the machine.
3. **`api_with_local_fallback`** *(recommended when both cloud and local backends exist)*:
   - **Primary**: Cloud/API backend (`defaultBackend`, e.g., `magpie` / `google/gemini-decision-1`).
   - **Fallback**: Local `on-device` backend (`fallbackBackend`, e.g., `local-opendecider`), triggered automatically on upstream availability faults or an open circuit window.
   - *(Never silently escalates from local to cloud; an explicit `backend` argument in a single call targets that specific backend directly without hidden fallback unless `mode: "api_with_local_fallback"` is also specified.)*

### 4.3 Circuit Breaker & Instant Fallback Policy (`src/core/circuit-breaker.mjs`)
In `api_with_local_fallback` mode, each backend maintains an in-process circuit breaker (`closed` → `open` → `half_open`):

- **Fallback triggers** (availability faults only):
  - Connection refused / DNS / network errors (`gateway_unreachable`, `network_error`)
  - Primary request timeout (`timeout` — **never** falls back if the caller's own `ctx.abort` cancelled the overall call)
  - HTTP `429` (`rate_limited`)
  - HTTP `5xx` (`500`, `502`, `503`, `504` / `upstream_error`)
  - Primary circuit is already `open` → **0 ms skip** directly to local fallback (`primary_error.code = "circuit_open"`)
  - Optional config flag `fallbackOnNotConfigured` (default `false`; if `true`, also falls back on `not_configured` / `model_not_found`, useful before cloud keys are added)
- **Non-fallback conditions** (must fail fast without masking errors):
  - `400 invalid_arguments` (caller schema error)
  - `data_boundary_exceeded` (policy guard)
  - **Multimodal safety gate**: If the request contains `images` and the fallback backend does **not** support images, **refuse silent image drop** — fail with the primary error plus `fallback: { attempted: false, skipped_reason: "images_unsupported" }` (unless caller explicitly sets `allow_image_drop_on_fallback: true`, default `false`).
- **Circuit thresholds & timeout budgeting**:
  - `failureThreshold`: `2` consecutive availability failures (or `1` immediately on connection refused / `429` with `Retry-After`) opens the circuit.
  - `cooldownMs`: `30000` ms default (honors upstream `Retry-After`, capped at `120000` ms). After cooldown, enters `half_open` and probes one request.
  - **Timeout split**: In `api_with_local_fallback` mode, primary gets `primaryTimeoutMs` (default `15000` ms) and local fallback gets remaining budget (`fallbackTimeoutMs`, default `10000` ms), ensuring total latency stays safely below Magpie host's 60s hard ceiling.
- **Batch resilience (`decide_batch`)**: If the primary trips mid-batch, the circuit opens immediately and the failed item plus remaining items seamlessly switch to local fallback, reporting `fallback_count` and per-item provenance.

### 4.4 Cross-Protocol Input & Response Alignment Notes
Critical wire-level differences between cloud Decisions APIs and System One (`opendecider` / Jev) handled transparently by adapters and `normalize.mjs`:

1. **Input field alignment (`input` vs `state`)**:
   - Gemini Decisions (`/v1beta/decisions`) & OpenAI Decisions (`/v1/decisions`) expect `input` (string or multimodal content-block array).
   - System One (`/v1/systemone`, OpenDecider, TypeSafe Jev) expects `state` (string or arbitrary JSON object/array).
   - Adapters normalize `state` deterministically across both directions:
     - Object/array `state` → JSON string (or structured block) when targeting text-only `input` endpoints;
     - Structured/text `state` → preserved natively as JSON or serialized string when falling back to `/v1/systemone`;
     - Image blocks never silently stripped during fallback (governed by Section 4.3 multimodal gate).
2. **Score response alignment (`score` vs `level` + `legend`)**:
   - Both sides return `noul`, `choice`, and `score` with `probabilities` and `confidence`.
   - **Key difference on `score`**:
     - Gemini returns `score` as the probability-weighted **expected float** + `legend` + `probabilities`.
     - OpenDecider wire protocol returns `score` as the **integer argmax level index** (`0..N-1`), `expected` as the expected float, `legend` (`{"0": "low", ...}`), and index-keyed `probabilities`.
   - **Unified rule in `normalize.mjs`**:
     1. Remap `probabilities` into a complete map keyed by level label (`{ [L[i]]: p_i }`) regardless of whether upstream keyed by index, `legend`, label, or Magpie `/v1/decisions` array form (`[{ value|label, probability }]`).
     2. Compute `level` (integer `0..N-1`) as `argmax_i(probabilities[L[i]])` and `label = L[level]` (aligning Gemini & Jev to OpenDecider's `level` + `label`).
     3. Compute `expected_level` and `score` (identical floats) as `sum(i * p_i)` (verified against upstream `expected` / Gemini expected `score`).
     4. Derive `confidence` uniformly from `probabilities`, and keep upstream's raw confidence in `provider_confidence`.
3. **Wire question-ID aliasing & CLI container coercion**:
   - Upstream engines such as Google `gemini-decision-1` strictly reject question IDs that do not match `/^[A-Za-z0-9_-]{1,64}$/` (including spaces, punctuation, or CJK text). Shortcut tools (`yes_no`, `choose`, `score`) use fixed wire keys (`"yes_no"`, `"choice"`, `"score"`), and `router.mjs` transparently aliases any non-matching caller key in `decide`/`decide_batch` to `q_0`, `q_1`, … before restoring original keys in the response.
   - `src/core/schema.mjs` parses JSON-stringified object/array inputs (`options`, `levels`, `questions`, `states`, `images`) so CLI callers such as `magpie tool` work seamlessly.

### 4.5 Configuration Precedence, Secret Resolution & Schema
Precedence (highest → lowest):
1. Per-call tool arguments (`mode`, `backend`, `model`, `max_data_destination`, `web_grounding`)
2. Non-empty Magpie plugin options (`server(input, options)` merged with live `<magpieDir>/plugins.json`)
3. User config file (`LIGHT_DECISION_CONFIG` or `~/.config/light-decision-mcp/config.json`)
4. Environment variables (`MAGPIE_GATEWAY`, `LIGHT_DECISION_MODE`, `LIGHT_DECISION_BACKEND`, `LIGHT_DECISION_FALLBACK_BACKEND`, `LIGHT_DECISION_MODEL`, `OPENDECIDER_URL`, `TYPESAFE_BASE_URL`, `TYPESAFE_API_KEY`, `PERPLEXITY_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`) and direct-provider secret store (`0600` `~/.config/light-decision-mcp/secrets.json` → macOS Keychain via `light-decision-mcp key set|list|rm [--keychain]`)
5. Zero-config auto-discovery:
   - Local Magpie gateway (`gateway.json`) + local 0-token `/v1/decisions` validation probe
   - Local `opendecider` HTTP endpoint (`http://127.0.0.1:8001/ready`)
   - Standalone non-Magpie environments automatically disable `magpie` and select the first enabled direct/custom backend or `local-opendecider`

Example `~/.config/light-decision-mcp/config.json` (zero plaintext keys):
```json
{
  "version": 1,
  "routingMode": "api_with_local_fallback",
  "defaultBackend": "magpie",
  "fallbackBackend": "local-opendecider",
  "defaultModel": "google/gemini-decision-1",
  "timeoutMs": 25000,
  "primaryTimeoutMs": 15000,
  "fallbackTimeoutMs": 10000,
  "fallbackOnNotConfigured": false,
  "circuitBreaker": {
    "failureThreshold": 2,
    "cooldownMs": 30000,
    "maxCooldownMs": 120000
  },
  "maxDataDestination": "third-party",
  "backends": {
    "magpie": {
      "type": "magpie",
      "enabled": true,
      "defaultModel": "google/gemini-decision-1"
    },
    "local-opendecider": {
      "type": "systemone",
      "enabled": true,
      "baseUrl": "http://127.0.0.1:8001",
      "sendModel": false,
      "dataDestination": "on-device"
    },
    "typesafe": {
      "type": "systemone",
      "enabled": false,
      "baseUrl": "https://api.typesafe.ai",
      "defaultModel": "jev-latest",
      "apiKeyEnv": "TYPESAFE_API_KEY",
      "dataDestination": "third-party"
    },
    "perplexity": {
      "type": "perplexity",
      "enabled": false,
      "baseUrl": "https://api.perplexity.ai",
      "defaultModel": "pplx-decider-v1.3",
      "apiKeyEnv": "PERPLEXITY_API_KEY",
      "dataDestination": "third-party"
    }
  }
}
```

### 4.6 Data-Boundary Guard
Ordered boundary levels: `on-device` < `private-network` < `third-party`.
- If a call specifies `max_data_destination` (or config sets `maxDataDestination`, or `routingMode === "local_only"`) and the resolved backend's `data_destination` exceeds that limit, reject immediately before any network call with structured error code `data_boundary_exceeded`.
- Never silently escalate a request from local to cloud.

---

## 5. MCP Tool Contracts (6 Core Tools)

> **Design Decision**: Keep **6 tools** (`decide`, `choose`, `yes_no`, `score`, `decide_batch`, `status`). Backend & model discovery is embedded directly inside `status` (with optional filter params) to avoid spending an extra MCP tool schema slot across every agent session.

### 5.1 Common Optional Routing & Input Parameters
On inference tools (`decide`, `choose`, `yes_no`, `score`, `decide_batch`):
- `mode` (`"api_only" | "local_only" | "api_with_local_fallback"`, optional): Override routing mode for this call.
- `backend` (`string`, optional): Named backend ID (e.g. `"magpie"`, `"local-opendecider"`, `"perplexity"`, `"typesafe"`).
- `model` (`string`, optional): Override model ID (e.g. `"google/gemini-decision-1"`, `"openai/gpt-6-luna"`, `"pplx-decider-v1.3"`, `"group/<decision-group>"`).
- `max_data_destination` (`"on-device" | "private-network" | "third-party"`, optional): Hard data boundary for this call.
- `web_grounding` (`boolean`, optional): Passed only when supported by the target backend (e.g., Perplexity); ignored or rejected with clear warning if unsupported.
- `images` (`string[]`, optional, on `decide`, `choose`, `yes_no`, `score`): Up to `4` images per call.

### 5.2 Tool Definitions
1. **`decide`**:
   - Required: `state` (`string | object | array`), `questions` (`Record<string, QuestionDef>`).
   - Question types:
     - `noul`: `{ type: "noul", instructions: string, criteria?: { true?: string, false?: string } }` (also accepts `true_description` / `false_description` aliases).
     - `choice`: `{ type: "choice", instructions: string, criteria: string[] | Record<string, string> }` (2–255 options).
     - `score`: `{ type: "score", instructions: string, criteria: string[] | { label: string, description?: string }[] }` (2–255 ordered levels, lowest first; also accepts `levels` alias).
   - Limits (configurable via options): max `64` questions (up to `256`), max `255` options per question, max `200,000` serialized state chars.
2. **`choose`**:
   - Required: `state`, `question` (`string`), `options` (`string[] | Record<string, string>`).
3. **`yes_no`**:
   - Required: `state`, `question` (`string`).
   - Optional: `true_description` (`string`), `false_description` (`string`).
4. **`score`**:
   - Required: `state`, `question` (`string`), `levels` (`string[] | { label: string, description?: string }[]`, lowest first).
5. **`decide_batch`**:
   - Required: `states` (`Array<string | object | array>`), `questions` (`Record<string, QuestionDef>`).
   - Limits: max `64` states, max `512` total `states × questions`, bounded client fan-out concurrency (default `4`, configurable up to `16`).
6. **`status`** (read-only, never triggers billable inference):
   - Optional filters: `backend` (`string`), `data_destination` (`"on-device" | "private-network" | "third-party"`), `multimodal` (`boolean`).
   - Returns:
     - `version`, `routing_mode`, `default_backend`, `fallback_backend`, `default_model`, `max_data_destination`
     - `backends`: per-backend reachability, `ready`, `data_destination`, `capabilities` (`images`, `web_grounding`), `available_models`, live `circuit` state (`state`, `consecutive_failures`, `open_until`, `last_error`), and actionable `setup_hint` when unconfigured (e.g., `magpie provider add google <API_KEY>` or `light-decision-mcp setup`).
     - `limits`: active limits (`questions`, `options`, `state_chars`, `images`, `image_max_bytes`, `batch_states`, `batch_items`, `batch_concurrency`, `timeout_ms`, `primary_timeout_ms`, `fallback_timeout_ms`).

### 5.3 Image Input Security & Validation (`src/core/images.mjs`)
- Accepted formats:
  1. Local file paths (absolute or relative to `ctx.directory` / `process.cwd()`): `lstat`/`stat` regular file check, extension + magic-byte MIME verification (`image/png`, `image/jpeg`, `image/webp`, `image/gif`), max `10 MB` per file, converted to `data:<mime>;base64,...`.
  2. Inline Data URI (`data:image/(png|jpeg|webp|gif);base64,...`), validated against the `10 MB` decoded limit.
  3. `https://` URLs: passed through directly to capable upstreams without plugin-side SSRF fetching; reject `http://` non-HTTPS and `file://` URLs.
- Reject early if the resolved backend/model does not support images (`images_unsupported`).

### 5.4 Unified Normalized Response Contract
Every answer normalizes across all backends so agents never parse vendor-specific payloads:

- **`yes_no` / `noul` answer**:
  ```json
  {
    "answer": "yes",
    "probability_yes": 0.94,
    "probabilities": { "yes": 0.94, "no": 0.06 },
    "confidence": 0.94,
    "provider_confidence": 0.96
  }
  ```
- **`choose` / `choice` answer**:
  ```json
  {
    "choice": "billing",
    "probabilities": { "billing": 0.91, "tech": 0.09 },
    "confidence": 0.91,
    "provider_confidence": 0.93
  }
  ```
- **`score` answer**:
  ```json
  {
    "level": 2,
    "label": "high",
    "expected_level": 1.85,
    "score": 1.85,
    "probabilities": { "low": 0.02, "medium": 0.11, "high": 0.87 },
    "confidence": 0.87,
    "provider_confidence": 0.91
  }
  ```
- **Top-level envelope**:
  - Single-question tools (`choose`, `yes_no`, `score`): `{ backend, model, data_destination, fallback_used, fallback_info?, ...answerFields, latency_ms, usage? }`
  - `decide`: `{ backend, model, data_destination, fallback_used, fallback_info?, answers: { [key]: answer }, latency_ms, usage?, warnings? }`
  - `decide_batch`: `{ backend, model, data_destination, fallback_used, fallback_count?, results: [{ index, backend?, model?, fallback_used?, answers, error? }], latency_ms, usage? }`
  - When `fallback_used === true`, `fallback_info` exposes `{ primary_backend, primary_model, reason, primary_status?, circuit_state }` so callers never mistake a local fallback result for a cloud primary result.
- **Confidence convention**:
  - `confidence` is always derived deterministically from `probabilities` (for `noul`: `max(p_yes, 1 - p_yes)`; for `choice`: winning option's probability; for `score`: top level probability, rounded to 4 decimals).
  - `provider_confidence` preserves the raw confidence value reported by the upstream model (`null` if omitted by upstream).
- **Error handling & retry policy**:
  - Default `retries = 0` on the same backend (fail fast — or immediately switch to local fallback when `routingMode === "api_with_local_fallback"` and the fault matches Section 4.3).
  - Standardized error codes: `invalid_arguments`, `not_configured`, `model_not_found`, `backend_not_found`, `data_boundary_exceeded`, `images_unsupported`, `circuit_open`, `rate_limited`, `auth_failed`, `timeout`, `gateway_unreachable`, `network_error`, `upstream_error`, `malformed_response`.

---

## 6. Local Model Advisor & Interactive Setup Wizard

Exposed via CLI (`light-decision-mcp setup`, `light-decision-mcp doctor`, `light-decision-mcp recommend`):

### 6.1 Hardware & Environment Measurement (`src/wizard/hardware.mjs`)
Never guess hardware from machine labels; always measure directly:
- OS, CPU architecture (`arm64` / `x64`), CPU core count
- Total RAM & free/available memory
- GPU acceleration detection (Apple Metal on macOS arm64, `nvidia-smi` VRAM on Linux/CUDA, else CPU-only)
- Free disk space on home/cache volume
- Existing ecosystem detection: `magpie` binary & running gateway (`gateway.json`), `opendecider` binary & live `127.0.0.1:8001/ready`, `ollama`, `omlx`, `mlx-serve`, `lmstudio`, `python3`, `uv`.

### 6.2 Tiered Local Recommendation Matrix (`src/wizard/recommend.mjs`)
- **Apple Silicon (`darwin/arm64`)**:
  - `< 8 GB` RAM or minimal footprint: `opendecider-nano`
  - `8–16 GB` RAM: `manjunathshiva/opendecider-small-mlx-4bit` (balanced speed & calibrated quality via MLX)
  - `>= 16 GB` RAM / higher local accuracy: `opendecider-small` (MLX 8-bit or Ollama/llama.cpp Q8_0 GGUF; explicitly note that LM Studio's MLX engine omits `top_logprobs`, so use llama.cpp if using LM Studio)
- **NVIDIA GPU (`>= 6 GB` VRAM)**: `opendecider-small` (PyTorch / vLLM / Ollama Q8_0)
- **CPU-only / constrained hosts**: `opendecider-nano` (or cloud API trade-off clearly stated)
- Always display clear **Local vs. Cloud trade-offs** (privacy / zero marginal cost / offline vs. multimodal images / web grounding / complex semantics).

### 6.3 Non-Destructive Interactive Setup (`src/wizard/setup.mjs`)
1. Print hardware measurement & detected backends table.
2. **Local Model Setup** (confirmation-gated):
   - Reuse running `opendecider` if healthy, or guide step-by-step venv creation, `opendecider` installation, model pull, and optional background service setup without overwriting existing services.
3. **Cloud Provider Setup**:
   - Magpie-managed vendors: print exact `magpie provider add <preset> <API_KEY>` instructions (Google, TypeSafe, OpenAI, Bailian, Qwen, Ark).
   - Direct vendors (Perplexity, TypeSafe, Google, OpenAI): write `apiKeyEnv` references only into `~/.config/light-decision-mcp/config.json`.
4. **Agent Integration & Verification**:
   - Offer exact commands for `magpie plugin add <path-or-repo>` and optional `claude-desktop` / `cc-switch` stdio registration.
   - Run read-only `doctor` verification and summarize ready backends.

### 6.4 Visual Settings Interfaces (`page/` & Standalone `light-decision-mcp ui`)
1. **Magpie Embedded Plugin Page (`page/`)**:
   - Registered via `package.json` `magpie.page`, runs inside Magpie's sandbox (`CSP connect-src 'none'`, zero daemon process), loads `_magpie/bridge.js` first, matches `--magpie-*` light/dark theme and language, debounces `magpie.options.set()` (`>= 1.1s`), recommends Magpie as primary, and allows selecting built-in presets, OpenRouter, or any custom backend ID defined in `config.json`.
2. **Standalone Local Web Admin UI (`light-decision-mcp ui`, `src/admin/`)**:
   - Zero-Magpie loopback HTTP server strictly bound to `127.0.0.1` (default port `4395`), validating `Host` and `Origin` headers, requiring a per-session random `X-CSRF-Token` on mutating endpoints (`PUT`/`POST`/`DELETE`), enforcing strict CSP, and never echoing raw API keys over HTTP.
   - Five bilingual (zh/en) views:
     - **Overview & Backends**: live backend health, capabilities, and circuit-breaker status;
     - **Routing & Gateways**: grouped backend selectors (highlighting **Magpie** as Recommended Local Gateway + live status badges), routing mode & timeout/circuit settings, inline Preset Picker (**OpenRouter** cloud aggregator, **LiteLLM Proxy** self-hosted gateway, **LAN OpenDecider**, and blank custom `openai-decisions` / `systemone` / `gemini-decisions` gateways);
     - **API Keys**: manages direct/custom keys in `0600 secrets.json` or macOS Keychain with zero plaintext echo;
     - **Playground**: live test runner for `yes_no`, `choose`, `score`;
     - **Hardware & Clients**: real host probe + recommendations + one-click copyable MCP snippets for Claude Desktop, Claude Code, Cursor / Zed, **CC Switch** (stdio MCP sync), and Magpie Plugin.

---

## 7. Repository, Bilingual Documentation, Branding & Release Standards

> **IMPORTANT RELEASE CHECKLIST — DO NOT SKIP**:

### 7.1 GitHub Remote Creation (`gh` CLI)
- **Reminder**: Use GitHub CLI (`gh`) to create and configure the remote repository once Stage 1–3 code and bilingual docs are ready:
  ```bash
  gh repo create Light-Decision-MCP --public --source=. --remote=origin --push
  gh repo edit --description "<Bilingual About description>" --add-topic mcp,magpie,magpie-plugin,decision-model,system-one,gemini-decision,local-ai
  ```

### 7.2 Bilingual Repository Standards (English Default → Chinese Switch)
1. **README (Dual-Language Pages)**:
   - `README.md` (**default English**) with a clear language switcher at the very top:
     `English | [简体中文](./README.zh-CN.md)`
   - `README.zh-CN.md` (**Simplified Chinese**) with a symmetric top switcher back to English:
     `[English](./README.md) | 简体中文`
   - Both files stay feature-for-feature in sync (Quick Start, Magpie Plugin + stdio setup, Multi-Backend config, Local Model Wizard, Tools & Schema reference, Privacy/Security model).
2. **README Visuals Policy**:
   - Include visual assets (selected icon in the header, concise Mermaid routing diagram, and sanitized EXIF-stripped per-language UI screenshots in `assets/screenshots/`, excluded from the npm tarball via `package.json` `files`) where they genuinely clarify setup and interfaces.
3. **GitHub About Description (Bilingual)**:
   - Write a concise bilingual About summary (English first, followed by Chinese, within GitHub's 350-char limit), e.g.:
     `Multi-backend Decision MCP & Magpie plugin for System One models (Gemini Decision, Jev, Perplexity & local models) with hardware-aware setup wizard. | 支持多云端与本地决策模型的 MCP / Magpie 插件，内置硬件推荐与安装向导。`
4. **GitHub Releases (Bilingual Release Notes)**:
   - Publish releases with `gh release create vX.Y.Z ...` using **bilingual release notes**:
     - Default/primary **English section** at the top with a direct jump link right under the heading: `[简体中文更新说明](#简体中文更新说明)`.
     - Full **Simplified Chinese section** (`## 简体中文更新说明`) below (or linked bilingual page), matching all highlights, breaking changes, and install/upgrade instructions.
5. **Project Icon & Magpie Branding**:
   - Save the user-selected icon to `assets/icon.png`.
   - Embed a compact square PNG (e.g., 128×128) base64 data URI in `package.json` under `magpie.icon` so Magpie UI renders the plugin cleanly.

### 7.3 Magpie Plugin Marketplace Publishing (Recommended: Path 1 + Path 2)
Keep `Light-Decision-MCP` as an independent repository (no migration into the community monorepo needed) and publish via both auto-discovery and the curated Magpie catalog:

1. **Path 1 — Automatic GitHub & npm Discovery (Zero PR, immediate)**:
   - **GitHub discovery**: Magpie indexes public repositories matching `topic:magpie-plugin archived:false fork:false` by reading root `package.json` (`name`, `version`, `main`, `magpie.icon`). Ensure the `magpie-plugin` topic is set via `gh repo edit`.
   - **npm discovery**: Publish the package to npm with `"magpie-plugin"` in `package.json` `keywords` (verify package name availability on npmjs first; if taken, switch to a scoped name such as `@<npm-user>/light-decision-mcp`).
   - Users can immediately install via `magpie plugin add <npm-package-name>` or `magpie plugin add github:light-cheng/Light-Decision-MCP`.
2. **Path 2 — Curated Magpie Marketplace (`Plugins › Discover` via `magpie-community/plugins`)**:
   - After `npm publish` succeeds and local `magpie plugin add <npm-package-name>` + `magpie tools` verify cleanly, fork [`magpie-community/plugins`](https://github.com/magpie-community/plugins) and append a `"kind": "tools"` entry (no `providers` field) to root `registry.json`:
     ```json
     {
       "package": "light-decision-mcp",
       "name": "Light Decision MCP",
       "icon": "https://raw.githubusercontent.com/light-cheng/Light-Decision-MCP/main/assets/icon.png",
       "kind": "tools",
       "community": true,
       "summary": {
         "en": "Multi-backend System One decision tools (Gemini Decision, Jev, Perplexity & local models) with API-primary local fallback and a hardware-aware setup wizard.",
         "zh": "多后端决策模型工具（支持 Gemini Decision、Jev、Perplexity 及本地模型），支持 API 主力 + 本地熔断降级，附带硬件推荐与安装向导。"
       }
     }
     ```
   - Open a PR describing tool capabilities, zero-key Magpie gateway routing + optional local/env-var backends, and verification results.
3. **Marketplace Pre-Flight Checklist**:
   - `package.json` has `"type": "module"` and `"main"` (never `bin`-only), zero `@opencode-ai/plugin` import.
   - `registry.json` `summary` includes both `en` and `zh`.
   - `icon` URL (`raw.githubusercontent.com/.../assets/icon.png`) is publicly accessible (alongside embedded `magpie.icon`).
   - Published npm package name matches `registry.json` `"package"` exactly.

---

## 8. Implementation Milestones & Acceptance Plan

| Stage | Scope & Deliverables | Status & Acceptance Criteria |
| :--- | :--- | :--- |
| **Stage 1** | `package.json`, `src/config/` (incl. `secrets.mjs`), `src/core/` (incl. `circuit-breaker.mjs`, hot-reload, wire key aliasing), `src/backends/` (Magpie, SystemOne, Perplexity, Direct Google/OpenAI & custom gateways), unit & mock-server tests | **Done** — `npm test` passes 100% covering all 6 tools, 3 routing modes, circuit breaker + instant fallback + multimodal safety gate, `input`/`state` & `score`/`level` alignment, image validation, data-boundary guard, hot reload, and error codes |
| **Stage 2** | `src/magpie-plugin.mjs`, `page/` visual plugin page, `src/admin/` standalone Web Admin UI (`light-decision-mcp ui`), `bin/stdio.mjs` + host-loader, CSRF/security & JSON-RPC stdio tests | **Done** — Bun & Node host load verified with zero external deps; stdio `initialize` / `tools/list` / `tools/call` sequential framing & Admin UI security/preset/key tests pass |
| **Stage 3** | `src/wizard/` (`hardware.mjs`, `recommend.mjs`, `setup.mjs`) + `bin/cli.mjs` (`ui`, `setup`, `doctor`, `recommend`, `key`, `stdio`) + wizard tests | **Done** — `doctor` & `recommend` run accurately on host; recommendation matrix unit-tested across macOS/Linux/CPU/GPU tiers |
| **Stage 4** | Local Magpie install (`magpie plugin add <abs-path>`), live local `opendecider` & cloud `google/gemini-decision-1` (text + image) verification, selected icon (`assets/icon.png` + `page/icon.png`), bilingual `README.md` / `README.zh-CN.md` + sanitized screenshots | **Done** — `magpie plugin list` & `magpie tools` clean with zero ghost provider cards; live `status`, local `local_only`, and cloud text + image inference (`output_tokens: 0`) verified |
| **Stage 5** | Initial `git commit`, `gh repo create light-cheng/Light-Decision-MCP` + bilingual About + `magpie-plugin` topic + push, bilingual `v0.1.0` GitHub Release, npm publish + `magpie-community/plugins` `registry.json` PR | **Pending user confirmation** — pre-commit sanitization scan passed (0 leaks); ready to commit and release on go-ahead |
