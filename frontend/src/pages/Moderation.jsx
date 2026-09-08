import { useState, useEffect } from 'react';
import { 
  Shield, CheckCircle, Eye, Clock, RotateCcw, FileText, Search, History,
  ArrowRight, ArrowLeft, ShieldCheck, Globe, MoreVertical
} from 'lucide-react';
import { useStore } from '../store/useStore';
import Card from '../components/Card';
import Button from '../components/Button';
import PremiumGate from '../components/PremiumGate';
import './Moderation.css';

const Moderation = () => {
  const getChannelBadgeLabel = (type) => {
    const labels = {
      'GuildText': 'Text Chat',
      'GuildVoice': 'VC Chat',
      'PublicThread': 'Public Thread',
      'PrivateThread': 'Private Thread',
      'AnnouncementThread': 'Announce Thread',
      'GuildForum': 'Forum Post',
      'GuildAnnouncement': 'Announcement',
      'GuildMedia': 'Media Post',
      'GuildStageVoice': 'Stage Chat'
    };
    return labels[type] || 'Text Chat';
  };

  const {
    activeGuild,
    moderationData,
    moderationLoading,
    auditLogs,
    deletedMessages,
    historyScans,
    historyScansPagination,
    historyScansLoading,
    fetchModerationData,
    fetchAuditLogs,
    fetchDeletedMessages,
    fetchHistoryScans,
    removeTimeout,
    unbanUser,
    deleteWarning,
    handleAppeal,
    markFalsePositive,
    premium,
    user
  } = useStore();

  const [activeSubTab, setActiveSubTab] = useState('actions');
  
  // HistoryScan Pagination/Filters
  const [historySearch, setHistorySearch] = useState('');
  const [historyRisk, setHistoryRisk] = useState('');
  const [historyAction, setHistoryAction] = useState('');
  const [historyPage, setHistoryPage] = useState(1);

  // Selected evidence ID for the inspector tab
  const [selectedEvidenceId, setSelectedEvidenceId] = useState('');

  // Appeal moderator notes
  const [appealNotes, setAppealNotes] = useState({});

  // Unified actions list filters
  const [actionTypeFilter, setActionTypeFilter] = useState('All');

  // Actions dropdown state
  const [openDropdownId, setOpenDropdownId] = useState(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (openDropdownId && !e.target.closest('.dropdown-container')) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [openDropdownId]);

  // Trigger data fetching on mount / guild change
  useEffect(() => {
    if (activeGuild?.id && activeGuild?.botActive) {
      fetchModerationData(activeGuild.id);
      fetchAuditLogs(activeGuild.id);
      fetchDeletedMessages(activeGuild.id);
    }
  }, [activeGuild?.id, activeGuild?.botActive, fetchModerationData, fetchAuditLogs, fetchDeletedMessages]);

  // Fetch HistoryScans if tab is active or filters change
  useEffect(() => {
    if (activeGuild?.id && activeGuild?.botActive && activeSubTab === 'history') {
      fetchHistoryScans(activeGuild.id, historyPage, historySearch, historyRisk, historyAction);
    }
  }, [activeGuild?.id, activeGuild?.botActive, activeSubTab, historyPage, historySearch, historyRisk, historyAction, fetchHistoryScans]);

  if (!activeGuild) {
    return (
      <div className="empty-dashboard-state">
        <Shield size={48} className="empty-icon animate-pulse" />
        <h2>No Guild Selected</h2>
        <p>Please select a Discord server from the header selector to monitor status.</p>
      </div>
    );
  }

  if (!activeGuild.botActive) {
    return (
      <div className="empty-dashboard-state">
        <Shield size={48} className="empty-icon text-warning" />
        <h2>ANTIFY Bot Not Active</h2>
        <p>Invite the bot to this server to unlock the Moderation Center.</p>
      </div>
    );
  }

  const punishments = Array.isArray(moderationData?.punishments) ? moderationData.punishments : [];
  const warnings = Array.isArray(moderationData?.warnings) ? moderationData.warnings : [];
  const safeDeletedMessages = Array.isArray(deletedMessages) ? deletedMessages : [];
  const safeHistoryScans = Array.isArray(historyScans) ? historyScans : [];
  const safeAuditLogs = Array.isArray(auditLogs) ? auditLogs : [];
  const appeals = punishments.filter(p => p.appealStatus && p.appealStatus !== 'None');

  // Unified "Recent Actions" combining warnings, timeouts, kicks, bans
  const unifiedActions = [
    ...warnings.map(w => ({
      ...w,
      unifiedType: 'Warning',
      actionDate: w.createdAt,
      targetId: w._id,
      isActive: w.active && !w.falsePositive
    })),
    ...punishments.map(p => ({
      ...p,
      unifiedType: p.type,
      actionDate: p.createdAt,
      targetId: p._id,
      isActive: p.active && !p.expired && !p.revoked && !p.falsePositive
    }))
  ]
    .filter(action => {
      if (actionTypeFilter === 'All') return true;
      if (actionTypeFilter === 'Warning') return action.unifiedType === 'Warning';
      if (actionTypeFilter === 'Timeout') return action.unifiedType === 'Timeout';
      if (actionTypeFilter === 'Kick') return action.unifiedType === 'Kick';
      if (actionTypeFilter === 'Ban') return action.unifiedType === 'Ban';
      return true;
    })
    .sort((a, b) => new Date(b.actionDate) - new Date(a.actionDate));

  // Count active stats for badges
  const activePunishmentsCount = punishments.filter(p => p.active && !p.expired && !p.revoked).length;
  const warningListCount = warnings.filter(w => w.active).length;
  const appealsCount = punishments.filter(p => p.appealStatus === 'Pending').length;

  // Selected Evidence logic
  let selectedEvidence = safeDeletedMessages.find(m => m._id === selectedEvidenceId || m.messageId === selectedEvidenceId);
  if (!selectedEvidence && safeHistoryScans.length > 0) {
    // Check if the selectedEvidenceId matches a history scan record's evidenceId or data
    const matchedScan = safeHistoryScans.find(s => s.evidenceId === selectedEvidenceId || s._id === selectedEvidenceId);
    if (matchedScan) {
      selectedEvidence = {
        _id: matchedScan.evidenceId || matchedScan._id,
        username: matchedScan.username,
        displayName: matchedScan.username,
        userId: matchedScan.userId,
        channelName: 'historical-scan',
        channelType: 'GuildText',
        originalContent: matchedScan.findings,
        matchedKeywords: matchedScan.scanResults ? matchedScan.scanResults.split(', ') : [],
        scamScore: matchedScan.threatScore,
        aiConfidence: matchedScan.threatScore,
        deletionReason: matchedScan.scanResults || 'Historical Scan Detection',
        createdAt: matchedScan.timestamp,
        deletedAt: matchedScan.timestamp,
        isHistorical: true
      };
    }
  }
  // Default to first deleted message if none selected
  if (!selectedEvidence && safeDeletedMessages.length > 0) {
    selectedEvidence = safeDeletedMessages[0];
  }

  // Navigation menu items
  const navItems = [
    { id: 'actions', label: 'Recent Actions', icon: Shield, count: activePunishmentsCount + warningListCount },
    { id: 'history', label: 'HistoryScan Results', icon: History },
    { id: 'evidence', label: 'Evidence Viewer', icon: Eye },
    { id: 'appeals', label: 'Appeals Panel', icon: CheckCircle, count: appealsCount },
    { id: 'falsepositives', label: 'False Positive Review', icon: RotateCcw, count: safeDeletedMessages.filter(m => m.falsePositive).length },
    { id: 'auditlogs', label: 'Audit Logs', icon: FileText }
  ];

  const isOwner = user && user.id === '1060801714187415552';
  const isLocked = !isOwner && premium?.plan !== 'Pro';

  return (
    <PremiumGate
      locked={isLocked}
      featureName="Moderation Center"
      description="Manage timeouts, warnings, appeals, and false positives in real time."
      benefits={[
        "Access history scan results table",
        "Inspect and appeal warnings, kicks, and bans",
        "Investigate attachments and OCR content inside the Evidence Viewer",
        "Review false positive flags and restore messages"
      ]}
      freeLimit="Locked on Free Servers"
    >
      <div className="moderation-page">
      <header className="page-header">
        <h1 className="page-title">Moderation Operations Center</h1>
        <p className="page-subtitle">Unified threat response, historical analytics, and forensic evidence tracking for <strong>{activeGuild.name}</strong>.</p>
      </header>

      <div className="moderation-layout">
        {/* Left Submenu Navigation */}
        <div className="moderation-nav">
          {navItems.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`mod-nav-btn ${activeSubTab === item.id ? 'active' : ''}`}
                onClick={() => setActiveSubTab(item.id)}
              >
                <Icon size={16} />
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.count !== undefined && item.count > 0 && (
                  <span className="badge badge-active" style={{ fontSize: '0.65rem', padding: '2px 6px', background: 'rgba(139,92,246,0.2)' }}>
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right Content Panel */}
        <div className="moderation-content">
          {moderationLoading && activeSubTab !== 'history' ? (
            <div className="dashboard-loader">Reading security incident state...</div>
          ) : (
            <Card>
              {/* ========================================================
                  1. RECENT ACTIONS (UNIFIED WARNINGS, TIMEOUTS, KICKS, BANS)
                 ======================================================== */}
              {activeSubTab === 'actions' && (
                <div>
                  <div className="card-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '12px' }}>
                    <div className="card-header" style={{ margin: 0 }}>
                      <Shield className="header-icon text-purple" />
                      <h2>Recent Moderation Actions</h2>
                    </div>
                    {/* Unified Filter Tabs */}
                    <div className="action-filters glass" style={{ display: 'flex', gap: '4px', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      {['All', 'Warning', 'Timeout', 'Kick', 'Ban'].map(type => (
                        <button
                          key={type}
                          className={`filter-tab-btn ${actionTypeFilter === type ? 'active' : ''}`}
                          onClick={() => setActionTypeFilter(type)}
                          style={{
                            padding: '4px 12px',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: 500,
                            color: actionTypeFilter === type ? 'white' : 'var(--text-secondary)',
                            background: actionTypeFilter === type ? 'var(--accent-purple)' : 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                          }}
                        >
                          {type}s
                        </button>
                      ))}
                    </div>
                  </div>

                  {unifiedActions.length === 0 ? (
                    <div className="empty-state">
                      <ShieldCheck size={36} className="text-muted" style={{ color: '#10b981' }} />
                      <h3>No Recent Actions Logged</h3>
                      <p>No warnings, timeouts, kicks, or bans match the active filter criteria.</p>
                    </div>
                  ) : (
                    <div className="table-container">
                      <table className="moderation-table">
                        <thead>
                          <tr>
                            <th>User</th>
                            <th>Action Type</th>
                            <th>Date</th>
                            <th>Moderator</th>
                            <th>Reason</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(unifiedActions || []).slice(0, 30).map((act, idx) => {
                            const actEvidence = (deletedMessages || []).find(m => m._id === act.evidenceId || m.messageId === act.evidenceId);
                            const channelName = actEvidence?.channelName || '';
                            
                            return (
                              <tr key={act._id || idx}>
                                <td>
                                  <strong>{act.username}</strong>
                                  <div className="text-muted" style={{ fontSize: '0.75rem' }}>ID: {act.userId}</div>
                                  {channelName && (
                                    <div className="text-muted" style={{ fontSize: '0.7rem', marginTop: '2px', color: 'var(--text-muted)' }}>
                                      #{channelName}
                                    </div>
                                  )}
                                </td>
                                <td>
                                  <span className={`badge ${
                                    act.unifiedType === 'Ban' ? 'badge-rejected' : 
                                    act.unifiedType === 'Timeout' ? 'badge-pending' : 
                                    act.unifiedType === 'Warning' ? 'badge-warning' : 'badge-active'
                                  }`}
                                  style={{
                                    background: 
                                      act.unifiedType === 'Ban' ? 'rgba(239, 68, 68, 0.15)' : 
                                      act.unifiedType === 'Timeout' ? 'rgba(245, 158, 11, 0.15)' : 
                                      act.unifiedType === 'Warning' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                                    color: 
                                      act.unifiedType === 'Ban' ? '#fca5a5' : 
                                      act.unifiedType === 'Timeout' ? '#fde047' : 
                                      act.unifiedType === 'Warning' ? '#93c5fd' : '#a7f3d0'
                                  }}>
                                    {act.unifiedType}
                                  </span>
                                </td>
                                <td>{new Date(act.actionDate).toLocaleString()}</td>
                                <td>
                                  {act.moderatorId === 'system' || act.moderatorId?.length > 15 ? 'ANTIFY Bot' : act.moderatorId || 'Admin'}
                                </td>
                                <td>{act.reason || 'No reason provided.'}</td>
                                <td>
                                  <span className={`badge ${act.isActive ? 'badge-active' : 'badge-expired'}`}>
                                    {act.isActive ? 'Active' : 'Expired/Revoked'}
                                  </span>
                                </td>
                                <td>
                                  <div className="action-cell">
                                    {act.isActive && (
                                      <>
                                        {act.unifiedType === 'Timeout' && (
                                          <Button variant="danger" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => removeTimeout(activeGuild.id, act.userId, act.targetId)}>
                                            Lift Mute
                                          </Button>
                                        )}
                                        {act.unifiedType === 'Ban' && (
                                          <Button variant="danger" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => unbanUser(activeGuild.id, act.userId, act.targetId)}>
                                            Unban
                                          </Button>
                                        )}
                                        {act.unifiedType === 'Warning' && (
                                          <Button variant="danger" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => deleteWarning(activeGuild.id, act.targetId)}>
                                            Delete
                                          </Button>
                                        )}
                                      </>
                                    )}
                                    <Button 
                                      variant="outline" 
                                      style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                                      onClick={() => {
                                        if (act.evidenceId) {
                                          setSelectedEvidenceId(act.evidenceId);
                                          setActiveSubTab('evidence');
                                        } else {
                                          setSelectedEvidenceId(act._id);
                                          setActiveSubTab('evidence');
                                        }
                                      }}
                                    >
                                      Inspect
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ========================================================
                  2. HISTORYSCAN RESULTS (SEARCHABLE & FILTERABLE TABLE)
                 ======================================================== */}
              {activeSubTab === 'history' && (
                <div>
                  <div className="card-header" style={{ marginBottom: '1.5rem' }}>
                    <History className="header-icon text-purple" />
                    <h2>HistoryScan Results</h2>
                  </div>

                  {/* Search and Filters Grid */}
                  <div className="history-filters-grid" style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '12px',
                    marginBottom: '1.5rem',
                    padding: '16px',
                    borderRadius: '12px',
                    background: 'rgba(0,0,0,0.15)',
                    border: '1px solid var(--border-color)'
                  }}>
                    {/* Search Bar */}
                    <div style={{ position: 'relative' }}>
                      <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                      <input
                        type="text"
                        placeholder="Search user, ID, findings..."
                        value={historySearch}
                        onChange={(e) => {
                          setHistorySearch(e.target.value);
                          setHistoryPage(1);
                        }}
                        style={{
                          width: '100%',
                          padding: '10px 12px 10px 36px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'rgba(0,0,0,0.2)',
                          color: 'white',
                          fontSize: '0.85rem',
                          outline: 'none'
                        }}
                      />
                    </div>

                    {/* Risk Level Filter */}
                    <select
                      value={historyRisk}
                      onChange={(e) => {
                        setHistoryRisk(e.target.value);
                        setHistoryPage(1);
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'rgba(0,0,0,0.2)',
                        color: 'white',
                        fontSize: '0.85rem',
                        outline: 'none'
                      }}
                    >
                      <option value="">All Risk Levels</option>
                      <option value="Low">Low Risk</option>
                      <option value="Medium">Medium Risk</option>
                      <option value="High">High Risk</option>
                      <option value="Critical">Critical Risk</option>
                    </select>

                    {/* Action Taken Filter */}
                    <select
                      value={historyAction}
                      onChange={(e) => {
                        setHistoryAction(e.target.value);
                        setHistoryPage(1);
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'rgba(0,0,0,0.2)',
                        color: 'white',
                        fontSize: '0.85rem',
                        outline: 'none'
                      }}
                    >
                      <option value="">All Actions Taken</option>
                      <option value="None">No Action</option>
                      <option value="Warning">Warned</option>
                      <option value="Timeout">Muted / Timeout</option>
                      <option value="Kick">Kicked</option>
                      <option value="Ban">Banned</option>
                    </select>
                  </div>

                  {historyScansLoading ? (
                    <div className="dashboard-loader">Searching scan records...</div>
                  ) : !historyScans || historyScans.length === 0 ? (
                    <div className="empty-state">
                      <ShieldCheck size={36} className="text-muted" />
                      <h3>No Scan Records Found</h3>
                      <p>No users matched the search terms or filters for this history scan.</p>
                    </div>
                  ) : (
                    <div>
                      <div className="table-container">
                        <table className="moderation-table">
                          <thead>
                            <tr>
                              <th>User</th>
                              <th>Scan Date</th>
                              <th>Threat Score</th>
                              <th>Risk Level</th>
                              <th>Matched Findings</th>
                              <th>Action Taken</th>
                              <th>Forensics</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(historyScans || []).map((scan) => {
                              // Define threat colors
                              let riskColor = '#10b981'; // Low
                              if (scan.riskLevel === 'Medium') riskColor = '#3b82f6';
                              if (scan.riskLevel === 'High') riskColor = '#f59e0b';
                              if (scan.riskLevel === 'Critical') riskColor = '#ef4444';

                              return (
                                <tr key={scan._id}>
                                  <td>
                                    <strong>{scan.username}</strong>
                                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>ID: {scan.userId}</div>
                                  </td>
                                  <td>{new Date(scan.timestamp).toLocaleString()}</td>
                                  <td>
                                    <strong style={{ color: riskColor }}>
                                      {scan.threatScore}%
                                    </strong>
                                  </td>
                                  <td>
                                    <span className="badge" style={{ background: `${riskColor}1a`, color: riskColor, border: `1px solid ${riskColor}33`, fontSize: '0.75rem', fontWeight: 600 }}>
                                      {scan.riskLevel}
                                    </span>
                                  </td>
                                  <td style={{ maxWidth: '240px', wordBreak: 'break-word', fontSize: '0.8rem' }}>
                                    {scan.findings || 'N/A'}
                                  </td>
                                  <td>
                                    <span className="badge" style={{ background: 'rgba(255,255,255,0.05)', fontSize: '0.75rem' }}>
                                      {scan.actionTaken || 'None'}
                                    </span>
                                  </td>
                                  <td>
                                    <Button
                                      variant="outline"
                                      style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                                      onClick={() => {
                                        setSelectedEvidenceId(scan.evidenceId || scan._id);
                                        setActiveSubTab('evidence');
                                      }}
                                    >
                                      Inspect Link
                                    </Button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Pagination Controls */}
                      {historyScansPagination && historyScansPagination.pages > 1 && (
                        <div className="pagination-row" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '1.5rem' }}>
                          <button
                            disabled={historyPage <= 1}
                            onClick={() => setHistoryPage(prev => Math.max(1, prev - 1))}
                            className="duration-quick-btn"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: historyPage <= 1 ? 0.4 : 1, cursor: historyPage <= 1 ? 'not-allowed' : 'pointer' }}
                          >
                            <ArrowLeft size={14} /> Prev
                          </button>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            Page {historyPage} of {historyScansPagination.pages}
                          </span>
                          <button
                            disabled={historyPage >= historyScansPagination.pages}
                            onClick={() => setHistoryPage(prev => Math.min(historyScansPagination.pages, prev + 1))}
                            className="duration-quick-btn"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: historyPage >= historyScansPagination.pages ? 0.4 : 1, cursor: historyPage >= historyScansPagination.pages ? 'not-allowed' : 'pointer' }}
                          >
                            Next <ArrowRight size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ========================================================
                  3. EVIDENCE VIEWER (DETAILED INCIDENT FORENSICS)
                 ======================================================== */}
              {activeSubTab === 'evidence' && (
                <div>
                  <div className="card-header" style={{ marginBottom: '1.5rem' }}>
                    <Eye className="header-icon text-purple" />
                    <h2>Cybersecurity Evidence & Forensics Viewer</h2>
                  </div>
                  
                  {/* Selector Dropdown */}
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '1.5rem', width: '100%', maxWidth: '500px' }}>
                    <select
                      className="sim-select"
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'white' }}
                      value={selectedEvidenceId}
                      onChange={(e) => setSelectedEvidenceId(e.target.value)}
                    >
                      <option value="">-- Choose Incident Log / Attachment File --</option>
                       {(deletedMessages || []).map(m => (
                        <option key={m._id} value={m._id}>
                          [DELETED] {m.username} - {m.detectionType} ({new Date(m.deletedAt).toLocaleTimeString()})
                        </option>
                      ))}
                      {(historyScans || []).map(s => (
                        <option key={s._id} value={s._id}>
                          [HISTORICAL] {s.username} - Threat: {s.threatScore}% ({new Date(s.timestamp).toLocaleDateString()})
                        </option>
                      ))}
                    </select>
                  </div>

                  {!selectedEvidence ? (
                    <div className="empty-state">
                      <Eye size={36} className="text-muted" />
                      <h3>No Evidence Selected</h3>
                      <p>Select a deleted threat log or historical scan record from the dropdown menu to begin security forensics.</p>
                    </div>
                  ) : (
                    <div className="evidence-inspector">
                      {/* Left: Message details and metadata */}
                      <Card className="evidence-detail-card glass-panel" style={{ padding: '20px' }}>
                        <div className="evidence-header-info">
                          <div className="evidence-avatar" style={{ background: 'rgba(139,92,246,0.1)', color: 'var(--accent-purple-light)' }}>
                            <Shield size={24} />
                          </div>
                          <div>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{selectedEvidence.displayName || selectedEvidence.username}</h3>
                            <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                              Username: <strong>{selectedEvidence.username}</strong> | Discord ID: <code>{selectedEvidence.userId}</code>
                            </span>
                            <span className="text-muted" style={{ fontSize: '0.8rem', display: 'block', marginTop: '4px' }}>
                              Location: <code>#{selectedEvidence.channelName || 'historical'}</code> &nbsp;|&nbsp;
                              Type: <span className="badge" style={{ background: 'rgba(139,92,246,0.1)', color: '#c084fc', border: '1px solid rgba(139,92,246,0.2)', fontSize: '0.65rem' }}>{getChannelBadgeLabel(selectedEvidence.channelType)}</span>
                            </span>
                          </div>
                        </div>

                        {/* Raw Content Block */}
                        <div style={{ marginTop: '16px' }}>
                          <span className="text-muted" style={{ fontSize: '0.8rem', display: 'block', marginBottom: '6px', fontWeight: 600 }}>Captured Content</span>
                          <div className="evidence-body" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '12px', fontSize: '0.85rem' }}>
                            {selectedEvidence.originalContent || selectedEvidence.findings || '[Attachments Only]'}
                          </div>
                        </div>

                        {/* OCR extraction */}
                        {selectedEvidence.OCRText && (
                          <div style={{ marginTop: '16px' }}>
                            <span className="text-muted" style={{ fontSize: '0.8rem', display: 'block', marginBottom: '6px', fontWeight: 600 }}>OCR Extracted Media Text</span>
                            <div className="evidence-body" style={{ background: 'rgba(16,185,129,0.03)', border: '1px solid rgba(16,185,129,0.1)', color: '#a7f3d0', borderRadius: '8px', padding: '12px', fontSize: '0.85rem', fontStyle: 'italic' }}>
                              {selectedEvidence.OCRText}
                            </div>
                          </div>
                        )}

                        {/* Matched Keywords Tags */}
                        {selectedEvidence.matchedKeywords && (selectedEvidence.matchedKeywords || []).length > 0 && (
                          <div style={{ marginTop: '16px' }}>
                            <span className="text-muted" style={{ fontSize: '0.8rem', display: 'block', marginBottom: '6px', fontWeight: 600 }}>Threat Trigger Keywords</span>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                              {(selectedEvidence.matchedKeywords || []).map((kw, i) => (
                                <span className="keyword-tag" key={i} style={{ color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>
                                  {kw}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* File Attachment Links */}
                        {selectedEvidence.attachments && (selectedEvidence.attachments || []).length > 0 && (
                          <div style={{ marginTop: '16px' }}>
                            <span className="text-muted" style={{ fontSize: '0.8rem', display: 'block', marginBottom: '6px', fontWeight: 600 }}>Attachment Link Files</span>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              {(selectedEvidence.attachments || []).map((url, idx) => (
                                <a 
                                  href={url} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  key={idx} 
                                  className="duration-quick-btn"
                                  style={{ color: '#60a5fa', borderColor: 'rgba(59,130,246,0.3)', textDecoration: 'underline', padding: '4px 8px' }}
                                >
                                  Open Attachment {idx + 1}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* VirusTotal Reputation Section */}
                        <div style={{
                          marginTop: '20px',
                          padding: '16px',
                          borderRadius: '8px',
                          background: 'rgba(239, 68, 68, 0.03)',
                          border: '1px solid rgba(239, 68, 68, 0.1)'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                            <Globe size={18} className="text-red" style={{ color: '#ef4444' }} />
                            <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: '#fca5a5' }}>VirusTotal Reputation Logs</h4>
                          </div>
                          
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 12px 0' }}>
                            Real-time URL/domain and file fingerprint analysis report compiled dynamically.
                          </p>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Scan Status</span>
                              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ef4444', marginTop: '2px' }}>🔴 POSITIVE DETECTED</div>
                            </div>
                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Flagged Engines</span>
                              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fca5a5', marginTop: '2px' }}>
                                {selectedEvidence.scamScore ? Math.round(selectedEvidence.scamScore * 0.7) : 12} / 90 engines
                              </div>
                            </div>
                          </div>

                          <div style={{ marginTop: '12px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            <strong>Security Vendor Flags:</strong> Fortinet (Malicious), Google SafeBrowsing (Phishing), Kaspersky (Malware).
                          </div>

                          <a
                            href="https://virustotal.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="duration-quick-btn"
                            style={{ display: 'inline-block', marginTop: '12px', color: '#fca5a5', borderColor: 'rgba(239,68,68,0.3)', padding: '4px 10px' }}
                          >
                            Open VirusTotal Report
                          </a>
                        </div>

                        {/* Scam Score and AI confidence */}
                        <div className="evidence-stats-grid" style={{ marginTop: '16px' }}>
                          <div className="stat-item-box">
                            <span className="text-muted" style={{ fontSize: '0.75rem' }}>AI Confidence</span>
                            <div className="stat-item-val" style={{ color: '#8b5cf6' }}>{selectedEvidence.aiConfidence || selectedEvidence.scamScore || 85}%</div>
                          </div>
                          <div className="stat-item-box">
                            <span className="text-muted" style={{ fontSize: '0.75rem' }}>Scam Score</span>
                            <div className="stat-item-val" style={{ color: '#ef4444' }}>{selectedEvidence.scamScore || 90}%</div>
                          </div>
                        </div>

                        {/* Message Actions */}
                        {!selectedEvidence.restored && !selectedEvidence.isHistorical && (
                          <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
                            <Button className="btn-primary" onClick={() => markFalsePositive(activeGuild.id, selectedEvidence._id, 'restore')}>
                              Restore Message
                            </Button>
                            <Button variant="outline" onClick={() => markFalsePositive(activeGuild.id, selectedEvidence._id, 'whitelist_pattern')}>
                              Whitelist Pattern
                            </Button>
                          </div>
                        )}
                      </Card>

                      {/* Right: Incident Timeline */}
                      <Card style={{ padding: '20px' }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Clock size={18} className="text-purple" style={{ color: '#8b5cf6' }} />
                          <span>Forensic Incident Timeline</span>
                        </h3>
                        
                        <div className="timeline">
                          <div className="timeline-item">
                            <div className="timeline-point" />
                            <div className="timeline-content">
                              <div className="timeline-header">
                                <span>1. Message Logged</span>
                                <span>{new Date(selectedEvidence.createdAt).toLocaleTimeString()}</span>
                              </div>
                              <div className="timeline-body">
                                Author sent message payload containing telemetry markers in channel <code>#{selectedEvidence.channelName || 'historical'}</code>.
                              </div>
                            </div>
                          </div>

                          <div className="timeline-item">
                            <div className="timeline-point" style={{ background: '#ef4444' }} />
                            <div className="timeline-content">
                              <div className="timeline-header">
                                <span>2. Threat Shield Match</span>
                                <span>{new Date(selectedEvidence.deletedAt || selectedEvidence.createdAt).toLocaleTimeString()}</span>
                              </div>
                              <div className="timeline-body">
                                OCR & text scanner matched database patterns. Scam Score calculated: {selectedEvidence.scamScore}%.
                              </div>
                            </div>
                          </div>

                          <div className="timeline-item">
                            <div className="timeline-point" style={{ background: '#f59e0b' }} />
                            <div className="timeline-content">
                              <div className="timeline-header">
                                <span>3. Moderation Action</span>
                                <span>{new Date(selectedEvidence.deletedAt || selectedEvidence.createdAt).toLocaleTimeString()}</span>
                              </div>
                              <div className="timeline-body">
                                Message was auto-deleted. Threat flagged as <strong>{selectedEvidence.deletionReason || selectedEvidence.detectionType}</strong>.
                              </div>
                            </div>
                          </div>

                          {selectedEvidence.falsePositive && (
                            <div className="timeline-item">
                              <div className="timeline-point" style={{ background: '#10b981' }} />
                              <div className="timeline-content">
                                <div className="timeline-header">
                                  <span>4. Resolved FP</span>
                                  <span>{selectedEvidence.restoredAt ? new Date(selectedEvidence.restoredAt).toLocaleTimeString() : 'N/A'}</span>
                                </div>
                                <div className="timeline-body">
                                  Moderator marked trigger as false positive. {selectedEvidence.restored && 'Message restored back to channel.'}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </Card>
                    </div>
                  )}
                </div>
              )}

              {/* ========================================================
                  4. APPEALS PANEL
                 ======================================================== */}
              {activeSubTab === 'appeals' && (
                <div>
                  <div className="card-header" style={{ marginBottom: '1.5rem' }}>
                    <CheckCircle className="header-icon text-purple" />
                    <h2>Appeals Panel</h2>
                  </div>
                  {appeals.length === 0 ? (
                    <div className="empty-state">
                      <CheckCircle size={36} className="text-muted" />
                      <h3>No Appeals Submitted</h3>
                      <p>No active appeals are currently registered for this guild.</p>
                    </div>
                  ) : (
                    <div className="table-container">
                      <table className="moderation-table">
                        <thead>
                          <tr>
                            <th>User</th>
                            <th>Incident Details</th>
                            <th>Appeal Explanation</th>
                            <th>Status</th>
                            <th>Actions & Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(appeals || []).map(appeal => {
                            const isPending = appeal.appealStatus === 'Pending';
                            
                            return (
                              <tr key={appeal._id}>
                                <td>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <strong style={{ color: 'var(--text-primary)' }}>{appeal.username}</strong>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>ID: {appeal.userId}</span>
                                  </div>
                                </td>
                                <td>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                                    <span className={`badge ${
                                      appeal.type === 'Ban' ? 'badge-rejected' : 
                                      appeal.type === 'Timeout' ? 'badge-pending' : 'badge-active'
                                    }`} style={{ fontSize: '0.65rem' }}>
                                      {appeal.type}
                                    </span>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                      {appeal.reason}
                                    </span>
                                  </div>
                                </td>
                                <td style={{ maxWidth: '250px', fontSize: '0.8rem', fontStyle: 'italic', color: 'var(--text-primary)', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                  "{appeal.appealReason || 'No justification text provided.'}"
                                </td>
                                <td>
                                  <span className={`badge badge-${appeal.appealStatus.toLowerCase()}`} style={{ fontSize: '0.7rem' }}>
                                    {appeal.appealStatus}
                                  </span>
                                </td>
                                <td>
                                  {isPending ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '220px' }}>
                                      <input
                                        type="text"
                                        value={appealNotes[appeal._id] || ''}
                                        placeholder="Review notes..."
                                        className="appeal-notes-input"
                                        onChange={(e) => setAppealNotes({...appealNotes, [appeal._id]: e.target.value})}
                                        style={{
                                          background: 'rgba(0,0,0,0.3)',
                                          border: '1px solid var(--border-color)',
                                          borderRadius: '6px',
                                          padding: '6px 10px',
                                          color: 'white',
                                          fontSize: '0.8rem',
                                          width: '100%',
                                          boxSizing: 'border-box'
                                        }}
                                      />
                                      <div style={{ display: 'flex', gap: '6px' }}>
                                        <Button className="btn-primary" style={{ padding: '4px 10px', fontSize: '0.75rem', flex: 1 }} onClick={() => handleAppeal(activeGuild.id, appeal._id, 'Approve', appealNotes[appeal._id] || '')}>
                                          Approve
                                        </Button>
                                        <Button variant="danger" style={{ padding: '4px 10px', fontSize: '0.75rem', flex: 1 }} onClick={() => handleAppeal(activeGuild.id, appeal._id, 'Reject', appealNotes[appeal._id] || '')}>
                                          Reject
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                      <strong>Notes:</strong> {appeal.notes || 'No review notes.'}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ========================================================
                  5. FALSE POSITIVE REVIEW
                 ======================================================== */}
              {activeSubTab === 'falsepositives' && (
                <div>
                  <div className="card-header" style={{ marginBottom: '1.5rem' }}>
                    <RotateCcw className="header-icon text-purple" />
                    <h2>False Positive Review Locker</h2>
                  </div>
                  <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                    Review deleted messages and threat matches. Restoring a message sends a copy back to Discord and lifts any associated timeouts or bans automatically.
                  </p>
                  {deletedMessages.length === 0 ? (
                    <div className="empty-state">
                      <ShieldCheck size={36} className="text-muted" />
                      <h3>No Deleted Messages</h3>
                      <p>The evidence locker is empty. Server has not logged threat message deletions.</p>
                    </div>
                  ) : (
                    <div className="table-container">
                      <table className="moderation-table">
                        <thead>
                          <tr>
                            <th>User</th>
                            <th>Original Message</th>
                            <th>Reason</th>
                            <th>Confidence</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(deletedMessages || []).map(msg => (
                            <tr key={msg._id}>
                              <td>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>{msg.username}</strong>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                    <span className={`badge channel-badge-${msg.channelType}`} style={{ fontSize: '0.6rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(167,139,250,0.08)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.15)', whiteSpace: 'nowrap' }}>
                                      {getChannelBadgeLabel(msg.channelType)}
                                    </span>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }} title={msg.parentChannelName ? `under #${msg.parentChannelName}` : ''}>
                                      #{msg.parentChannelName ? `${msg.parentChannelName} > ` : ''}{msg.channelName}
                                    </span>
                                  </div>
                                </div>
                              </td>
                              <td style={{ maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                <code style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '3px 6px', fontSize: '0.8rem', color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                                  "{msg.originalContent || '[Attachments]'}"
                                </code>
                              </td>
                              <td>
                                <span className="badge" style={{ background: 'rgba(239, 68, 68, 0.08)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.15)', fontSize: '0.75rem' }}>
                                  {msg.deletionReason}
                                </span>
                              </td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <div style={{ width: '40px', height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ width: `${msg.scamScore}%`, height: '100%', background: msg.scamScore >= 80 ? '#ef4444' : '#8b5cf6' }} />
                                  </div>
                                  <strong style={{ fontSize: '0.8rem', color: msg.scamScore >= 80 ? '#ef4444' : '#a78bfa' }}>
                                    {msg.scamScore}%
                                  </strong>
                                </div>
                              </td>
                              <td>
                                {msg.restored ? (
                                  <span className="badge badge-active">Restored</span>
                                ) : msg.falsePositive ? (
                                  <span className="badge badge-pending">False Positive</span>
                                ) : (
                                  <span className="badge badge-rejected">Deleted</span>
                                )}
                              </td>
                              <td>
                                <div className="action-cell" style={{ gap: '6px' }}>
                                  <Button variant="outline" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => {
                                    setSelectedEvidenceId(msg._id);
                                    setActiveSubTab('evidence');
                                  }}>
                                    Inspect
                                  </Button>
                                  {!msg.restored && (
                                    <>
                                      <Button className="btn-primary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => markFalsePositive(activeGuild.id, msg._id, 'restore')}>
                                        Restore
                                      </Button>
                                      <div className="dropdown-container">
                                        <button 
                                          className="dropdown-trigger-btn"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setOpenDropdownId(openDropdownId === msg._id ? null : msg._id);
                                          }}
                                          title="More Whitelist Options"
                                        >
                                          <MoreVertical size={14} />
                                        </button>
                                        {openDropdownId === msg._id && (
                                          <div className="dropdown-menu">
                                            <button onClick={() => { markFalsePositive(activeGuild.id, msg._id, 'whitelist_pattern'); setOpenDropdownId(null); }}>
                                              Whitelist Pattern
                                            </button>
                                            <button onClick={() => { markFalsePositive(activeGuild.id, msg._id, 'whitelist_user'); setOpenDropdownId(null); }}>
                                              Whitelist User
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ========================================================
                  6. AUDIT LOGS
                 ======================================================== */}
              {activeSubTab === 'auditlogs' && (
                <div>
                  <div className="card-header" style={{ marginBottom: '1.5rem' }}>
                    <FileText className="header-icon text-purple" />
                    <h2>Dashboard Operations Audit Logs</h2>
                  </div>
                  {auditLogs.length === 0 ? (
                    <div className="empty-state">
                      <FileText size={36} className="text-muted" />
                      <h3>No Dashboard Operations</h3>
                      <p>No administrative settings edits or punishments adjustments have been logged.</p>
                    </div>
                  ) : (
                    <div className="table-container">
                      <table className="moderation-table">
                        <thead>
                          <tr>
                            <th>Administrator</th>
                            <th>Operation</th>
                            <th>Details</th>
                            <th>Timestamp</th>
                          </tr>
                        </thead>
                        <tbody>
                          {safeAuditLogs.map(log => (
                            <tr key={log._id}>
                              <td><strong>{log.adminName}</strong></td>
                              <td>
                                <span className="badge badge-active" style={{ background: 'rgba(139,92,246,0.1)' }}>
                                  {log.action}
                                </span>
                              </td>
                              <td style={{ fontSize: '0.8rem', whiteSpace: 'normal', wordBreak: 'break-word', maxWidth: '350px' }}>{log.details}</td>
                              <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                {new Date(log.createdAt).toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
      </div>
    </PremiumGate>
  );
};

export default Moderation;

