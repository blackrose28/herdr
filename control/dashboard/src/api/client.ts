/**
 * Hub API client — REST + WebSocket for the Dashboard.
 */

const API_BASE = localStorage.getItem('hub_url') || import.meta.env.VITE_HUB_URL || 'http://localhost:3001';
const WS_BASE = API_BASE.replace(/^http/, 'ws');

let accessToken = localStorage.getItem('hub_token') || '';

export function setToken(token: string) {
  accessToken = token;
  localStorage.setItem('hub_token', token);
}

export function getToken(): string {
  return accessToken;
}

export function clearToken() {
  accessToken = '';
  localStorage.removeItem('hub_token');
}

async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API error: ${res.status}`);
  }

  return res.json();
}

// ─── REST API methods ───

export const api = {
  // Health check (no auth)
  health: () => fetch(`${API_BASE}/health`).then(r => r.json()),

  // Auth: validate token
  validateToken: async (token: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/servers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  // Servers
  listServers: () => apiFetch<{ servers: ServerInfo[] }>('/api/servers'),
  registerServer: (name: string) => apiFetch<{ id: string; name: string; api_key: string }>('/api/servers', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }),
  deleteServer: (id: string) => apiFetch('/api/servers/' + id, { method: 'DELETE' }),

  // Overview
  getOverview: () => apiFetch<OverviewData>('/api/overview'),

  // Per-server state
  getWorkspaces: (serverId: string) => apiFetch<{ workspaces: WorkspaceInfo[] }>(`/api/servers/${serverId}/workspaces`),
  getAgents: (serverId: string) => apiFetch<{ agents: AgentInfo[] }>(`/api/servers/${serverId}/agents`),
  getPanes: (serverId: string) => apiFetch<{ panes: PaneInfo[] }>(`/api/servers/${serverId}/panes`),
  getTabs: (serverId: string) => apiFetch<{ tabs: TabInfo[] }>(`/api/servers/${serverId}/tabs`),

  // Pane interaction
  readPane: (serverId: string, paneId: string, source = 'recent', lines = 50) =>
    apiFetch(`/api/servers/${serverId}/panes/${paneId}/read`, {
      method: 'POST',
      body: JSON.stringify({ source, lines, format: 'text' }),
    }),
  sendToPane: (serverId: string, paneId: string, text: string) =>
    apiFetch(`/api/servers/${serverId}/panes/${paneId}/send`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  // Generic command
  sendCommand: (serverId: string, method: string, params: Record<string, unknown> = {}) =>
    apiFetch(`/api/servers/${serverId}/command`, {
      method: 'POST',
      body: JSON.stringify({ method, params }),
    }),
};

// ─── WebSocket connection ───

export type WsStatus = 'connecting' | 'connected' | 'disconnected';

export function connectWebSocket(
  onMessage: (message: any) => void,
  onStatusChange: (status: WsStatus) => void,
): () => void {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let isClosing = false;

  function connect() {
    if (isClosing) return;
    onStatusChange('connecting');

    ws = new WebSocket(`${WS_BASE}/ws/client?token=${encodeURIComponent(accessToken)}`);

    ws.onopen = () => {
      onStatusChange('connected');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        onMessage(message);
      } catch {
        // Skip invalid messages
      }
    };

    ws.onclose = () => {
      if (!isClosing) {
        onStatusChange('disconnected');
        reconnectTimer = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }

  connect();

  return () => {
    isClosing = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) ws.close();
  };
}

export function sendWsMessage(ws: WebSocket | null, message: object): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// ─── Types ───

export interface ServerInfo {
  id: string;
  name: string;
  hostname?: string;
  os?: string;
  herdr_version?: string;
  is_online: boolean;
  last_seen_at?: string;
  created_at?: string;
}

export interface OverviewData {
  servers: Array<ServerInfo & {
    state: {
      workspaces: WorkspaceInfo[];
      tabs: TabInfo[];
      panes: PaneInfo[];
      agents: AgentInfo[];
    } | null;
  }>;
  total_agents: number;
  agents_working: number;
  agents_blocked: number;
}

export interface WorkspaceInfo {
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  tab_count: number;
  active_tab_id: string;
  agent_status: AgentStatus;
  tokens: Record<string, string>;
  worktree?: {
    repo_key: string;
    repo_name: string;
    repo_root: string;
    checkout_path: string;
    is_linked_worktree: boolean;
  };
}

export interface TabInfo {
  tab_id: string;
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
}

export interface PaneInfo {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  focused: boolean;
  cwd?: string;
  label?: string;
  agent?: string;
  title?: string;
  display_agent?: string;
  agent_status: AgentStatus;
  state_labels: Record<string, string>;
  tokens: Record<string, string>;
  revision: number;
}

export interface AgentInfo {
  terminal_id: string;
  name?: string;
  agent?: string;
  title?: string;
  display_agent?: string;
  agent_status: AgentStatus;
  state_labels: Record<string, string>;
  tokens: Record<string, string>;
  workspace_id: string;
  tab_id: string;
  pane_id: string;
  focused: boolean;
  cwd?: string;
  revision: number;
}

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';
