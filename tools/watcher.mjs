#!/usr/bin/env node
/**
 * codex-config-watcher
 *
 * Keeps ~/.codex/config.toml live for the ChatGPT extension.
 *
 * Why this exists: codex app-server loads config.toml once at startup and has
 * no file watcher (no ConfigWatcher / reload_config / watch_config in the
 * binary). The extension can restart the app-server internally
 * (`codex-app-server-restart`) but never learns that the file changed. This
 * bridge watches the file and forces that respawn, so editing config.toml
 * takes effect without touching the extension.
 *
 * ChatGPT auth in auth.json is untouched: this only cycles the app-server
 * process, which re-reads both config.toml and auth.json on the way up.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

const CONFIG = process.env.CODEX_CONFIG || path.join(os.homedir(), '.codex', 'config.toml');
const POLL_MS = Number(process.env.WATCH_POLL_MS || 2000);
const DEBOUNCE_MS = Number(process.env.WATCH_DEBOUNCE_MS || 1500);
const LOG_FILE = path.join(os.homedir(), '.codex', 'config-watcher.log');

// The app-server also writes its own UI state back into config.toml. Hashing
// the whole file would treat that as a user edit and cycle the process for
// nothing, so by default we only fingerprint the keys that decide how the
// model is reached and how the agent runs. Set WATCH_FULL_HASH=1 to watch
// every byte instead.
const RELEVANT = new RegExp(
  '^\\s*(' +
    'model|model_provider|model_reasoning_effort|model_context_window|' +
    'model_auto_compact_token_limit|plan_mode_reasoning_effort|' +
    'approval_policy|sandbox_mode|sandbox_workspace_write|' +
    'disable_response_storage|network_access|profile|openai_base_url|' +
    'wire_api|base_url|env_key|env_key_instructions|' +
    'experimental_bearer_token|requires_openai_auth|http_headers|' +
    'env_http_headers|query_params|request_max_retries|stream_max_retries|' +
    'stream_idle_timeout_ms|supports_websockets|supports_standalone_web_search' +
  ')\\s*=|^\\s*\\[model_providers\\.'
);
const FULL_HASH = process.env.WATCH_FULL_HASH === '1';

const COOLDOWN_MS = Number(process.env.WATCH_COOLDOWN_MS || 12000);

let lastHash = null;
let debounceTimer = null;
let restartCount = 0;
let inFlight = false;
let lastRestartAt = 0;

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  try {
    fs.appendFileSync(LOG_FILE, msg + '\n');
  } catch {
    /* log file is best effort */
  }
}

function hashConfig() {
  try {
    const text = fs.readFileSync(CONFIG, 'utf8');
    const payload = FULL_HASH
      ? text
      : text.split(/\r?\n/).filter((l) => RELEVANT.test(l)).join('\n');
    return createHash('sha256').update(payload).digest('hex');
  } catch {
    return null;
  }
}

// Only cycle codex.exe processes running as app-server. Never touches
// `codex exec` sessions or anything else the user has going.
const PS_KILL = `
$targets = Get-CimInstance Win32_Process -Filter "Name='codex.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'app-server' }
if (-not $targets) { 'NONE'; exit 0 }
$ids = @()
foreach ($t in $targets) {
  $ids += $t.ProcessId
  Stop-Process -Id $t.ProcessId -Force -ErrorAction SilentlyContinue
}
$ids -join ','
`;

function restartAppServers() {
  if (inFlight) return;
  inFlight = true;
  lastRestartAt = Date.now();
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', PS_KILL],
    { windowsHide: true, timeout: 20000 },
    (err, stdout) => {
      inFlight = false;
      if (err) {
        log(`restart failed: ${err.message}`);
        return;
      }
      const out = String(stdout).trim();
      if (out === 'NONE') {
        log('config.toml changed, but no app-server was running (nothing to cycle)');
        return;
      }
      restartCount++;
      log(`config.toml changed -> cycled app-server pid ${out} (restart #${restartCount}); extension respawns it`);
    }
  );
}

function scheduleRestart() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(restartAppServers, DEBOUNCE_MS);
}

function tick() {
  const h = hashConfig();
  if (h == null) return;
  if (lastHash == null) {
    lastHash = h;
    log(`watching ${CONFIG} (poll ${POLL_MS}ms, debounce ${DEBOUNCE_MS}ms)`);
    return;
  }
  if (h !== lastHash) {
    lastHash = h;
    if (Date.now() - lastRestartAt < COOLDOWN_MS) {
      log('change during cooldown absorbed (app-server writing its own state)');
      return;
    }
    log('change detected in config.toml');
    scheduleRestart();
  }
}

log('codex-config-watcher started');
tick();
setInterval(tick, POLL_MS);

process.on('SIGINT', () => {
  log('stopped');
  process.exit(0);
});
