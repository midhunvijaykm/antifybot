import React, { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { ShieldCheck, Search, Award, Trash2, Calendar, Power, HelpCircle } from 'lucide-react';
import './OwnerPanel.css';

const OwnerPanel = () => {
  const { user, ownerGuilds, ownerGuildsLoading, fetchOwnerGuilds, managePremiumLicense } = useStore();
  const [search, setSearch] = useState('');
  const [selectedGuild, setSelectedGuild] = useState(null);
  const [duration, setDuration] = useState('30d');

  useEffect(() => {
    // Only load if user is owner
    if (user?.id === '1060801714187415552') {
      fetchOwnerGuilds();
    }
  }, [user, fetchOwnerGuilds]);

  const handleSearchChange = (e) => {
    setSearch(e.target.value);
    fetchOwnerGuilds(e.target.value);
  };

  const handleGrant = (guildId) => {
    managePremiumLicense(guildId, 'grant', duration);
    setSelectedGuild(null);
  };

  const handleRemove = (guildId) => {
    if (window.confirm('Are you sure you want to remove premium tier from this server?')) {
      managePremiumLicense(guildId, 'remove');
    }
  };

  if (user?.id !== '1060801714187415552') {
    return (
      <div className="owner-panel-unauthorized glass">
        <ShieldCheck size={48} className="lock-icon" />
        <h2>Access Denied</h2>
        <p>This control center requires Global Platform Administrator permissions.</p>
      </div>
    );
  }

  return (
    <div className="owner-panel-container">
      <div className="owner-panel-header">
        <div>
          <h1 className="owner-panel-title text-gradient">Owner Control Center</h1>
          <p className="owner-panel-subtitle">Manage premium licensing status, grant credentials, and monitor servers.</p>
        </div>
      </div>

      <div className="owner-search-row">
        <div className="search-box glass">
          <Search size={18} />
          <input 
            type="text" 
            placeholder="Search servers by name..." 
            value={search}
            onChange={handleSearchChange}
          />
        </div>
      </div>

      {ownerGuildsLoading && (ownerGuilds || []).length === 0 ? (
        <div className="owner-loading">
          <div className="loader-spinner"></div>
          <span>Loading servers index...</span>
        </div>
      ) : (
        <div className="owner-guilds-table-wrapper glass">
          <table className="owner-guilds-table">
            <thead>
              <tr>
                <th>Server</th>
                <th>Guild ID</th>
                <th>Bot Connection</th>
                <th>Premium Tier</th>
                <th>License Source</th>
                <th>Expires At</th>
                <th className="actions-header">Licensing Actions</th>
              </tr>
            </thead>
            <tbody>
              {(ownerGuilds || []).map((g) => {
                const isPro = g.tier === 'Pro';
                
                return (
                  <tr key={g.guildId} className={isPro ? 'pro-row' : ''}>
                    <td>
                      <div className="guild-meta-cell">
                        {g.icon ? (
                          <img src={g.icon} alt={g.name} className="table-guild-icon" />
                        ) : (
                          <div className="table-guild-icon-placeholder">{g.name.charAt(0)}</div>
                        )}
                        <span className="table-guild-name">{g.name}</span>
                      </div>
                    </td>
                    <td>
                      <span className="guild-id-badge">{g.guildId}</span>
                    </td>
                    <td>
                      <div className="status-cell">
                        <Power size={14} className={g.isOnline ? 'icon-online' : 'icon-offline'} />
                        <span className={g.isOnline ? 'status-online' : 'status-offline'}>
                          {g.isOnline ? 'Connected' : 'Disconnected'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className={`license-tier-badge ${isPro ? 'pro' : 'free'}`}>
                        {isPro ? 'ANTIFY PRO' : 'ANTIFY FREE'}
                      </span>
                    </td>
                    <td>
                      <span className="source-label">{g.source || 'N/A'}</span>
                    </td>
                    <td>
                      {isPro ? (
                        g.expiresAt ? (
                          <span className="expires-date">
                            <Calendar size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                            {new Date(g.expiresAt).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="expires-permanent">Permanent</span>
                        )
                      ) : (
                        <span className="expires-na">N/A</span>
                      )}
                    </td>
                    <td>
                      <div className="actions-cell">
                        {isPro ? (
                          <button 
                            className="btn-license-remove"
                            onClick={() => handleRemove(g.guildId)}
                          >
                            <Trash2 size={14} />
                            Remove Pro
                          </button>
                        ) : (
                          selectedGuild === g.guildId ? (
                            <div className="grant-form">
                              <select 
                                value={duration}
                                onChange={(e) => setDuration(e.target.value)}
                                className="duration-select"
                              >
                                <option value="7d">7 Days</option>
                                <option value="30d">30 Days</option>
                                <option value="90d">90 Days</option>
                                <option value="perm">Permanent</option>
                              </select>
                              <button 
                                className="btn-grant-confirm"
                                onClick={() => handleGrant(g.guildId)}
                              >
                                Grant
                              </button>
                              <button 
                                className="btn-grant-cancel"
                                onClick={() => setSelectedGuild(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button 
                              className="btn-license-grant"
                              onClick={() => {
                                setSelectedGuild(g.guildId);
                                setDuration('30d');
                              }}
                            >
                              <Award size={14} />
                              Grant Pro
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(ownerGuilds || []).length === 0 && (
            <div className="table-empty">
              <HelpCircle size={32} />
              <p>No guilds indexed matching search filters.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OwnerPanel;
