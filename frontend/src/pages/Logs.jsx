import { useState, useEffect } from 'react';
import { Search, Shield, AlertTriangle, XCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore } from '../store/useStore';
import Card from '../components/Card';
import OffenderModal from '../components/OffenderModal';
import PremiumGate from '../components/PremiumGate';
import './Logs.css';

const SeverityBadge = ({ severity }) => {
  const config = {
    low: { icon: Shield, color: 'text-blue', bg: 'bg-blue-light' },
    medium: { icon: AlertTriangle, color: 'text-yellow', bg: 'bg-yellow-light' },
    high: { icon: XCircle, color: 'text-red', bg: 'bg-red-light' },
    critical: { icon: XCircle, color: 'text-purple', bg: 'bg-purple-light' },
  };
  
  const displaySeverity = severity || 'low';
  const { icon: Icon, color, bg } = config[displaySeverity] || config.low;
  
  return (
    <div className={`severity-badge ${bg} ${color}`}>
      <Icon size={14} />
      <span>{displaySeverity.charAt(0).toUpperCase() + displaySeverity.slice(1)}</span>
    </div>
  );
};

const Logs = () => {
  const { activeGuild, logs, pagination, logsLoading, fetchLogs, token, premium, user } = useStore();
  const [searchValue, setSearchValue] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterType, setFilterType] = useState('');
  const [selectedOffender, setSelectedOffender] = useState(null);

  // Trigger fetch when parameters or guild changes
  useEffect(() => {
    if (activeGuild?.botActive) {
      fetchLogs(activeGuild.id, 1, '', filterSeverity, filterType);
    }
  }, [activeGuild?.id, activeGuild?.botActive, filterSeverity, filterType, fetchLogs]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (activeGuild?.botActive) {
      fetchLogs(activeGuild.id, 1, searchValue, filterSeverity, filterType);
    }
  };

  const handlePageChange = (newPage) => {
    if (activeGuild?.botActive && newPage >= 1 && newPage <= pagination.pages) {
      fetchLogs(activeGuild.id, newPage, searchValue, filterSeverity, filterType);
    }
  };

  const handleRowClick = (userId) => {
    setSelectedOffender(userId);
  };

  if (!activeGuild) {
    return (
      <div className="empty-dashboard-state">
        <h2>No Guild Selected</h2>
        <p>Please select a Discord server to review its moderation logs.</p>
      </div>
    );
  }

  if (!activeGuild.botActive) {
    return (
      <div className="empty-dashboard-state">
        <h2>ANTIFY Bot Not Active</h2>
        <p>Invite the bot to this server to unlock threat logs audit.</p>
      </div>
    );
  }

  const isOwner = user && user.id === '1060801714187415552';
  const isLocked = !isOwner && premium?.plan !== 'Pro';

  return (
    <PremiumGate
      locked={isLocked}
      featureName="Evidence Locker & Logs"
      description="Review deleted messages archives, moderation actions history, and logs database."
      benefits={[
        "Access warning and moderation logs database",
        "Review deleted message attachments and embeddings",
        "Investigate user offender profile history",
        "Export and query detailed log records"
      ]}
      freeLimit="Locked on Free Servers"
    >
      <div className="logs-page">
      <header className="page-header">
        <h1 className="page-title">Moderation Logs</h1>
        <p className="page-subtitle">Track and audit real-time threat actions for <strong>{activeGuild.name}</strong>.</p>
      </header>
      
      <Card className="logs-container">
        <div className="logs-toolbar">
          <form className="search-box" onSubmit={handleSearchSubmit}>
            <Search size={18} className="search-icon" />
            <input 
              type="text" 
              placeholder="Search by user, ID, details... (Press Enter)" 
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
            />
          </form>

          <div className="toolbar-actions">
            <select 
              value={filterSeverity} 
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="toolbar-select glass"
            >
              <option value="">All Severities</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>

            <select 
              value={filterType} 
              onChange={(e) => setFilterType(e.target.value)}
              className="toolbar-select glass"
            >
              <option value="">All Types</option>
              <option value="Phishing Link">Phishing Links</option>
              <option value="Spam Words">Spam Words</option>
              <option value="Scam Image">Scam Images</option>
            </select>
          </div>
        </div>

        {logsLoading ? (
          <div className="logs-loading-state">Querying active threat database...</div>
        ) : (logs || []).length === 0 ? (
          <div className="logs-empty-state">No audit logs found matching criteria.</div>
        ) : (
          <div className="table-responsive">
            <table className="logs-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Violation Type</th>
                  <th>Severity</th>
                  <th>Action Taken</th>
                  <th>Details</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {(logs || []).map((log) => (
                  <tr 
                    key={log._id} 
                    className="log-row clickable"
                    onClick={() => handleRowClick(log.userId)}
                  >
                    <td className="user-cell">
                      <div className="avatar-sm"></div>
                      <div>
                        <span className="user-name">{log.username}</span>
                        <span className="user-subtext-id">{log.userId}</span>
                      </div>
                    </td>
                    <td>{log.type}</td>
                    <td><SeverityBadge severity={log.severity} /></td>
                    <td>
                      <span className={`action-badge ${log.actionTaken.toLowerCase()}`}>
                        {log.actionTaken}
                      </span>
                    </td>
                    <td className="details-cell">{log.details}</td>
                    <td className="time-cell">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {pagination.pages > 1 && (
          <div className="logs-pagination">
            <span className="pagination-info">
              Showing page {pagination.page} of {pagination.pages} ({pagination.total} total logs)
            </span>
            <div className="pagination-buttons">
              <button 
                className="pagination-btn glass"
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page === 1}
              >
                <ChevronLeft size={16} />
              </button>
              <button 
                className="pagination-btn glass"
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page === pagination.pages}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Offender Modal Portal */}
      {selectedOffender && (
        <OffenderModal 
          userId={selectedOffender}
          guildId={activeGuild.id}
          token={token}
          onClose={() => setSelectedOffender(null)}
        />
      )}
      </div>
    </PremiumGate>
  );
};

export default Logs;
