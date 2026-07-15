/**
 * Zustand store for real-time Hub state.
 */

import { create } from 'zustand';
import type { ServerInfo, WorkspaceInfo, TabInfo, PaneInfo, AgentInfo, AgentStatus, WsStatus } from '../api/client';

interface ServerState {
  workspaces: WorkspaceInfo[];
  tabs: TabInfo[];
  panes: PaneInfo[];
  agents: AgentInfo[];
}

interface HubServer extends ServerInfo {
  state: ServerState | null;
}

interface HubStore {
  // Auth
  isAuthenticated: boolean;
  setAuthenticated: (auth: boolean) => void;

  // Connection
  wsStatus: WsStatus;
  setWsStatus: (status: WsStatus) => void;

  // Servers
  servers: Map<string, HubServer>;
  setServer: (server: HubServer) => void;
  removeServer: (serverId: string) => void;
  updateServerState: (serverId: string, state: ServerState) => void;
  setServersFromOverview: (overview: any) => void;

  // Helpers
  getServer: (serverId: string) => HubServer | undefined;
  getOnlineServers: () => HubServer[];
  getAllAgents: () => Array<AgentInfo & { server_id: string; server_name: string }>;
  getTotalStats: () => { servers: number; online: number; agents: number; working: number; blocked: number };
}

export const useHubStore = create<HubStore>((set, get) => ({
  isAuthenticated: !!localStorage.getItem('hub_token'),
  setAuthenticated: (auth) => set({ isAuthenticated: auth }),

  wsStatus: 'disconnected',
  setWsStatus: (status) => set({ wsStatus: status }),

  servers: new Map(),

  setServer: (server) => set((state) => {
    const next = new Map(state.servers);
    next.set(server.id, server);
    return { servers: next };
  }),

  removeServer: (serverId) => set((state) => {
    const next = new Map(state.servers);
    next.delete(serverId);
    return { servers: next };
  }),

  updateServerState: (serverId, serverState) => set((state) => {
    const next = new Map(state.servers);
    const existing = next.get(serverId);
    if (existing) {
      next.set(serverId, { ...existing, state: serverState });
    }
    return { servers: next };
  }),

  setServersFromOverview: (overview) => set(() => {
    const next = new Map<string, HubServer>();
    for (const s of overview.servers || []) {
      next.set(s.server_id || s.id, {
        id: s.server_id || s.id,
        name: s.name,
        hostname: s.hostname,
        os: s.os,
        herdr_version: s.herdr_version,
        is_online: s.is_online,
        last_seen_at: s.last_seen_at,
        state: s.state || null,
      });
    }
    return { servers: next };
  }),

  getServer: (serverId) => get().servers.get(serverId),

  getOnlineServers: () => Array.from(get().servers.values()).filter(s => s.is_online),

  getAllAgents: () => {
    const agents: Array<AgentInfo & { server_id: string; server_name: string }> = [];
    for (const server of get().servers.values()) {
      if (server.state?.agents) {
        for (const agent of server.state.agents) {
          agents.push({ ...agent, server_id: server.id, server_name: server.name });
        }
      }
    }
    return agents;
  },

  getTotalStats: () => {
    const servers = Array.from(get().servers.values());
    const allAgents = get().getAllAgents();
    return {
      servers: servers.length,
      online: servers.filter(s => s.is_online).length,
      agents: allAgents.length,
      working: allAgents.filter(a => a.agent_status === 'working').length,
      blocked: allAgents.filter(a => a.agent_status === 'blocked').length,
    };
  },
}));
