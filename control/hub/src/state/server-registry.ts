/**
 * In-memory registry of connected Herdr servers and their latest state.
 */

import type { ServerStateSnapshot, ServerSummary, HeartbeatData, HerdrEvent, AgentStatus } from '../ws/protocol.js';
import type { WebSocket } from 'ws';

export interface ConnectedServer {
  serverId: string;
  name: string;
  apiKeyHash: string;
  socket: WebSocket;
  state: ServerStateSnapshot | null;
  heartbeat: HeartbeatData | null;
  connectedAt: Date;
  lastHeartbeat: Date;
  // Pane output subscribers: pane_id -> Set of client sockets
  paneOutputSubscribers: Map<string, Set<WebSocket>>;
}

export interface ConnectedClient {
  socket: WebSocket;
  connectedAt: Date;
}

class ServerRegistry {
  private servers = new Map<string, ConnectedServer>();
  private clients = new Set<ConnectedClient>();
  // Pending commands sent to connectors: command_id -> { resolve, reject, clientSocket }
  private pendingCommands = new Map<string, {
    resolve: (result: unknown) => void;
    reject: (error: string) => void;
    clientSocket?: WebSocket;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  private commandIdCounter = 0;

  // ─── Server connections ───

  addServer(server: ConnectedServer): void {
    this.servers.set(server.serverId, server);
    this.broadcastToClients({
      type: 'server_online',
      data: {
        server_id: server.serverId,
        name: server.name,
        hostname: server.heartbeat?.hostname,
        os: server.heartbeat?.os,
        herdr_version: server.heartbeat?.herdr_version,
      },
    });
  }

  removeServer(serverId: string): void {
    const server = this.servers.get(serverId);
    if (server) {
      // Clean up pending commands for this server
      for (const [cmdId, pending] of this.pendingCommands) {
        // We can't easily tell which server a command was for, so we skip cleanup here
        // Commands will timeout naturally
      }
      server.paneOutputSubscribers.clear();
      this.servers.delete(serverId);
      this.broadcastToClients({
        type: 'server_offline',
        data: { server_id: serverId },
      });
    }
  }

  getServer(serverId: string): ConnectedServer | undefined {
    return this.servers.get(serverId);
  }

  getServerByApiKeyHash(hash: string): ConnectedServer | undefined {
    for (const server of this.servers.values()) {
      if (server.apiKeyHash === hash) return server;
    }
    return undefined;
  }

  getAllServers(): ConnectedServer[] {
    return Array.from(this.servers.values());
  }

  updateServerState(serverId: string, state: ServerStateSnapshot): void {
    const server = this.servers.get(serverId);
    if (server) {
      server.state = state;
      console.log(`[registry] updateServerState for ${serverId}: ${state.agents?.length || 0} agents, ${state.panes?.length || 0} panes — broadcasting to ${this.clients.size} clients`);
      this.broadcastToClients({
        type: 'server_state',
        data: { server_id: serverId, state },
      });
    } else {
      console.warn(`[registry] updateServerState: server ${serverId} not found in registry`);
    }
  }

  updateServerHeartbeat(serverId: string, heartbeat: HeartbeatData): void {
    const server = this.servers.get(serverId);
    if (server) {
      server.heartbeat = heartbeat;
      server.lastHeartbeat = new Date();
    }
  }

  handleServerEvent(serverId: string, event: HerdrEvent): void {
    this.broadcastToClients({
      type: 'event',
      data: { server_id: serverId, event },
    });
  }

  handlePaneOutput(serverId: string, paneId: string, text: string, revision: number): void {
    const server = this.servers.get(serverId);
    if (!server) {
      console.warn(`[registry] handlePaneOutput: server ${serverId} not found`);
      return;
    }

    const subscribers = server.paneOutputSubscribers.get(paneId);
    if (!subscribers || subscribers.size === 0) {
      console.log(`[registry] handlePaneOutput: no subscribers for ${paneId} (${server.paneOutputSubscribers.size} panes tracked)`);
      return;
    }

    const message = JSON.stringify({
      type: 'pane_output',
      data: { server_id: serverId, pane_id: paneId, text, revision },
    });

    let sent = 0;
    for (const client of subscribers) {
      if (client.readyState === 1) { // OPEN
        client.send(message);
        sent++;
      } else {
        console.warn(`[registry] handlePaneOutput: client socket not OPEN (state=${client.readyState})`);
      }
    }
    console.log(`[registry] handlePaneOutput: sent pane ${paneId} rev=${revision} to ${sent}/${subscribers.size} subscribers`);
  }

  // ─── Command forwarding ───

  async sendCommandToServer(
    serverId: string,
    method: string,
    params: Record<string, unknown>,
    clientSocket?: WebSocket,
    timeoutMs = 30000
  ): Promise<unknown> {
    const server = this.servers.get(serverId);
    if (!server || server.socket.readyState !== 1) {
      throw new Error('Server not connected');
    }

    const commandId = `cmd-${++this.commandIdCounter}-${Date.now()}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        reject(new Error('Command timed out'));
      }, timeoutMs);

      this.pendingCommands.set(commandId, { resolve, reject, clientSocket, timeout });

      server.socket.send(JSON.stringify({
        type: 'command',
        id: commandId,
        method,
        params,
      }));
    });
  }

  handleCommandResponse(commandId: string, result?: unknown, error?: string): void {
    const pending = this.pendingCommands.get(commandId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingCommands.delete(commandId);

    if (error) {
      pending.reject(error);
    } else {
      pending.resolve(result);
    }
  }

  // ─── Pane output subscriptions ───

  subscribePaneOutput(serverId: string, paneId: string, clientSocket: WebSocket, lines?: number): void {
    const server = this.servers.get(serverId);
    if (!server) return;

    if (!server.paneOutputSubscribers.has(paneId)) {
      server.paneOutputSubscribers.set(paneId, new Set());
    }
    server.paneOutputSubscribers.get(paneId)!.add(clientSocket);

    // Tell the connector to start streaming this pane
    if (server.socket.readyState === 1) {
      server.socket.send(JSON.stringify({
        type: 'subscribe_pane_output',
        pane_id: paneId,
        lines,
      }));
    }
  }

  unsubscribePaneOutput(serverId: string, paneId: string, clientSocket: WebSocket): void {
    const server = this.servers.get(serverId);
    if (!server) return;

    const subscribers = server.paneOutputSubscribers.get(paneId);
    if (subscribers) {
      subscribers.delete(clientSocket);
      if (subscribers.size === 0) {
        server.paneOutputSubscribers.delete(paneId);
        // Tell connector to stop streaming
        if (server.socket.readyState === 1) {
          server.socket.send(JSON.stringify({
            type: 'unsubscribe_pane_output',
            pane_id: paneId,
          }));
        }
      }
    }
  }

  removeClientFromAllSubscriptions(clientSocket: WebSocket): void {
    for (const server of this.servers.values()) {
      for (const [paneId, subscribers] of server.paneOutputSubscribers) {
        subscribers.delete(clientSocket);
        if (subscribers.size === 0) {
          server.paneOutputSubscribers.delete(paneId);
          if (server.socket.readyState === 1) {
            server.socket.send(JSON.stringify({
              type: 'unsubscribe_pane_output',
              pane_id: paneId,
            }));
          }
        }
      }
    }
  }

  // ─── Client connections ───

  addClient(client: ConnectedClient): void {
    this.clients.add(client);
  }

  removeClient(client: ConnectedClient): void {
    this.clients.delete(client);
    this.removeClientFromAllSubscriptions(client.socket);
  }

  private broadcastToClients(message: object): void {
    const payload = JSON.stringify(message);
    const type = (message as any).type || 'unknown';
    let sent = 0;
    let dropped = 0;
    for (const client of this.clients) {
      if (client.socket.readyState === 1) {
        client.socket.send(payload);
        sent++;
      } else {
        dropped++;
      }
    }
    if (type !== 'server_state') { // server_state already logged above
      console.log(`[registry] broadcast ${type}: sent=${sent} dropped=${dropped} total_clients=${this.clients.size}`);
    }
    if (this.clients.size === 0) {
      console.warn(`[registry] broadcast ${type}: NO CLIENTS connected`);
    }
  }

  // ─── Overview ───

  getOverview(): {
    servers: Array<ServerSummary & { is_online: boolean; state: ServerStateSnapshot | null }>;
    total_agents: number;
    agents_working: number;
    agents_blocked: number;
  } {
    let totalAgents = 0;
    let agentsWorking = 0;
    let agentsBlocked = 0;

    const serverList = this.getAllServers().map(s => {
      const agents = s.state?.agents || [];
      totalAgents += agents.length;
      agentsWorking += agents.filter(a => a.agent_status === 'working').length;
      agentsBlocked += agents.filter(a => a.agent_status === 'blocked').length;

      return {
        server_id: s.serverId,
        name: s.name,
        hostname: s.heartbeat?.hostname,
        os: s.heartbeat?.os,
        herdr_version: s.heartbeat?.herdr_version,
        is_online: s.socket.readyState === 1,
        state: s.state,
      };
    });

    return { servers: serverList, total_agents: totalAgents, agents_working: agentsWorking, agents_blocked: agentsBlocked };
  }
}

export const registry = new ServerRegistry();
