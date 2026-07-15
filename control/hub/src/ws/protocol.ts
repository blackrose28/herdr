/**
 * WebSocket protocol message types between Hub, Connectors, and Clients.
 */

// =============================================================================
// Herdr state types (mirroring Herdr's API schema)
// =============================================================================

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
  worktree?: WorktreeInfo;
}

export interface WorktreeInfo {
  repo_key: string;
  repo_name: string;
  repo_root: string;
  checkout_path: string;
  is_linked_worktree: boolean;
}

export interface PaneInfo {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  focused: boolean;
  cwd?: string;
  foreground_cwd?: string;
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
  foreground_cwd?: string;
  revision: number;
}

export interface TabInfo {
  tab_id: string;
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
}

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

// =============================================================================
// Server state snapshot
// =============================================================================

export interface ServerStateSnapshot {
  workspaces: WorkspaceInfo[];
  tabs: TabInfo[];
  panes: PaneInfo[];
  agents: AgentInfo[];
}

// =============================================================================
// Connector → Hub messages
// =============================================================================

export type ConnectorMessage =
  | { type: 'state_snapshot'; data: ServerStateSnapshot }
  | { type: 'event'; data: HerdrEvent }
  | { type: 'heartbeat'; data: HeartbeatData }
  | { type: 'command_response'; id: string; result?: unknown; error?: string }
  | { type: 'pane_output'; pane_id: string; text: string; revision: number };

export interface HeartbeatData {
  uptime_seconds: number;
  herdr_version: string;
  hostname: string;
  os: string;
}

export interface HerdrEvent {
  event: string;
  data: Record<string, unknown>;
}

// =============================================================================
// Hub → Connector messages
// =============================================================================

export type HubToConnectorMessage =
  | { type: 'command'; id: string; method: string; params: Record<string, unknown> }
  | { type: 'subscribe_pane_output'; pane_id: string; lines?: number }
  | { type: 'unsubscribe_pane_output'; pane_id: string }
  | { type: 'request_snapshot' };

// =============================================================================
// Client → Hub messages
// =============================================================================

export type ClientMessage =
  | { type: 'command'; server_id: string; method: string; params: Record<string, unknown> }
  | { type: 'subscribe_pane_output'; server_id: string; pane_id: string; lines?: number }
  | { type: 'unsubscribe_pane_output'; server_id: string; pane_id: string };

// =============================================================================
// Hub → Client messages
// =============================================================================

export type HubToClientMessage =
  | { type: 'server_online'; data: ServerSummary }
  | { type: 'server_offline'; data: { server_id: string } }
  | { type: 'server_state'; data: { server_id: string; state: ServerStateSnapshot } }
  | { type: 'event'; data: { server_id: string; event: HerdrEvent } }
  | { type: 'pane_output'; data: { server_id: string; pane_id: string; text: string; revision: number } }
  | { type: 'command_response'; id: string; result?: unknown; error?: string }
  | { type: 'error'; message: string };

export interface ServerSummary {
  server_id: string;
  name: string;
  hostname?: string;
  os?: string;
  herdr_version?: string;
}
