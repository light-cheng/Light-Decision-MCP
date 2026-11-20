#!/usr/bin/env node
/**
 * Main CLI entrypoint for light-decision-mcp:
 *   light-decision-mcp setup                         Interactive local model & multi-provider setup wizard
 *   light-decision-mcp doctor [--json]               Read-only hardware, ecosystem & live backend check
 *   light-decision-mcp recommend [--json]            Measure host hardware & recommend local/cloud models
 *   light-decision-mcp key list|set|rm [...]         Manage local 0600 secrets / macOS Keychain for direct providers
 *   light-decision-mcp stdio                         Run MCP JSON-RPC 2.0 server over stdio
 */

import readline from "node:readline/promises";
import { startAdminServer } from "../src/admin/server.mjs";
import {
  createSecretResolver,
  getDefaultSecretsPath,
  isValidKeyName,
  removeFileSecret,
  removeKeychainSecret,
  setFileSecret,
  setKeychainSecret,
} from "../src/config/secrets.mjs";
import { PACKAGE_VERSION } from "../src/core/router.mjs";
import { runDoctor, runRecommend, runSetup } from "../src/wizard/setup.mjs";
import { runStdioServer } from "./stdio.mjs";

const KNOWN_DIRECT_KEYS = [
  "PERPLEXITY_API_KEY",
  "TYPESAFE_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
];

const HELP = `light-decision-mcp v${PACKAGE_VERSION}
Multi-backend Decision MCP & Magpie plugin for System One models.

Usage:
  light-decision-mcp ui [--port 4395] [--no-open]       Launch standalone local Web Admin UI (127.0.0.1 only)
  light-decision-mcp setup                              Interactive multi-provider & local model setup wizard
  light-decision-mcp doctor [--json]                    Read-only hardware, ecosystem & live backend check
  light-decision-mcp recommend [--json]                 Measure host hardware & recommend local/cloud models
  light-decision-mcp key list                           Show configured direct-provider API key sources (never prints secrets)
  light-decision-mcp key set <ENV_NAME> [--keychain]    Store a direct-provider key in 0600 secrets.json (or macOS Keychain)
  light-decision-mcp key rm <ENV_NAME>                  Remove a stored direct-provider key
  light-decision-mcp stdio                              Run MCP JSON-RPC 2.0 server over stdio
  light-decision-mcp --help | --version

Note: For Magpie-managed providers (Google Gemini, TypeSafe, OpenAI, etc.), store keys
directly in Magpie instead:  magpie provider add google <API_KEY>
`;

async function readSecretInput(promptLabel) {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    // Mask echoed characters on TTY
    const origWrite = rl._writeToOutput;
    rl._writeToOutput = function maskedWrite(str) {
      if (str.startsWith(promptLabel) || str === "\r\n" || str === "\n") {
        origWrite.call(this, str);
      } else {
        origWrite.call(this, "*");
      }
    };
    const val = await rl.question(promptLabel);
    process.stdout.write("\n");
    return val.trim();
  } finally {
    rl.close();
  }
}

async function handleKeyCommand(subArgs) {
  const action = subArgs[0] || "list";
  const resolver = createSecretResolver();

  if (action === "list") {
    console.log(`Secrets file: ${getDefaultSecretsPath()} (mode 0600, outside repo)`);
    for (const k of KNOWN_DIRECT_KEYS) {
      const src = resolver.sourceOf(k);
      console.log(`  ${k.padEnd(22)} ${src ? `set (${src})` : "not set"}`);
    }
    return;
  }

  if (action === "set") {
    const name = (subArgs[1] || "").trim().toUpperCase();
    const useKeychain = subArgs.includes("--keychain");
    if (!isValidKeyName(name)) {
      console.error(
        `Usage: light-decision-mcp key set <ENV_NAME> [--keychain]\nExample: light-decision-mcp key set PERPLEXITY_API_KEY`,
      );
      process.exitCode = 1;
      return;
    }
    const secret = await readSecretInput(`Enter value for ${name}: `);
    if (!secret) {
      console.error("Aborted: empty value.");
      process.exitCode = 1;
      return;
    }
    if (useKeychain) {
      setKeychainSecret(name, secret);
      console.log(`Stored ${name} in macOS Keychain (service: light-decision-mcp). Active on next request.`);
    } else {
      const file = setFileSecret(name, secret);
      console.log(`Stored ${name} in ${file} (mode 0600). Active on next request (works in Magpie GUI & stdio).`);
    }
    return;
  }

  if (action === "rm" || action === "remove" || action === "delete") {
    const name = (subArgs[1] || "").trim().toUpperCase();
    if (!isValidKeyName(name)) {
      console.error("Usage: light-decision-mcp key rm <ENV_NAME>");
      process.exitCode = 1;
      return;
    }
    const removedFile = removeFileSecret(name);
    const removedKc = removeKeychainSecret(name);
    if (removedFile || removedKc) {
      console.log(`Removed ${name} (${[removedFile && "secrets.json", removedKc && "keychain"].filter(Boolean).join(", ")}).`);
    } else {
      console.log(`${name} was not found in secrets.json or Keychain.`);
    }
    return;
  }

  console.error(`Unknown key subcommand: ${action}\nExpected: list | set <ENV_NAME> [--keychain] | rm <ENV_NAME>`);
  process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || "--help";
  const jsonFlag = args.includes("--json");

  switch (cmd) {
    case "ui":
    case "admin": {
      const portIdx = args.indexOf("--port");
      const portVal = portIdx >= 0 ? Number(args[portIdx + 1]) : undefined;
      await startAdminServer({
        port: Number.isInteger(portVal) && portVal > 0 ? portVal : 4395,
        open: !args.includes("--no-open"),
      });
      break;
    }
    case "setup":
      await runSetup();
      break;
    case "doctor":
      await runDoctor({ json: jsonFlag });
      break;
    case "recommend":
      await runRecommend({ json: jsonFlag });
      break;
    case "key":
    case "keys":
      await handleKeyCommand(args.slice(1));
      break;
    case "stdio":
      await runStdioServer();
      break;
    case "-v":
    case "--version":
      console.log(PACKAGE_VERSION);
      break;
    case "-h":
    case "--help":
    case "help":
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.error(HELP);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
