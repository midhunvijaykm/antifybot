import React, { useEffect, useState } from 'react';
import { Users, ShieldAlert, Zap, Server, PlusCircle, Activity, FileText, UserX, History, Globe } from 'lucide-react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useStore } from '../store/useStore';
import Card from '../components/Card';
import Button from '../components/Button';
import './Dashboard.css';

const StatCard = ({ title, value, icon: Icon, subtext }) => (
  <Card hoverEffect className="stat-card">
    <div className="stat-header">
      <span className="stat-title">{title}</span>
      <div className="stat-icon-wrapper">
        <Icon size={20} className="stat-icon" />
      </div>
    </div>
    <div className="stat-body">
      <h3 className="stat-value">{value}</h3>
      <span className="stat-trend positive">{subtext}</span>
    </div>
  </Card>
);

const Dashboard = () => {
  const { 
    activeGuild, 
    stats, 
    dashboardStats,
    fetchDashboardStats,
    logs, 
    statsLoading, 
    logsLoading, 
    scanProgress, 
    triggerScan, 
    cancelHistoricalScan, 
    resumeHistoricalScan, 
    deletedMessages, 
    deletedMessagesLoading,
    usage,
    fetchUsage
  } = useStore();
  
  const [scanDepth, setScanDepth] = useState(100);

  useEffect(() => {
    if (activeGuild?.botActive) {
      fetchDashboardStats(activeGuild.id);
      fetchUsage(activeGuild.id);
    }
  }, [activeGuild?.id, activeGuild?.botActive, fetchDashboardStats, fetchUsage]);

  const handleInviteBot = () => {
    if (!activeGuild) return;
    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=1501936383160225852&permissions=8&scope=bot%20applications.commands&guild_id=${activeGuild.id}&disable_guild_select=true`;
    window.open(inviteUrl, '_blank');
  };

  // If no guild is selected
  if (!activeGuild) {
    return (
      <div className="empty-dashboard-state">
        <Server size={48} className="empty-icon animate-pulse" />
        <h2>No Guild Selected</h2>
        <p>Please select a Discord server from the header selector to monitor status.</p>
      </div>
    );
  }

  // If bot is not in the selected guild
  if (!activeGuild.botActive) {
    return (
      <div className="empty-dashboard-state">
        <Server size={48} className="empty-icon text-warning" />
        <h2>ANTIFY Bot Not Active</h2>
        <p>To start protecting <strong>{activeGuild.name}</strong>, invite the moderation bot using the link below.</p>
        <Button className="btn-primary invite-action-btn" onClick={handleInviteBot}>
          <PlusCircle size={18} />
          <span>Invite ANTIFY Bot</span>
        </Button>
      </div>
    );
  }

  const totals = {
    totalScans: stats?.totals?.totalScans || dashboardStats?.totalScans || 0,
    totalThreats: stats?.totals?.totalThreats || stats?.totals?.detections || dashboardStats?.totalThreats || 0,
    filesScannedToday: stats?.totals?.filesScannedToday || dashboardStats?.filesScannedToday || 0,
    usersFlagged: stats?.totals?.usersFlagged || dashboardStats?.usersFlagged || 0,
    serversProtected: stats?.totals?.serversProtected || dashboardStats?.serversProtected || 1,
    offendersDetected: stats?.totals?.offendersDetected || dashboardStats?.offendersDetected || 0,
    historyScanExecutions: stats?.totals?.historyScanExecutions || dashboardStats?.historyScanExecutions || 0,
    virusTotalDetections: stats?.totals?.virusTotalDetections || dashboardStats?.virusTotalDetections || 0,
  };

  const trendData = stats?.detectionTrends || [];
  const weeklyTrends = stats?.weeklyTrends || [];
  const recentLogs = (logs || []).slice(0, 4);

  return (
    <div className="dashboard-page">
      <header className="page-header">
        <h1 className="page-title">Dashboard Overview</h1>
        <p className="page-subtitle">Real-time anti-scam shield statistics for <strong>{activeGuild.name}</strong>.</p>
      </header>

      {/* Historical Sync Control Panel */}
      <Card className="historical-sync-card glass-panel" glow={scanProgress?.active}>
        <div className="sync-card-header">
          <div className="sync-title-area">
            <h2 className="sync-title">Historical Synchronization Panel</h2>
            <p className="sync-subtitle">
              Recover previous message history, search for past threat logs, and sync historical analytics.
            </p>
          </div>
          {(!scanProgress || !scanProgress.active) && (
            <div className="sync-controls">
              <label htmlFor="scan-depth" className="depth-label">Scan Depth:</label>
              <select 
                id="scan-depth"
                value={scanDepth} 
                onChange={(e) => setScanDepth(Number(e.target.value))}
                className="depth-select glass"
              >
                <option value={50}>50 messages</option>
                <option value={100}>100 messages (Default)</option>
                <option value={500}>500 messages</option>
                <option value={1000}>1000 messages (Enterprise)</option>
              </select>
              <Button className="btn-primary sync-btn" onClick={() => triggerScan(activeGuild.id, scanDepth)}>
                <Activity size={16} className="sync-btn-icon" />
                <span>Start New Scan</span>
              </Button>
              {scanProgress && ['cancelled', 'paused', 'failed'].includes(scanProgress.status) && (
                <Button className="btn-secondary resume-btn" onClick={() => resumeHistoricalScan(activeGuild.id)}>
                  <Activity size={16} />
                  <span>Resume Previous Scan</span>
                </Button>
              )}
            </div>
          )}
        </div>

        {scanProgress && scanProgress.status !== 'inactive' && (
          <div className="sync-progress-area">
            <div className="sync-progress-metrics">
              <span className="metric-item">
                Status: <strong className="text-purple uppercase">{scanProgress.status}</strong>
              </span>
              <span className="metric-item">
                Channel: <strong>#{scanProgress.currentChannelName || 'fetching...'}</strong>
              </span>
              <span className="metric-item">
                Channels: <strong>{scanProgress.processedChannels} / {scanProgress.totalChannels}</strong>
              </span>
              <span className="metric-item">
                Scanned: <strong>{scanProgress.messagesScanned} messages</strong>
              </span>
              <span className="metric-item text-red-glow">
                Threats Recovered: <strong className="text-red">{scanProgress.detectionsFound}</strong>
              </span>
            </div>
            
            <div className="progress-bar-container glass">
              <div 
                className="progress-bar-fill" 
                style={{ width: `${Math.round((scanProgress.processedChannels / (scanProgress.totalChannels || 1)) * 100)}%` }}
              ></div>
            </div>
            <div className="progress-actions-row">
              <span className="progress-percentage-text">
                {Math.round((scanProgress.processedChannels / (scanProgress.totalChannels || 1)) * 100)}% Synchronized
              </span>
              {scanProgress.active && (
                <Button className="btn-danger cancel-scan-btn" onClick={() => cancelHistoricalScan(activeGuild.id)}>
                  <span>Cancel Scan</span>
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {statsLoading ? (
        <div className="dashboard-loader">Syncing telemetry logs...</div>
      ) : (
        <>
          <div className="stats-grid">
            <StatCard title="Total Scans" value={totals.totalScans} icon={Activity} subtext="OCR & text scan checks" />
            <StatCard title="Threat Detections" value={totals.totalThreats} icon={ShieldAlert} subtext="Malicious logs flagged" />
            <StatCard title="Files Scanned Today" value={totals.filesScannedToday} icon={FileText} subtext="Images & attachments analyzed" />
            <StatCard title="Users Flagged" value={totals.usersFlagged} icon={Users} subtext="Flagged for violation risk" />
            <StatCard title="Servers Protected" value={totals.serversProtected} icon={Server} subtext="Active server connections" />
            <StatCard title="Offenders Detected" value={totals.offendersDetected} icon={UserX} subtext="Logged in offender DB" />
            <StatCard title="HistoryScan Runs" value={totals.historyScanExecutions} icon={History} subtext="Full sweeps executed" />
            <StatCard title="VirusTotal Hits" value={totals.virusTotalDetections} icon={Globe} subtext="VT verified threats" />
          </div>

          {/* Usage & Limits Quick Summary Card */}
          {usage && (
            <Card className="usage-summary-card glass-panel" style={{ marginTop: '24px', padding: '24px' }}>
              <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: 'none', padding: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Zap size={20} className="text-purple" style={{ color: 'var(--accent-purple)' }} />
                  <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>System Resource Usage & Limits</h2>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Next daily reset in: <strong style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{usage.resetsInHours} Hours</strong>
                </div>
              </div>
              <div className="usage-summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div className="usage-summary-item glass" style={{ padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.01)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Image Scam Protection</span>
                    <strong style={{ color: 'var(--text-primary)' }}>{usage.imageScans.used} / {usage.imageScans.limit === 'Unlimited' ? '∞' : usage.imageScans.limit}</strong>
                  </div>
                  <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${usage.imageScans.limit === 'Unlimited' ? 100 : Math.min(100, Math.round((usage.imageScans.used / usage.imageScans.limit) * 100))}%`,
                      background: 'var(--accent-purple)'
                    }} />
                  </div>
                </div>

                <div className="usage-summary-item glass" style={{ padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.01)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>HistoryScans</span>
                    <strong style={{ color: 'var(--text-primary)' }}>{usage.historyScans.used} / {usage.historyScans.limit === 'Unlimited' ? '∞' : usage.historyScans.limit}</strong>
                  </div>
                  <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${usage.historyScans.limit === 'Unlimited' ? 100 : Math.min(100, Math.round((usage.historyScans.used / usage.historyScans.limit) * 100))}%`,
                      background: '#ec4899'
                    }} />
                  </div>
                </div>

                <div className="usage-summary-item glass" style={{ padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.01)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>VirusTotal Queries</span>
                    <strong style={{ color: 'var(--text-primary)' }}>{usage.virusTotalRequests.used} / {usage.virusTotalRequests.limit === 'Unlimited' ? '∞' : usage.virusTotalRequests.limit}</strong>
                  </div>
                  <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${usage.virusTotalRequests.limit === 'Unlimited' ? 100 : Math.min(100, Math.round((usage.virusTotalRequests.used / usage.virusTotalRequests.limit) * 100))}%`,
                      background: 'var(--accent-blue)'
                    }} />
                  </div>
                </div>

                <div className="usage-summary-item glass" style={{ padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.01)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Threat Reports</span>
                    <strong style={{ color: 'var(--text-primary)' }}>{usage.threatReports.used} / {usage.threatReports.limit === 'Unlimited' ? '∞' : usage.threatReports.limit}</strong>
                  </div>
                  <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${usage.threatReports.limit === 'Unlimited' ? 100 : Math.min(100, Math.round((usage.threatReports.used / usage.threatReports.limit) * 100))}%`,
                      background: '#10b981'
                    }} />
                  </div>
                </div>
              </div>
            </Card>
          )}

          <div className="dashboard-content-grid">
            <div className="dashboard-left-col">
              <div className="charts-grid">
                <Card className="chart-section" glow>
                  <div className="section-header">
                    <h2 className="section-title">Detection Trends (Last 7 Days)</h2>
                  </div>
                  <div className="chart-container">
                    {trendData.length === 0 ? (
                      <div className="empty-chart-text">No threat trends logged yet.</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={trendData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="name" stroke="#94a3b8" />
                          <YAxis stroke="#94a3b8" />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#121422', border: '1px solid rgba(255,255,255,0.05)' }}
                            itemStyle={{ color: '#8b5cf6' }}
                          />
                          <Line 
                            type="monotone" 
                            dataKey="detections" 
                            stroke="#8b5cf6" 
                            strokeWidth={3}
                            dot={{ fill: '#8b5cf6', strokeWidth: 2 }}
                            activeDot={{ r: 8, fill: '#3b82f6' }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Card>

                <Card className="chart-section" glow>
                  <div className="section-header">
                    <h2 className="section-title">Weekly Threat Volume (Last 4 Weeks)</h2>
                  </div>
                  <div className="chart-container">
                    {weeklyTrends.length === 0 ? (
                      <div className="empty-chart-text">No weekly aggregates logged yet.</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={weeklyTrends}>
                          <defs>
                            <linearGradient id="colorWeekly" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="name" stroke="#94a3b8" />
                          <YAxis stroke="#94a3b8" />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#121422', border: '1px solid rgba(255,255,255,0.05)' }}
                            itemStyle={{ color: '#3b82f6' }}
                          />
                          <Area 
                            type="monotone" 
                            dataKey="detections" 
                            stroke="#3b82f6" 
                            strokeWidth={3}
                            fillOpacity={1}
                            fill="url(#colorWeekly)"
                            dot={{ fill: '#3b82f6', strokeWidth: 2 }}
                            activeDot={{ r: 8, fill: '#8b5cf6' }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Card>
              </div>

              {/* Archived Deleted Messages Section */}
              <Card className="deleted-messages-section glass-panel">
                <div className="section-header">
                  <h2 className="section-title">Archived Deleted Messages (Evidence Locker)</h2>
                </div>
                <div className="deleted-messages-list">
                  {deletedMessagesLoading ? (
                    <div className="loading-locker-text">Loading evidence files...</div>
                  ) : !deletedMessages || (deletedMessages || []).length === 0 ? (
                    <div className="empty-feed-text">No deleted messages archived yet. Server is clean!</div>
                  ) : (
                    (deletedMessages || []).slice(0, 5).map((msg) => (
                      <div key={msg._id} className="deleted-msg-item glass">
                        <div className="deleted-msg-header">
                          <span className="deleted-msg-author">{msg.username}</span>
                          <span className="deleted-msg-channel">in #{msg.channelName || 'unknown'}</span>
                          <span className="deleted-msg-reason">{msg.detectionType}</span>
                        </div>
                        <div className="deleted-msg-content">
                          "{msg.originalContent || '[Attachments Only]'}"
                        </div>
                        {msg.attachments && (msg.attachments || []).length > 0 && (
                          <div className="deleted-msg-attachments">
                            {(msg.attachments || []).map((url, idx) => (
                              <a href={url} target="_blank" rel="noreferrer" key={idx} className="attachment-link">
                                Attachment {idx + 1}
                              </a>
                            ))}
                          </div>
                        )}
                        <div className="deleted-msg-time">
                          {new Date(msg.deletedAt || msg.createdAt).toLocaleString()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>

            <Card className="activity-section">
              <div className="section-header">
                <h2 className="section-title">Recent Detections</h2>
              </div>
              <div className="activity-list">
                {logsLoading ? (
                  <div>Updating feed...</div>
                ) : recentLogs.length === 0 ? (
                  <div className="empty-feed-text">No threats detected. Server is safe!</div>
                ) : (
                  recentLogs.map((log) => (
                    <div key={log._id} className="activity-item">
                      <div className="activity-icon malicious">
                        <ShieldAlert size={16} />
                      </div>
                      <div className="activity-details">
                        <p className="activity-text">
                          Blocked <strong>{log.type}</strong> from <strong>{log.username}</strong>
                        </p>
                        <span className="activity-action-text">Action: {log.actionTaken}</span>
                        <span className="activity-time">{new Date(log.timestamp || log.createdAt).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};

export default Dashboard;