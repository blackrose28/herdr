/**
 * Connector daemon — the long-running process that bridges the local Herdr
 * socket API to the central Hub via WebSocket.
 *
 * Responsibilities:
 * 1. Connect to Hub WebSocket with API key authentication
 * 2. Send full state snapshot on connect
 * 3. Subscribe to all Herdr events and forward them to Hub
 * 4. Accept commands from Hub and proxy them to local Herdr socket
 * 5. Stream pane output on demand
 * 6. Heartbeat to keep connection alive
 */

import WebSocket from 'ws';
import http from 'http';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { hostname as osHostname, platform } from 'os';
import { herdrRequest, herdrSubscribe } from './herdr-client.js';
import { CONFIG_DIR, STATE_DIR } from './paths.js';

interface ConnectorConfig {
  hub_url: string;
  api_key: string;
}

interface HubMessage {
  type: string;
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
  pane_id?: string;
  lines?: number;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
// STATE_DIR and CONFIG_DIR are imported from paths.ts

export class ConnectorDaemon {
  private config: ConnectorConfig;
  private ws: WebSocket | null = null;
  private eventUnsub: (() => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isShuttingDown = false;
  private startTime = Date.now();
  private activeOutputStreams = new Set<string>(); // pane IDs being streamed
  private outputStreamTimers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(config: ConnectorConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    console.log('[connector] Starting daemon...');
    this.isShuttingDown = false;
    this.connect();

    // Graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  private connect(): void {
    if (this.isShuttingDown) return;

    const url = `${this.config.hub_url}/ws/server?key=${encodeURIComponent(this.config.api_key)}`;
    console.log(`[connector] Connecting to Hub: ${this.config.hub_url}`);

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('[connector] Connected to Hub');
      this.reconnectAttempts = 0;
      this.sendSnapshot();
      this.startEventSubscription();
      this.startHeartbeat();
      this.writePidFile();
    });

