/**
 * XDG-compliant paths and Herdr socket auto-detection.
 *
 * Install location:  ~/.local/share/herdr/connector/
 * Config location:   ~/.config/herdr/hub-connector/
 * State location:    ~/.local/state/herdr/hub-connector/
 * Systemd unit:      ~/.config/systemd/user/herdr-connector.service
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const HOME = homedir();

// XDG base directories (respect env overrides)
const XDG_DATA_HOME = process.env.XDG_DATA_HOME || join(HOME, '.local', 'share');
const XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || join(HOME, '.config');
const XDG_STATE_HOME = process.env.XDG_STATE_HOME || join(HOME, '.local', 'state');

/** Where the connector is installed (the built dist/ + node_modules) */
export const INSTALL_DIR = join(XDG_DATA_HOME, 'herdr', 'connector');

/** Where config.json lives (hub_url, api_key) */
export const CONFIG_DIR = process.env.HERDR_PLUGIN_CONFIG_DIR || join(XDG_CONFIG_HOME, 'herdr', 'hub-connector');

/** Where runtime state lives (daemon.pid, etc.) */
export const STATE_DIR = process.env.HERDR_PLUGIN_STATE_DIR || join(XDG_STATE_HOME, 'herdr', 'hub-connector');

/** Systemd user unit directory */
export const SYSTEMD_USER_DIR = join(XDG_CONFIG_HOME, 'systemd', 'user');

/** Service name */
export const SERVICE_NAME = 'herdr-connector';

/** Default herdr socket path */
const DEFAULT_HERDR_SOCKET = join(XDG_DATA_HOME, 'herdr', 'server.sock');

/**
 * Auto-detect the Herdr server socket path.
 *
 * Strategy:
 * 1. Check HERDR_SOCKET_PATH env var
 * 2. Try `herdr server info` to get the socket from a running server
 * 3. Fall back to default XDG path ~/.local/share/herdr/server.sock
 *
 * Returns the path and whether it was verified as existing on disk.
 */
export function detectHerdrSocket(): { path: string; exists: boolean; source: string } {
  // 1. Env var (highest priority)
  if (process.env.HERDR_SOCKET_PATH) {
    const path = process.env.HERDR_SOCKET_PATH;
    return { path, exists: existsSync(path), source: 'HERDR_SOCKET_PATH env' };
  }

  // 2. Ask running herdr server
  try {
    const output = execSync('herdr server info --json 2>/dev/null', {
      timeout: 3000,
      encoding: 'utf-8',
    });
    const info = JSON.parse(output.trim());
    if (info.api_socket || info.socket_path) {
      const path = info.api_socket || info.socket_path;
      return { path, exists: existsSync(path), source: 'herdr server info' };
    }
  } catch {
    // herdr not in PATH or not running — that's fine
  }

  // 3. Default XDG path
  return {
    path: DEFAULT_HERDR_SOCKET,
    exists: existsSync(DEFAULT_HERDR_SOCKET),
    source: 'default XDG path',
  };
}

/**
 * Find the node binary path for the systemd unit file.
 * Prefers the full absolute path so systemd doesn't depend on PATH.
 */
export function detectNodePath(): string {
  try {
    const nodePath = execSync('which node', { encoding: 'utf-8' }).trim();
    if (nodePath && existsSync(nodePath)) {
      return nodePath;
    }
  } catch {
    // Fall through
  }
  return '/usr/bin/node';
}
