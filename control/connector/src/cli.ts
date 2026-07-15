/**
 * CLI entry point for the connector plugin.
 * Called by Herdr plugin actions and event hooks.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync, spawn } from 'child_process';
import { ConnectorDaemon, loadConfig, saveConfig } from './daemon.js';

const STATE_DIR = process.env.HERDR_PLUGIN_STATE_DIR || '/tmp/herdr-connector-state';
const CONFIG_DIR = process.env.HERDR_PLUGIN_CONFIG_DIR || '/tmp/herdr-connector-config';

const command = process.argv[2];

switch (command) {
  case 'connect':
    await handleConnect();
    break;

  case 'disconnect':
    handleDisconnect();
    break;

  case 'status':
    handleStatus();
    break;

  case 'on-event':
    // Event hooks are fired per-event. The daemon handles event forwarding
    // via its persistent event subscription. These hooks are fallback/redundant.
    // The daemon's subscription is the primary path.
    break;

  case 'setup':
    await handleSetup();
    break;

  default:
    console.log(`Usage: connector.js <connect|disconnect|status|setup>`);
    console.log('');
    console.log('Commands:');
    console.log('  connect     - Start the connector daemon (connects to Hub)');
    console.log('  disconnect  - Stop the connector daemon');
    console.log('  status      - Show connection status');
    console.log('  setup       - Configure Hub URL and API key');
    process.exit(1);
}

async function handleConnect(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error('❌ Not configured. Run setup first:');
    console.error(`   node dist/cli.js setup`);
    console.error('');
    console.error('Or create config manually:');
    console.error(`   mkdir -p ${CONFIG_DIR}`);
    console.error(`   echo '{"hub_url":"http://localhost:3000","api_key":"hdr_..."}' > ${CONFIG_DIR}/config.json`);
    process.exit(1);
    return;
  }

  // Check if already running
  const pid = getDaemonPid();
  if (pid) {
    console.log(`⚠️  Connector daemon is already running (PID: ${pid})`);
    console.log('   Use "disconnect" first to stop it.');
    return;
  }

  console.log(`🔌 Connecting to Hub at ${config.hub_url}...`);

  // Start the daemon
  const daemon = new ConnectorDaemon(config);
  await daemon.start();
}

function handleDisconnect(): void {
  const pid = getDaemonPid();
  if (!pid) {
    console.log('ℹ️  No connector daemon is running.');
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
    console.log(`✅ Connector daemon stopped (PID: ${pid})`);
  } catch (err) {
    console.error(`❌ Failed to stop daemon (PID: ${pid}):`, err);
  }
}

function handleStatus(): void {
  const config = loadConfig();
  const pid = getDaemonPid();

  console.log('═══ Herdr Hub Connector Status ═══');
  console.log('');

  if (!config) {
    console.log('Configuration: ❌ Not configured');
    console.log(`Run: node dist/cli.js setup`);
    return;
  }

  console.log(`Hub URL:    ${config.hub_url}`);
  console.log(`API Key:    ${config.api_key.slice(0, 8)}...${config.api_key.slice(-4)}`);
  console.log(`Daemon PID: ${pid || 'Not running'}`);

  if (pid) {
    try {
      process.kill(pid, 0); // Check if process exists
      console.log(`Status:     ✅ Connected`);
    } catch {
      console.log(`Status:     ❌ Stale PID (daemon not running)`);
    }
  } else {
    console.log(`Status:     ⚪ Disconnected`);
  }
}

async function handleSetup(): Promise<void> {
  const hubUrl = process.argv[3];
  const apiKey = process.argv[4];

  if (!hubUrl || !apiKey) {
    console.error('Usage: connector.js setup <hub_url> <api_key>');
    console.error('Example: connector.js setup http://localhost:3000 hdr_abc123...');
    process.exit(1);
    return;
  }

  saveConfig({ hub_url: hubUrl, api_key: apiKey });
  console.log(`✅ Configuration saved to ${CONFIG_DIR}/config.json`);
  console.log(`   Hub URL: ${hubUrl}`);
  console.log(`   API Key: ${apiKey.slice(0, 8)}...`);
  console.log('');
  console.log('Run "connect" to start the connector daemon.');
}

function getDaemonPid(): number | null {
  const pidFile = join(STATE_DIR, 'daemon.pid');
  if (!existsSync(pidFile)) return null;

  try {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    if (isNaN(pid)) return null;

    // Check if process is actually running
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}
