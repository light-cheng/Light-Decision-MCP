# AGENTS.md

`light-decision-mcp` is a zero-dependency ESM multi-backend Decision MCP server (stdio) and optional Magpie plugin (`tools` + visual `page`). Keep core routing, normalization, and adapters strictly decoupled from Magpie so standalone stdio MCP and custom third-party gateways work with zero Magpie installation.

## Non-Negotiable Invariants

- **Zero external runtime dependencies**: Run cleanly in both Node.js >= 20 and Magpie's embedded Bun host using Node built-ins and native `fetch` only. Never import `@opencode-ai/plugin` or `zod`.
- **Plain JSON Schema + runtime validation**: Define every tool's `args` in `src/core/schema.mjs` as plain JSON Schema and enforce strict validation inside `execute(args, ctx)`. Parse JSON-stringified object/array inputs (for CLI runners such as `magpie tool`).
- **Keep `stdout` protocol-clean**: Both the Magpie plugin host and `bin/stdio.mjs` use `stdout` for RPC framing. Write diagnostics only to `input.client.app.log` or `stderr`. Process stdio frames sequentially (`for await`) so parse errors never overtake async calls.
- **Magpie plugin & page host contract**:
  - `src/magpie-plugin.mjs` exports only `export default { id, server }` returning `{ tool }` (no stray top-level exported functions, no `auth` or `config` provider hooks).
  - `package.json` keeps both `"main"` and empty/null default placeholders in `"magpie.options"` so package defaults never overwrite `~/.config/light-decision-mcp/config.json`.
  - `page/index.html` runs in Magpie's sandbox (`connect-src 'none'`, no inline JS): load `_magpie/bridge.js` first, keep JS/CSS external, use `--magpie-*` theme variables, and debounce `magpie.options.set()` (>= 1.1s).
- **Verified wire-protocol rules**:
  - Alias non-matching caller question IDs to `/^[A-Za-z0-9_-]{1,64}$/` on the wire and restore original keys before returning (required by Google `gemini-decision-1`).
  - Magpie `/v1/decisions` multimodal requests wrap content in `[{ role: "user", content: [{ type: "input_text" }, { type: "input_image" }] }]` and return `probabilities` as an array (`[{ value|label, probability }]`).
  - Normalize `score` across Gemini (expected float + `legend`) and OpenDecider (integer argmax + `expected` + index-keyed probs) to the same `{ level, label, expected_level, score, probabilities, confidence, provider_confidence }`.
  - Magpie hides decision-only models from `/v1/models`; `status` checks readiness via a local 0-token validation probe on `POST /v1/decisions`.
- **Security & fallback guardrails**:
  - Store zero plaintext API keys in the repository or `config.json`. Resolve direct-provider secrets strictly via env vars, `0600` `~/.config/light-decision-mcp/secrets.json`, or macOS Keychain; Magpie-managed providers store keys inside Magpie.
  - Enforce `max_data_destination` (`on-device` < `private-network` < `third-party`) before network I/O; `local_only` locks `on-device`. Never silently escalate local -> cloud.
  - In `api_with_local_fallback`, trigger fallback only on availability faults (network/gateway error, primary timeout, 429, 5xx, open circuit); never fall back on `400`, caller `ctx.abort`, or image requests targeting a text-only fallback unless `allow_image_drop_on_fallback: true`.

## References (Read When Relevant)

- Read [SPEC.md](./SPEC.md) before changing tool schemas, routing modes, error codes, or release / Magpie Marketplace publishing steps (Section 7 covers `gh` repo setup, bilingual About/Release, and `magpie-community/plugins` `registry.json` PR).
- Keep [README.md](./README.md) (default English, top link to Chinese) and [README.zh-CN.md](./README.zh-CN.md) strictly feature-synced whenever CLI commands, config keys, or tools change.

## Verification

Done on any code change means all of these pass:
1. `npm test` (unit, mock-gateway, circuit-breaker, hot-reload, standalone, plugin-contract, stdio child-process, and wizard tests)
2. Bun load check when touching `src/magpie-plugin.mjs` or `src/core/`: `bun -e 'import p from "./src/magpie-plugin.mjs"; await p.server({}, {});'`
3. When testing live inside Magpie on this host after editing plugin code, reload the plugin (`magpie plugin off <path> && magpie plugin on <path>`) so the long-lived Bun host drops cached ESM modules.
