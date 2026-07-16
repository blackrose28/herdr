/**
 * Systemd user unit file generator for the Herdr Hub connector.
 *
 * Generates a .service unit that runs the connector daemon under
 * systemd --user with auto-restart and journal logging.
 */

import { INSTALL_DIR, CONFIG_DIR, STATE_DIR, SYSTEMD_USER_DIR, SERVICE_NAME, detectNodePath } from './paths.js';

interface UnitOptions {
  /** Herdr server socket path */
  herdrSocketPath: string;
  /** Absolute path to the node binary */
  nodePath?: string;
}

/**
 * Generate the systemd unit file content.
 *
 * Uses %h (home directory specifier) where possible for portability,
 * but we also use absolute paths for ExecStart since node needs to
 * resolve the script path at runtime.
 */
export function generateUnitFile(options: UnitOptions): string {
  const nodePath = options.nodePath || detectNodePath();
  const cliPath = `${INSTALL_DIR}/dist/cli.js`;

  return `[Unit]
Description=Herdr Hub Connector
Documentation=https://herdr.dev
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodePath} ${cliPath} connect
Restart=always
RestartSec=5

# Herdr server socket
Environment=HERDR_SOCKET_PATH=${options.herdrSocketPath}

# XDG-compliant config and state directories
Environment=HERDR_PLUGIN_CONFIG_DIR=${CONFIG_DIR}
Environment=HERDR_PLUGIN_STATE_DIR=${STATE_DIR}

# Logging goes to journald automatically
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# Resource limits
MemoryMax=256M
CPUQuota=25%

[Install]
WantedBy=default.target
`;
}

/**
 * Return the full path where the unit file should be written.
 */
export function getUnitFilePath(): string {
  return `${SYSTEMD_USER_DIR}/${SERVICE_NAME}.service`;
}
