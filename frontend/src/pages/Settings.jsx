import { useState } from 'react';
import { Shield, Save, Plus, Volume2, UserCheck, MessageSquare, Settings as SettingsIcon } from 'lucide-react';
import { useStore } from '../store/useStore';
import Card from '../components/Card';
import Button from '../components/Button';
import './Settings.css';

const Toggle = ({ enabled, onChange, disabled }) => (
  <button 
    className={`toggle-switch ${enabled ? 'active' : ''}`}
    onClick={onChange}
    disabled={disabled}
    type="button"
  >
    <div className="toggle-thumb" />
  </button>
);

const Settings = () => {
  const { activeGuild, settings, settingsLoading, updateSettings, addKeyword, removeKeyword, premium, user, addAlert } = useStore();
  const isOwner = user && user.id === '1060801714187415552';
  const isPremium = isOwner || premium?.plan === 'Pro';
  const [newKeyword, setNewKeyword] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newUser, setNewUser] = useState('');
  const [newChannel, setNewChannel] = useState('');
  const [newAnnChannel, setNewAnnChannel] = useState('');

  // Local state drafts for text-input configurations (derived from settings with fallback)
  const [draftLoggingChannel, setLoggingChannel] = useState(null);
  const [draftWelcomeChannel, setWelcomeChannel] = useState(null);
  const [draftWelcomeText, setWelcomeText] = useState(null);
  const [draftAutorole, setAutorole] = useState(null);

  const loggingChannel = draftLoggingChannel !== null ? draftLoggingChannel : (settings?.loggingChannelId || '');
  const welcomeChannel = draftWelcomeChannel !== null ? draftWelcomeChannel : (settings?.welcomeChannelId || '');
  const welcomeText = draftWelcomeText !== null ? draftWelcomeText : (settings?.welcomeMessageText || 'Welcome {user} to the server! Make sure to verify.');
  const autorole = draftAutorole !== null ? draftAutorole : (settings?.autoroleId || '');

  if (!activeGuild) {
    return (
      <div className="empty-dashboard-state">
        <h2>No Guild Selected</h2>
        <p>Please select a Discord server to adjust moderation parameters.</p>
      </div>
    );
  }

  if (!activeGuild.botActive) {
    return (
      <div className="empty-dashboard-state">
        <h2>ANTIFY Bot Not Active</h2>
        <p>Invite the bot to this server to adjust moderation parameters.</p>
      </div>
    );
  }

  const handleToggle = (key) => {
    if (!settings) return;
    updateSettings({ [key]: !settings[key] });
  };

  const handleSaveTextSettings = (e) => {
    e.preventDefault();
    updateSettings({
      loggingChannelId: loggingChannel,
      welcomeChannelId: welcomeChannel,
      welcomeMessageText: welcomeText,
      autoroleId: autorole
    });
  };

  const handleKeywordAdd = (e) => {
    e.preventDefault();
    if (newKeyword.trim()) {
      addKeyword(newKeyword.trim());
      setNewKeyword('');
    }
  };

  const currentSettings = settings || {
    ocrEnabled: true,
    autoBan: false,
    autoKick: false,
    autoTimeout: true,
    deleteMessages: true,
    strictMode: false,
    blacklistKeywords: [],
    scanSensitivity: 50,
    whitelistChannels: [],
    trustedRoles: [],
    trustedUsers: [],
    announcementChannels: [],
    antiScamEnabled: true,
    antiPhishingEnabled: true,
    virusTotalEnabled: true,
    loggingChannelId: '',
    welcomeEnabled: false,
    welcomeChannelId: '',
    welcomeMessageText: 'Welcome {user} to the server! Make sure to verify.',
    roleManagementEnabled: false,
    autoroleId: ''
  };

  return (
    <div className="settings-page">
      <header className="page-header flex-between">
        <div>
          <h1 className="page-title">Server Rules & Settings</h1>
          <p className="page-subtitle">Configure ANTIFY cyber-moderation parameters for <strong>{activeGuild.name}</strong>.</p>
        </div>
      </header>

      {settingsLoading ? (
        <div className="dashboard-loader">Reading server rules database...</div>
      ) : (
        <div className="settings-grid">
          <div className="settings-main">
            {/* 1. Core Bot Modules */}
            <Card className="settings-card" glow>
              <div className="card-header">
                <Shield className="header-icon" />
                <h2>Protection Modules</h2>
              </div>
              
              <div className="settings-list">
                <div className="setting-item">
                  <div className="setting-info">
                    <h3>Anti-Scam Engine</h3>
                    <p>Detect and block messages matching suspicious scam keywords and behaviors.</p>
                  </div>
                  <Toggle 
                    enabled={currentSettings.antiScamEnabled !== false} 
                    onChange={() => handleToggle('antiScamEnabled')} 
                  />
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <h3>Anti-Phishing Filter</h3>
                    <p>Scan incoming message URLs against flagged databases and bad TLD domains.</p>
                  </div>
                  <Toggle 
                    enabled={currentSettings.antiPhishingEnabled !== false} 
                    onChange={() => handleToggle('antiPhishingEnabled')} 
                  />
                </div>

                 <div className="setting-item">
                  <div className="setting-info">
                    <h3>OCR Image Scanner {!isPremium && <span className="settings-pro-badge" style={{ fontSize: '0.6rem', color: 'var(--accent-purple)', background: 'rgba(139,92,246,0.1)', padding: '2px 6px', borderRadius: '4px', marginLeft: '6px', border: '1px solid rgba(139,92,246,0.2)' }}>PRO</span>}</h3>
                    <p>Extract and scan text within image attachments (catches screenshot giveaways).</p>
                  </div>
                  <Toggle 
                    enabled={isPremium ? currentSettings.ocrEnabled : false} 
                    onChange={isPremium ? () => handleToggle('ocrEnabled') : () => addAlert('OCR Image Scanning is an ANTIFY PRO feature.', 'warning')} 
                  />
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <h3>Welcome Announcements</h3>
                    <p>Send customized welcome notifications to members joining the Discord server.</p>
                  </div>
                  <Toggle 
                    enabled={currentSettings.welcomeEnabled} 
                    onChange={() => handleToggle('welcomeEnabled')} 
                  />
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <h3>Auto-Role Assignment</h3>
                    <p>Automatically assign a default role to new members upon joining.</p>
                  </div>
                  <Toggle 
                    enabled={currentSettings.roleManagementEnabled} 
                    onChange={() => handleToggle('roleManagementEnabled')} 
                  />
                </div>
              </div>
            </Card>

            {/* 2. Auto Moderation Actions */}
            <Card className="settings-card">
              <div className="card-header">
                <SettingsIcon className="header-icon" />
                <h2>Auto Moderation Actions</h2>
              </div>
              
              <div className="settings-list">
                <div className="setting-item">
                  <div className="setting-info">
                    <h3>Auto-Timeout Members</h3>
                    <p>Mute users for 5 minutes when a threat is detected.</p>
                  </div>
                  <Toggle 
                    enabled={currentSettings.autoTimeout} 
                    onChange={() => handleToggle('autoTimeout')} 
                  />
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <h3>Auto-Kick Violators</h3>
                    <p>Kick users immediately on matching threat triggers.</p>
                  </div>
                  <Toggle 
                    enabled={currentSettings.autoKick} 
                    onChange={() => handleToggle('autoKick')} 
                  />
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <h3>Auto-Ban Scammers</h3>
                    <p>Ban accounts instantly when phishing or bad links are matched.</p>
                  </div>
                  <Toggle 
                    enabled={currentSettings.autoBan} 
                    onChange={() => handleToggle('autoBan')} 
                  />
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <h3>Delete Malicious Messages</h3>
                    <p>Instantly remove messages containing flagged content.</p>
                  </div>
                  <Toggle 
                    enabled={currentSettings.deleteMessages} 
                    onChange={() => handleToggle('deleteMessages')} 
                  />
                </div>

                <div className="setting-item">
                  <div className="setting-info">
                    <h3>Strict Mode</h3>
                    <p>Increase detection sensitivity. (May flag false positives).</p>
                  </div>
                  <Toggle 
                    enabled={currentSettings.strictMode} 
                    onChange={() => handleToggle('strictMode')} 
                  />
                </div>
              </div>
            </Card>

            {/* 3. VirusTotal & Logging & Welcomes Text inputs */}
            <form onSubmit={handleSaveTextSettings}>
              <Card className="settings-card">
                <div className="card-header">
                  <Volume2 className="header-icon" />
                  <h2>External API & Logging Channels</h2>
                </div>

                <div className="settings-list">
                  <div className="setting-item">
                    <div className="setting-info">
                      <h3>VirusTotal API Checks</h3>
                      <p>Run automated VirusTotal database reputation checks for suspicious links.</p>
                    </div>
                    <Toggle 
                      enabled={currentSettings.virusTotalEnabled !== false} 
                      onChange={() => handleToggle('virusTotalEnabled')} 
                    />
                  </div>

                  <div className="input-field-group">
                    <label htmlFor="log-channel" className="input-field-label">Security Alerts Channel ID:</label>
                    <input 
                      type="text" 
                      id="log-channel"
                      placeholder="e.g. 150247658931200254" 
                      className="text-input-field glass"
                      value={loggingChannel}
                      onChange={(e) => setLoggingChannel(e.target.value)}
                    />
                    <span className="input-field-desc">Logs detailed cyber threat alert embeds in this text channel.</span>
                  </div>

                  {currentSettings.roleManagementEnabled && (
                    <div className="input-field-group">
                      <label htmlFor="auto-role" className="input-field-label">Default New Member Role ID:</label>
                      <input 
                        type="text" 
                        id="auto-role"
                        placeholder="e.g. 150247658931200255" 
                        className="text-input-field glass"
                        value={autorole}
                        onChange={(e) => setAutorole(e.target.value)}
                      />
                      <span className="input-field-desc">Assigned dynamically when a user joins the server.</span>
                    </div>
                  )}

                  {currentSettings.welcomeEnabled && (
                    <>
                      <div className="input-field-group">
                        <label htmlFor="welcome-channel" className="input-field-label">Welcome Announcements Channel ID:</label>
                        <input 
                          type="text" 
                          id="welcome-channel"
                          placeholder="e.g. 150247658931200256" 
                          className="text-input-field glass"
                          value={welcomeChannel}
                          onChange={(e) => setWelcomeChannel(e.target.value)}
                        />
                      </div>

                      <div className="input-field-group">
                        <label htmlFor="welcome-text" className="input-field-label">Welcome Message Text:</label>
                        <textarea 
                          id="welcome-text"
                          rows="3"
                          placeholder="Welcome {user} to the server!" 
                          className="text-input-field text-area-field glass"
                          value={welcomeText}
                          onChange={(e) => setWelcomeText(e.target.value)}
                        />
                        <span className="input-field-desc">Supported placeholders: `{'{user}'}` (Mentions member), `{'{server}'}` (Server name).</span>
                      </div>
                    </>
                  )}

                  <div className="save-btn-row">
                    <Button type="submit" className="btn-primary flex-center" style={{ gap: '8px' }}>
                      <Save size={16} />
                      <span>Save Inputs & Channels</span>
                    </Button>
                  </div>
                </div>
              </Card>
            </form>

            {/* 4. Trust Settings */}
            <Card className="settings-card">
              <div className="card-header">
                <UserCheck className="header-icon" />
                <h2>Bypass & Threshold Filters</h2>
              </div>
              
              <div className="settings-list">
                <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                  <div className="setting-info flex-between">
                    <div>
                      <h3>Scan Sensitivity Threshold</h3>
                      <p>Adjust AI blocking confidence limit. Lower threshold = more aggressive scanning.</p>
                    </div>
                    <span className="text-purple font-semibold" style={{ fontSize: '1.2rem', color: 'var(--accent-purple-light)' }}>
                      {currentSettings.scanSensitivity || 50}%
                    </span>
                  </div>
                  <div className="flex-between" style={{ gap: '1rem' }}>
                    <input 
                      type="range" 
                      min="1" 
                      max="100" 
                      value={currentSettings.scanSensitivity || 50} 
                      className="sensitivity-slider" 
                      style={{ flex: 1, accentColor: 'var(--accent-purple)', cursor: 'pointer', height: '6px', borderRadius: '3px' }}
                      onChange={(e) => updateSettings({ scanSensitivity: Number(e.target.value) })}
                    />
                  </div>
                </div>

                {/* Whitelisted Channels */}
                <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                  <div className="setting-info">
                    <h3>Whitelisted Channels</h3>
                    <p>Bypass threat detection scanning completely on these channels.</p>
                  </div>
                  <div className="tag-manager-group" style={{ display: 'flex', gap: '8px', margin: '4px 0' }}>
                    <input 
                      type="text" 
                      placeholder="Channel ID (e.g. 15024765893120)" 
                      className="keyword-input"
                      value={newChannel}
                      onChange={(e) => setNewChannel(e.target.value)}
                    />
                    <Button variant="outline" type="button" onClick={() => {
                      if (newChannel.trim()) {
                        const oldList = currentSettings.whitelistChannels || [];
                        if (!oldList.includes(newChannel.trim())) {
                          updateSettings({ whitelistChannels: [...oldList, newChannel.trim()] });
                        }
                        setNewChannel('');
                      }
                    }}>Add ID</Button>
                  </div>
                  <div className="keyword-tags">
                    {(currentSettings.whitelistChannels || []).map(chId => (
                      <span key={chId} className="keyword-tag">
                        #{chId}
                        <button type="button" className="tag-remove" onClick={() => {
                          updateSettings({ whitelistChannels: currentSettings.whitelistChannels.filter(c => c !== chId) });
                        }}>×</button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Trusted Roles */}
                <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                  <div className="setting-info">
                    <h3>Trusted Roles (Bypass Scans)</h3>
                    <p>Users with these roles will bypass all anti-scam checks.</p>
                  </div>
                  <div className="tag-manager-group" style={{ display: 'flex', gap: '8px', margin: '4px 0' }}>
                    <input 
                      type="text" 
                      placeholder="Role ID (e.g. 15024765893121)" 
                      className="keyword-input"
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value)}
                    />
                    <Button variant="outline" type="button" onClick={() => {
                      if (newRole.trim()) {
                        const oldList = currentSettings.trustedRoles || [];
                        if (!oldList.includes(newRole.trim())) {
                          updateSettings({ trustedRoles: [...oldList, newRole.trim()] });
                        }
                        setNewRole('');
                      }
                    }}>Add ID</Button>
                  </div>
                  <div className="keyword-tags">
                    {(currentSettings.trustedRoles || []).map(roleId => (
                      <span key={roleId} className="keyword-tag">
                        Role: {roleId}
                        <button type="button" className="tag-remove" onClick={() => {
                          updateSettings({ trustedRoles: currentSettings.trustedRoles.filter(r => r !== roleId) });
                        }}>×</button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Whitelisted Users */}
                <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                  <div className="setting-info">
                    <h3>Whitelisted Users (Global Bypass)</h3>
                    <p>Trusted users who bypass cybersecurity checks.</p>
                  </div>
                  <div className="tag-manager-group" style={{ display: 'flex', gap: '8px', margin: '4px 0' }}>
                    <input 
                      type="text" 
                      placeholder="User ID (e.g. 12345678901234)" 
                      className="keyword-input"
                      value={newUser}
                      onChange={(e) => setNewUser(e.target.value)}
                    />
                    <Button variant="outline" type="button" onClick={() => {
                      if (newUser.trim()) {
                        const oldList = currentSettings.trustedUsers || [];
                        if (!oldList.includes(newUser.trim())) {
                          updateSettings({ trustedUsers: [...oldList, newUser.trim()] });
                        }
                        setNewUser('');
                      }
                    }}>Add ID</Button>
                  </div>
                  <div className="keyword-tags">
                    {(currentSettings.trustedUsers || []).map(uId => (
                      <span key={uId} className="keyword-tag">
                        User: {uId}
                        <button type="button" className="tag-remove" onClick={() => {
                          updateSettings({ trustedUsers: currentSettings.trustedUsers.filter(u => u !== uId) });
                        }}>×</button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Announcement Channels */}
                <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                  <div className="setting-info">
                    <h3>Announcement Channels</h3>
                    <p>Bypass moderation completely on server announcement channels.</p>
                  </div>
                  <div className="tag-manager-group" style={{ display: 'flex', gap: '8px', margin: '4px 0' }}>
                    <input 
                      type="text" 
                      placeholder="Channel ID (e.g. 15024765893122)" 
                      className="keyword-input"
                      value={newAnnChannel}
                      onChange={(e) => setNewAnnChannel(e.target.value)}
                    />
                    <Button variant="outline" type="button" onClick={() => {
                      if (newAnnChannel.trim()) {
                        const oldList = currentSettings.announcementChannels || [];
                        if (!oldList.includes(newAnnChannel.trim())) {
                          updateSettings({ announcementChannels: [...oldList, newAnnChannel.trim()] });
                        }
                        setNewAnnChannel('');
                      }
                    }}>Add ID</Button>
                  </div>
                  <div className="keyword-tags">
                    {(currentSettings.announcementChannels || []).map(chId => (
                      <span key={chId} className="keyword-tag">
                        Announce: {chId}
                        <button type="button" className="tag-remove" onClick={() => {
                          updateSettings({ announcementChannels: currentSettings.announcementChannels.filter(c => c !== chId) });
                        }}>×</button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <div className="settings-sidebar">
            <Card className="settings-card">
              <div className="card-header">
                <MessageSquare className="header-icon" />
                <h2>Blacklist Keywords</h2>
              </div>
              <p className="keyword-desc">Add custom words or phrases to block dynamically.</p>
              
              <form onSubmit={handleKeywordAdd} className="keyword-input-group">
                <input 
                  type="text" 
                  placeholder="e.g. steam-gift" 
                  className="keyword-input" 
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                />
                <Button type="submit" variant="outline">
                  <Plus size={16} />
                </Button>
              </form>
              
              <div className="keyword-tags">
                {(currentSettings.blacklistKeywords || []).length === 0 ? (
                  <div className="empty-keywords-text">No custom keywords. Default global list active.</div>
                ) : (
                  (currentSettings.blacklistKeywords || []).map(kw => (
                    <span key={kw} className="keyword-tag">
                      {kw}
                      <button 
                        type="button" 
                        className="tag-remove" 
                        onClick={() => removeKeyword(kw)}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