    this.ws.on('message', (data) => {
      try {
        const message: HubMessage = JSON.parse(data.toString());
        this.handleHubMessage(message);
      } catch (err) {
        console.error('[connector] Invalid message from Hub:', err);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[connector] Disconnected from Hub (code=${code}, reason=${reason.toString()})`);
      this.cleanup();
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[connector] WebSocket error:', err.message);
    });

    this.ws.on('unexpected-response', async (_req, res: http.IncomingMessage) => {
      if (res.statusCode === 401) {
        console.warn('[connector] API key rejected (401). Attempting auto-registration...');
        this.ws?.removeAllListeners();
        this.ws = null;
        const registered = await this.tryAutoRegister();
        if (registered) {
          // Reset reconnect backoff and retry immediately
          this.reconnectAttempts = 0;
          this.connect();
        } else {
          this.scheduleReconnect();
        }
      }
    });
  }

  private herdrUnavailableWarned = false;

  private isHerdrUnavailable(err: unknown): boolean {
    return err instanceof Error && err.message.includes('HERDR_SOCKET_PATH is not set');
  }

  private warnHerdrUnavailable(): void {
    if (!this.herdrUnavailableWarned) {
      this.herdrUnavailableWarned = true;
      console.warn('[connector] ⚠ HERDR_SOCKET_PATH not set — running without local herdr connection');
      console.warn('[connector]   Hub connection is active. Set HERDR_SOCKET_PATH to enable state sync.');
    }
  }

  private async sendSnapshot(): Promise<void> {
    try {
      const [workspacesRes, panesRes, agentsRes] = await Promise.all([
        herdrRequest('workspace.list', {}),
        herdrRequest('pane.list', {}),
        herdrRequest('agent.list', {}),
      ]);

      // Fetch tabs for all workspaces
      const workspaces = workspacesRes.result?.workspaces || [];
      let allTabs: any[] = [];
      for (const ws of workspaces) {
        try {
          const tabsRes = await herdrRequest('tab.list', { workspace_id: ws.workspace_id });
          allTabs = allTabs.concat(tabsRes.result?.tabs || []);
        } catch {
          // Skip tab fetch failures
        }
      }

      this.send({
        type: 'state_snapshot',
        data: {
          workspaces,
          tabs: allTabs,
          panes: panesRes.result?.panes || [],
          agents: agentsRes.result?.agents || [],
        },
      });

      console.log(`[connector] Sent state snapshot: ${workspaces.length} workspaces, ${allTabs.length} tabs, ${(panesRes.result?.panes || []).length} panes, ${(agentsRes.result?.agents || []).length} agents`);
    } catch (err) {
      if (this.isHerdrUnavailable(err)) {
        this.warnHerdrUnavailable();
      } else {
        console.error('[connector] Failed to send snapshot:', err);
      }
    }
  }

  private startEventSubscription(): void {
    // Subscribe only to events that don't require pane_id.
    // Pane-specific events (agent_status_changed, agent_detected, output_matched)
    // require a pane_id in the Herdr API, so we use periodic snapshot polling instead.
    const subscriptions = [
      { type: 'workspace.created' },
      { type: 'workspace.updated' },
      { type: 'workspace.closed' },
      { type: 'workspace.renamed' },
      { type: 'workspace.moved' },
      { type: 'workspace.focused' },
      { type: 'worktree.created' },
      { type: 'worktree.opened' },
      { type: 'worktree.removed' },
      { type: 'tab.created' },
      { type: 'tab.closed' },
      { type: 'tab.renamed' },
      { type: 'tab.moved' },
      { type: 'tab.focused' },
      { type: 'pane.created' },
      { type: 'pane.closed' },
      { type: 'pane.focused' },
      { type: 'pane.moved' },
      { type: 'pane.exited' },
    ];

    this.eventUnsub = herdrSubscribe(
      subscriptions,
      (event) => {
        this.send({ type: 'event', data: event });

        // On state-changing events, re-send a full snapshot to keep Hub in sync
        const refreshEvents = [
          'workspace.created', 'workspace.closed',
          'tab.created', 'tab.closed',
          'pane.created', 'pane.closed',
        ];

        if (event.event && refreshEvents.includes(event.event)) {
          setTimeout(() => this.sendSnapshot(), 500);
        }
      },
      (error) => {
        if (this.isHerdrUnavailable(error)) {
          this.warnHerdrUnavailable();
          return; // Don't retry — no socket to connect to
        }
        console.error('[connector] Event subscription error:', error.message);
        // Retry subscription after a delay
        setTimeout(() => {
          if (!this.isShuttingDown && this.ws?.readyState === WebSocket.OPEN) {
            this.startEventSubscription();
          }
        }, 15000);
      }
    );

    // Poll for agent status changes every 5 seconds (since pane-specific
    // event subscriptions require per-pane subscription which is impractical)
    this.startAgentPolling();
  }

  private agentPollTimer: ReturnType<typeof setInterval> | null = null;
  private lastAgentSnapshot: string = '';

  private startAgentPolling(): void {
    this.agentPollTimer = setInterval(async () => {
      try {
        const agentsRes = await herdrRequest('agent.list', {});
        const agents = agentsRes.result?.agents || [];
        const snapshot = JSON.stringify(agents);

        if (snapshot !== this.lastAgentSnapshot) {
          this.lastAgentSnapshot = snapshot;
          // Agent state changed — send full snapshot to Hub
          await this.sendSnapshot();
        }
      } catch {
        // Skip polling errors silently
      }
    }, 5000);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({
        type: 'heartbeat',
        data: {
          uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
          herdr_version: process.env.HERDR_VERSION || 'unknown',
          hostname: osHostname(),
          os: platform(),
        },
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private async handleHubMessage(message: HubMessage): Promise<void> {
    switch (message.type) {
      case 'request_snapshot':
        await this.sendSnapshot();
        break;

      case 'command': {
        if (!message.id || !message.method) return;
        try {
          const response = await herdrRequest(message.method, message.params || {});
          this.send({
            type: 'command_response',
            id: message.id,
            result: response.result,
            error: response.error ? response.error.message : undefined,
          });
        } catch (err) {
          this.send({
            type: 'command_response',
            id: message.id,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
        break;
      }

      case 'subscribe_pane_output': {
        if (!message.pane_id) return;
        this.startPaneOutputStream(message.pane_id, message.lines);
        break;
      }

      case 'unsubscribe_pane_output': {
        if (!message.pane_id) return;
        this.stopPaneOutputStream(message.pane_id);
        break;
      }
    }
  }

  private startPaneOutputStream(paneId: string, lines?: number): void {
    if (this.activeOutputStreams.has(paneId)) return;
    this.activeOutputStreams.add(paneId);

    console.log(`[connector] Starting pane output stream: ${paneId}`);

    let lastTextHash = '';
    let revisionCounter = 0;

    // Poll pane.read at regular intervals (500ms)
    const timer = setInterval(async () => {
      try {
        const response = await herdrRequest('pane.read', {
          pane_id: paneId,
          source: 'recent',
          lines: lines || 500,
          format: 'ansi',
        });

        if (response.result) {
          // Herdr pane.read response: { result: { type, read: { text, revision, ... } } }
          const read = response.result.read || response.result;
          const text = read.text || '';

          // Herdr's pane.read with source=recent always returns revision=0,
          // so we use text-hash-based change detection and maintain our own counter.
          const hash = `${text.length}:${text.slice(0, 100)}:${text.slice(-100)}`;
          if (hash !== lastTextHash) {
            lastTextHash = hash;
            revisionCounter++;
            this.send({
              type: 'pane_output',
              pane_id: paneId,
              text,
              revision: revisionCounter,
            });
          }
        }
      } catch {
        // Pane might have closed
      }
    }, 500);

    this.outputStreamTimers.set(paneId, timer);
  }

  private stopPaneOutputStream(paneId: string): void {
    this.activeOutputStreams.delete(paneId);
    const timer = this.outputStreamTimers.get(paneId);
    if (timer) {
      clearInterval(timer);
      this.outputStreamTimers.delete(paneId);
    }
    console.log(`[connector] Stopped pane output stream: ${paneId}`);
  }

  private send(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Auto-register with the Hub REST API when the current API key is rejected.
   * Requires HUB_ACCESS_TOKEN env var (set automatically in dev mode).
   * Returns true if registration succeeded and config was updated.
   */
  private async tryAutoRegister(): Promise<boolean> {
    const hubAccessToken = process.env.HUB_ACCESS_TOKEN;
    if (!hubAccessToken) {
      console.error('[connector] Cannot auto-register: HUB_ACCESS_TOKEN env var not set');
      return false;
    }

    // Derive the REST API base URL from the WebSocket URL
    const wsUrl = this.config.hub_url;
    const httpUrl = wsUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');
    const registerUrl = `${httpUrl}/api/servers`;
    const serverName = `dev-${osHostname()}`;

    try {
      const body = JSON.stringify({ name: serverName });
      const response = await fetch(registerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${hubAccessToken}`,
        },
        body,
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`[connector] Auto-registration failed (${response.status}): ${text}`);
        return false;
      }

