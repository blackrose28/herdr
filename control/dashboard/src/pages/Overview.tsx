import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useHubStore } from '../stores/hub-store';

export function OverviewPage() {
  const navigate = useNavigate();
  const { servers, setServersFromOverview, getTotalStats } = useHubStore();
  const stats = getTotalStats();

  useEffect(() => {
    api.getOverview().then(setServersFromOverview).catch(console.error);
  }, []);

  const serverList = Array.from(servers.values());

  return (
    <div className="animate-in">
      <div className="page-header">
        <h1 className="page-title">Overview</h1>
        <p className="page-subtitle">All Herdr servers at a glance</p>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-card-label">Total Servers</div>
          <div className="stat-card-value accent">{stats.servers}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Online</div>
          <div className="stat-card-value" style={{ color: 'var(--status-online)' }}>{stats.online}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Agents Active</div>
          <div className="stat-card-value working">{stats.working}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Need Attention</div>
          <div className="stat-card-value blocked">{stats.blocked}</div>
        </div>
      </div>

      {serverList.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🖥️</div>
          <div className="empty-state-title">No servers connected</div>
          <div className="empty-state-text">
            Register a server via the API, install the herdr-connector plugin, and connect it to this Hub.
          </div>
        </div>
      ) : (
        <div className="cards-grid">
          {serverList.map(server => {
            const agents = server.state?.agents || [];
            const workspaces = server.state?.workspaces || [];
            const working = agents.filter(a => a.agent_status === 'working').length;
            const blocked = agents.filter(a => a.agent_status === 'blocked').length;

            return (
              <div
                key={server.id}
                className="server-card"
                onClick={() => navigate(`/server/${server.id}`)}
              >
                <div className="server-card-header">
                  <div className="server-card-icon">
                    {server.is_online ? '🟢' : '🔴'}
                  </div>
                  <div className="server-card-info">
                    <div className="server-card-name">{server.name}</div>
                    <div className="server-card-meta">
                      {server.hostname && <span>{server.hostname}</span>}
                      {server.os && <span>• {server.os}</span>}
                      {server.herdr_version && <span>• v{server.herdr_version}</span>}
                    </div>
                  </div>
                  <div className={`server-card-status ${server.is_online ? 'online' : 'offline'}`}>
                    <span className={`status-dot ${server.is_online ? 'online' : 'offline'}`} />
                    {server.is_online ? 'Online' : 'Offline'}
                  </div>
                </div>

                <div className="server-card-stats">
                  <div className="server-card-stat">
                    <div className="server-card-stat-value">{workspaces.length}</div>
                    <div className="server-card-stat-label">Workspaces</div>
                  </div>
                  <div className="server-card-stat">
                    <div className="server-card-stat-value" style={{ color: working > 0 ? 'var(--status-working)' : undefined }}>
                      {working}
                    </div>
                    <div className="server-card-stat-label">Working</div>
                  </div>
                  <div className="server-card-stat">
                    <div className="server-card-stat-value" style={{ color: blocked > 0 ? 'var(--status-blocked)' : undefined }}>
                      {blocked}
                    </div>
                    <div className="server-card-stat-label">Blocked</div>
                  </div>
                </div>

                {agents.length > 0 && (
                  <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {agents.slice(0, 5).map(agent => (
                      <span key={agent.pane_id} className={`agent-badge ${agent.agent_status}`}>
                        <span className={`status-dot ${agent.agent_status}`} />
                        {agent.display_agent || agent.agent || agent.name || 'agent'}
                      </span>
                    ))}
                    {agents.length > 5 && (
                      <span className="agent-badge idle">+{agents.length - 5} more</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
