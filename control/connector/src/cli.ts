/**
 * CLI entry point for the connector plugin.
 * Called by Herdr plugin actions, event hooks, and manual installation.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, cpSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { execSync } from 'child_process';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { ConnectorDaemon, loadConfig, saveConfig } from './daemon.js';
import { CONFIG_DIR, STATE_DIR, INSTALL_DIR, SYSTEMD_USER_DIR, SERVICE_NAME, detectHerdrSocket, detectNodePath } from './paths.js';
import { generateUnitFile, getUnitFilePath } from './systemd.js';

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

  case 'install':
    await handleInstall();
    break;

  case 'uninstall':
    await handleUninstall();
    break;

  default:
    console.log(`Usage: connector.js <connect|disconnect|status|setup|install|uninstall>`);
    console.log('');
    console.log('Commands:');
    console.log('  connect     - Start the connector daemon (connects to Hub)');
    console.log('  disconnect  - Stop the connector daemon');
    console.log('  status      - Show connection status');
    console.log('  setup       - Configure Hub URL and API key');
    console.log('  install     - Install as a systemd user service');
    console.log('  uninstall   - Remove the systemd user service');
    process.exit(1);
}

// ─── Connect ───────────────────────────────────────────────────────────────────

async function handleConnect(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error('❌ Not configured. Run setup first:');
    console.error(`   node dist/cli.js setup`);
    console.error('');
    console.error('Or run install for guided setup:');
    console.error(`   node dist/cli.js install`);
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

// ─── Disconnect ────────────────────────────────────────────────────────────────

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

// ─── Status ────────────────────────────────────────────────────────────────────

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

  // Check systemd service status
  console.log('');
  try {
    const unitPath = getUnitFilePath();
    if (existsSync(unitPath)) {
      const result = execSync(`systemctl --user is-active ${SERVICE_NAME} 2>/dev/null`, {
        encoding: 'utf-8',
      }).trim();
      console.log(`Systemd:    ${result === 'active' ? '✅ Active' : `⚪ ${result}`}`);
    } else {
      console.log(`Systemd:    ⚪ Not installed`);
    }
  } catch {
    console.log(`Systemd:    ⚪ Not installed or inactive`);
  }
}

// ─── Setup ─────────────────────────────────────────────────────────────────────

async function handleSetup(): Promise<void> {
  const hubUrl = process.argv[3];
  const apiKey = process.argv[4];

  if (!hubUrl || !apiKey) {
    // Interactive mode
    const config = await promptForConfig();
    saveConfig(config);
    console.log(`✅ Configuration saved`);
    console.log(`   Hub URL: ${config.hub_url}`);
    console.log(`   API Key: ${config.api_key.slice(0, 8)}...`);
    return;
  }

  saveConfig({ hub_url: hubUrl, api_key: apiKey });
  console.log(`✅ Configuration saved to ${CONFIG_DIR}/config.json`);
  console.log(`   Hub URL: ${hubUrl}`);
  console.log(`   API Key: ${apiKey.slice(0, 8)}...`);
  console.log('');
  console.log('Run "connect" to start the connector daemon.');
}

// ─── Install ───────────────────────────────────────────────────────────────────

async function handleInstall(): Promise<void> {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Herdr Hub Connector — Service Install  ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  // Step 1: Check / prompt for config
  let config = loadConfig();
  if (!config) {
    console.log('📋 No Hub configuration found. Let\'s set it up.');
    console.log('');
    config = await promptForConfig();
    saveConfig(config);
    console.log('');
    console.log(`✅ Configuration saved to ${CONFIG_DIR}/config.json`);
    console.log('');
  } else {
    console.log(`✅ Hub configuration found: ${config.hub_url}`);
  }

  // Step 2: Auto-detect herdr socket
  console.log('');
  console.log('🔍 Detecting Herdr server socket...');
  const socket = detectHerdrSocket();
  console.log(`   Path:   ${socket.path}`);
  console.log(`   Source: ${socket.source}`);
  console.log(`   Exists: ${socket.exists ? '✅ Yes' : '⚠️  No (herdr may not be running)'}`);

  if (!socket.exists) {
    console.log('');
    console.log('   The socket will be available once herdr starts.');
    console.log('   The connector will retry connecting automatically.');
  }

  // Step 3: Copy connector to install directory
  console.log('');
  console.log(`📦 Installing connector to ${INSTALL_DIR}...`);
  await installConnectorFiles();

  // Step 4: Generate and write systemd unit
  console.log('');
  console.log('⚙️  Setting up systemd user service...');

  const unitContent = generateUnitFile({ herdrSocketPath: socket.path });
  const unitPath = getUnitFilePath();

  mkdirSync(SYSTEMD_USER_DIR, { recursive: true });
  writeFileSync(unitPath, unitContent);
  console.log(`   Unit file: ${unitPath}`);

  // Step 5: Reload systemd and enable+start
  try {
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
    console.log('   Daemon reloaded');

    execSync(`systemctl --user enable ${SERVICE_NAME}`, { stdio: 'pipe' });
    console.log('   Service enabled (starts on login)');

    execSync(`systemctl --user start ${SERVICE_NAME}`, { stdio: 'pipe' });
    console.log('   Service started');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`   ⚠️  systemctl command failed: ${msg}`);
    console.error('   You may need to start the service manually:');
    console.error(`   systemctl --user start ${SERVICE_NAME}`);
  }

  // Step 6: Check for linger
  console.log('');
  const hasLinger = checkLinger();
  if (!hasLinger) {
    console.log('💡 Tip: Enable lingering to keep the connector running after logout:');
    console.log(`   sudo loginctl enable-linger ${process.env.USER || '$USER'}`);
    console.log('');
  }

  // Summary
  console.log('═══════════════════════════════════════════');
  console.log('✅ Installation complete!');
  console.log('');
  console.log('Useful commands:');
  console.log(`  systemctl --user status ${SERVICE_NAME}    # Check status`);
  console.log(`  journalctl --user -u ${SERVICE_NAME} -f    # View logs`);
  console.log(`  systemctl --user restart ${SERVICE_NAME}   # Restart`);
  console.log(`  node dist/cli.js uninstall                 # Remove service`);
}

// ─── Uninstall ─────────────────────────────────────────────────────────────────

async function handleUninstall(): Promise<void> {
  console.log('🗑️  Uninstalling Herdr Hub Connector service...');
  console.log('');

  const unitPath = getUnitFilePath();

  // Stop and disable the service
  try {
    execSync(`systemctl --user stop ${SERVICE_NAME} 2>/dev/null`, { stdio: 'pipe' });
    console.log('   Service stopped');
  } catch {
    // May not be running
  }

  try {
    execSync(`systemctl --user disable ${SERVICE_NAME} 2>/dev/null`, { stdio: 'pipe' });
    console.log('   Service disabled');
  } catch {
    // May not be enabled
  }

  // Remove unit file
  if (existsSync(unitPath)) {
    unlinkSync(unitPath);
    console.log(`   Removed: ${unitPath}`);
  }

  // Reload systemd
  try {
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
    console.log('   Daemon reloaded');
  } catch {
    // Non-critical
  }

  console.log('');
  console.log('✅ Service uninstalled.');
  console.log('');
  console.log('Note: Configuration and installed files are preserved:');
  console.log(`  Config: ${CONFIG_DIR}/config.json`);
  console.log(`  Files:  ${INSTALL_DIR}/`);
  console.log('  Delete these manually if you want a full cleanup.');
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

/**
 * Interactive prompt for Hub URL and API key.
 */
