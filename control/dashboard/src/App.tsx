import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { connectWebSocket, api, dispatchPaneOutput } from './api/client';
import { useHubStore } from './stores/hub-store';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { ServerDetailPage } from './pages/ServerDetail';
import { AgentViewPage } from './pages/AgentView';

function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { wsStatus, servers, getTotalStats } = useHubStore();
  const stats = getTotalStats();

  const isActive = (path: string) => location.pathname === path;

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

        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '16px 12px 6px', marginTop: 8 }}>
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
              <span style={{
                fontSize: 10,
                background: 'var(--bg-tertiary)',
                padding: '2px 6px',
                borderRadius: 4,
                color: 'var(--text-tertiary)',
              }}>
                {server.state.agents.length}
              </span>
            )}
          </button>
        ))}
      </nav>

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
