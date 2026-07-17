import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { connectWebSocket, api, dispatchPaneOutput } from './api/client';
import { useHubStore } from './stores/hub-store';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { ServerDetailPage } from './pages/ServerDetail';
import { AgentViewPage } from './pages/AgentView';
import { WorkspaceDetailPage } from './pages/WorkspaceDetail';

function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { wsStatus, servers, getTotalStats, getAllAgents } = useHubStore();
  const stats = getTotalStats();
  const allAgents = getAllAgents();

  const isActive = (path: string) => location.pathname === path;

  // Collect all workspaces across servers for the spaces section
  const allWorkspaces: Array<{ serverId: string; serverName: string; workspace: any }> = [];
  for (const server of servers.values()) {
    if (server.state?.workspaces) {
      for (const ws of server.state.workspaces) {
        allWorkspaces.push({ serverId: server.id, serverName: server.name, workspace: ws });
      }
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">H</div>
          <span className="sidebar-logo-text">Herdr Hub</span>
          <span className="sidebar-logo-version">v0.1</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button
          className={`sidebar-nav-item ${isActive('/') ? 'active' : ''}`}
          onClick={() => navigate('/')}
        >
          <span className="icon">📊</span>
          Overview
        </button>

        {/* ─── Servers Section ─── */}
        <div className="sidebar-section-label">
          Servers ({stats.online}/{stats.servers})
        </div>

        {Array.from(servers.values()).map(server => (
          <button
            key={server.id}
            className={`sidebar-nav-item ${location.pathname.startsWith(`/server/${server.id}`) ? 'active' : ''}`}
            onClick={() => navigate(`/server/${server.id}`)}
          >
            <span className={`status-dot ${server.is_online ? 'online' : 'offline'}`} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {server.name}
            </span>
            {server.state?.agents && server.state.agents.length > 0 && (
              <span className="sidebar-count-badge">
                {server.state.agents.length}
              </span>
            )}
          </button>
        ))}

        {/* ─── Spaces Section ─── */}
        {allWorkspaces.length > 0 && (
          <>
            <div className="sidebar-section-label" style={{ marginTop: 12 }}>
              Spaces ({allWorkspaces.length})
            </div>
            <div className="sidebar-spaces-list">
              {allWorkspaces.map(({ serverId, workspace: ws }) => (
                <button
                  key={`${serverId}:${ws.workspace_id}`}
                  className={`sidebar-space-item ${location.pathname === `/server/${serverId}/workspace/${ws.workspace_id}` ? 'active' : ''}`}
                  onClick={() => navigate(`/server/${serverId}/workspace/${ws.workspace_id}`)}
                  title={ws.label}
                >
                  <span className={`status-dot ${ws.agent_status}`} />
                  <span className="sidebar-space-label">{ws.label}</span>
                  <span className="sidebar-space-meta">
                    {ws.pane_count}p · {ws.tab_count}t
                  </span>
                  {ws.worktree && (
                    <span className="sidebar-space-repo" title={ws.worktree.repo_name}>
                      {ws.worktree.repo_name}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </nav>

      {/* ─── Agents Panel (Bottom) ─── */}
      <div className="sidebar-agents-panel">
        <div className="sidebar-section-label" style={{ padding: '0 0 8px' }}>
          Agents ({allAgents.length})
          {stats.working > 0 && (
            <span className="sidebar-agents-working-count">{stats.working} active</span>
          )}
        </div>
        {allAgents.length === 0 ? (
          <div className="sidebar-agents-empty">No agents running</div>
        ) : (
          <div className="sidebar-agents-list">
            {allAgents.map(agent => (
              <button
                key={`${agent.server_id}:${agent.pane_id}`}
                className="sidebar-agent-item"
                onClick={() => navigate(`/server/${agent.server_id}/pane/${agent.pane_id}`)}
                title={`${agent.display_agent || agent.agent || agent.name || 'agent'} — ${agent.agent_status}`}
              >
                <span className={`status-dot ${agent.agent_status}`} />
                <span className="sidebar-agent-name">
                  {agent.display_agent || agent.agent || agent.name || 'agent'}
                </span>
                <span className={`sidebar-agent-status ${agent.agent_status}`}>
                  {agent.agent_status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="sidebar-status">
        <div className={`connection-indicator ${wsStatus}`}>
          <span className={`status-dot ${wsStatus === 'connected' ? 'online' : wsStatus === 'connecting' ? 'blocked' : 'offline'}`} />
          {wsStatus === 'connected' ? 'Connected' : wsStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
        </div>
      </div>
    </aside>
  );
}

function AuthenticatedApp() {
  const { setWsStatus, setServer, removeServer, updateServerState, setServersFromOverview } = useHubStore();

  useEffect(() => {
    // Load initial state
    api.getOverview().then(setServersFromOverview).catch(console.error);

    // Connect WebSocket for real-time updates
    const disconnect = connectWebSocket(
      (message) => {
        switch (message.type) {
          case 'server_online':
            setServer({
              id: message.data.server_id,
              name: message.data.name,
              hostname: message.data.hostname,
              os: message.data.os,
              herdr_version: message.data.herdr_version,
              is_online: true,
              state: null,
            });
            break;
          case 'server_offline':
            removeServer(message.data.server_id);
            break;
          case 'server_state':
            updateServerState(message.data.server_id, message.data.state);
            break;
          case 'event':
            // Events update individual pieces of state
            // For now, re-fetch overview on significant events
            if (['pane.agent_status_changed', 'pane.agent_detected', 'workspace.created', 'workspace.closed'].includes(message.data.event?.event)) {
              api.getOverview().then(setServersFromOverview).catch(() => {});
            }
            break;
          case 'pane_output':
            // Dispatch real-time terminal output to subscribed components
            if (message.data) {
              dispatchPaneOutput(
                message.data.server_id,
                message.data.pane_id,
                message.data.text,
                message.data.revision,
              );
            }
            break;
        }
      },
      setWsStatus
    );

    return disconnect;
  }, []);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/server/:serverId" element={<ServerDetailPage />} />
          <Route path="/server/:serverId/workspace/:workspaceId" element={<WorkspaceDetailPage />} />
          <Route path="/server/:serverId/pane/:paneId" element={<AgentViewPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const { isAuthenticated } = useHubStore();

  return (
    <BrowserRouter>
      {isAuthenticated ? <AuthenticatedApp /> : <LoginPage />}
    </BrowserRouter>
  );
}