async function promptForConfig(): Promise<{ hub_url: string; api_key: string }> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, resolve));

  try {
    const hubUrl = await ask('  Hub URL (e.g. https://hub.example.com): ');
    const apiKey = await ask('  API Key: ');

    if (!hubUrl.trim() || !apiKey.trim()) {
      console.error('❌ Both Hub URL and API Key are required.');
      process.exit(1);
    }

    return { hub_url: hubUrl.trim(), api_key: apiKey.trim() };
  } finally {
    rl.close();
  }
}

/**
 * Copy the connector source/dist/node_modules to the install directory.
 */
async function installConnectorFiles(): Promise<void> {
  // Determine source directory (where this script is running from)
  const thisFile = fileURLToPath(import.meta.url);
  const srcRoot = resolve(dirname(thisFile), '..');

  // If we're already running from the install dir, skip copy
  if (resolve(srcRoot) === resolve(INSTALL_DIR)) {
    console.log('   Already running from install directory, skipping copy.');
    return;
  }

  mkdirSync(INSTALL_DIR, { recursive: true });

  // Copy essential files
  const filesToCopy = ['package.json', 'package-lock.json'];
  for (const file of filesToCopy) {
    const src = join(srcRoot, file);
    if (existsSync(src)) {
      cpSync(src, join(INSTALL_DIR, file));
    }
  }

  // Copy dist directory
  const distSrc = join(srcRoot, 'dist');
  if (existsSync(distSrc)) {
    cpSync(distSrc, join(INSTALL_DIR, 'dist'), { recursive: true });
    console.log('   Copied dist/');
  } else {
    console.error('   ❌ dist/ not found. Run "npm run build" first.');
    process.exit(1);
  }

  // Install production dependencies in the install dir
  console.log('   Installing production dependencies...');
  try {
    execSync('npm install --omit=dev', {
      cwd: INSTALL_DIR,
      stdio: 'pipe',
      timeout: 60_000,
    });
    console.log('   Dependencies installed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`   ⚠️  npm install failed: ${msg}`);
    console.error('   You may need to run npm install manually in:', INSTALL_DIR);
  }
}

/**
 * Check if loginctl linger is enabled for the current user.
 */
function checkLinger(): boolean {
  try {
    const user = process.env.USER;
    if (!user) return false;

    // Check if linger file exists
    if (existsSync(`/var/lib/systemd/linger/${user}`)) {
      return true;
    }

    // Alternative: check via loginctl
    const output = execSync(`loginctl show-user ${user} --property=Linger 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    return output === 'Linger=yes';
  } catch {
    return false;
  }
}
