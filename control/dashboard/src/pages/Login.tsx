import { useState } from 'react';
import { api, setToken } from '../api/client';
import { useHubStore } from '../stores/hub-store';

export function LoginPage() {
  const [hubUrl, setHubUrl] = useState(localStorage.getItem('hub_url') || 'http://localhost:3000');
  const [token, setTokenValue] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setAuthenticated = useHubStore(s => s.setAuthenticated);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      localStorage.setItem('hub_url', hubUrl);
      setToken(token);

      const valid = await api.validateToken(token);
      if (valid) {
        setAuthenticated(true);
      } else {
        setError('Invalid access token');
      }
    } catch (err) {
      setError('Failed to connect to Hub');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card animate-in" onSubmit={handleSubmit}>
        <div className="sidebar-logo" style={{ justifyContent: 'center', marginBottom: 8 }}>
          <div className="sidebar-logo-icon">H</div>
        </div>
        <h1 className="login-title">Herdr Hub</h1>
        <p className="login-subtitle">Control panel for your Herdr servers</p>

        <div className="form-group">
          <label className="form-label" htmlFor="hub-url">Hub URL</label>
          <input
            id="hub-url"
            className="form-input"
            type="url"
            value={hubUrl}
            onChange={e => setHubUrl(e.target.value)}
            placeholder="http://localhost:3000"
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="access-token">Access Token</label>
          <input
            id="access-token"
            className="form-input"
            type="password"
            value={token}
            onChange={e => setTokenValue(e.target.value)}
            placeholder="Enter your access token"
            required
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary login-btn"
          disabled={loading}
        >
          {loading ? 'Connecting...' : 'Connect to Hub'}
        </button>

        {error && <p className="login-error">{error}</p>}
      </form>
    </div>
  );
}