      const data = await response.json() as { id: string; name: string; api_key: string };
      console.log(`[connector] ✅ Auto-registered as "${data.name}" (id: ${data.id})`);

      // Update config with new API key
      this.config.api_key = data.api_key;
      saveConfig(this.config);
      console.log('[connector] Config updated with new API key');

      return true;
    } catch (err) {
      console.error('[connector] Auto-registration error:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  private scheduleReconnect(): void {
    if (this.isShuttingDown) return;

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_MS
    );
    this.reconnectAttempts++;

    console.log(`[connector] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private cleanup(): void {
    if (this.eventUnsub) {
      this.eventUnsub();
      this.eventUnsub = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.agentPollTimer) {
      clearInterval(this.agentPollTimer);
      this.agentPollTimer = null;
    }
    for (const timer of this.outputStreamTimers.values()) {
      clearInterval(timer);
    }
    this.outputStreamTimers.clear();
    this.activeOutputStreams.clear();
  }

  shutdown(): void {
    console.log('[connector] Shutting down...');
    this.isShuttingDown = true;
    this.cleanup();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.ws) {
      this.ws.close(1000, 'Shutdown');
    }
    this.removePidFile();
    process.exit(0);
  }

  private writePidFile(): void {
    try {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(join(STATE_DIR, 'daemon.pid'), process.pid.toString());
    } catch {
      // Non-critical
    }
  }

  private removePidFile(): void {
    try {
      const pidFile = join(STATE_DIR, 'daemon.pid');
      if (existsSync(pidFile)) {
        const { unlinkSync } = require('fs');
        unlinkSync(pidFile);
      }
    } catch {
      // Non-critical
    }
  }
}

/**
 * Load connector config from the plugin config directory.
 */
export function loadConfig(): ConnectorConfig | null {
  const configPath = join(CONFIG_DIR, 'config.json');
  if (!existsSync(configPath)) {
    return null;
  }
  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    if (!parsed.hub_url || !parsed.api_key) {
      console.error('[connector] config.json missing hub_url or api_key');
      return null;
    }
    return parsed;
  } catch (err) {
    console.error('[connector] Failed to read config:', err);
    return null;
  }
}

/**
 * Save connector config.
 */
export function saveConfig(config: ConnectorConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(
    join(CONFIG_DIR, 'config.json'),
    JSON.stringify(config, null, 2)
  );
}
