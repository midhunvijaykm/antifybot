import React, { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { Image, ShieldAlert, FileText, Zap, RefreshCw, Download } from 'lucide-react';
import { apiService } from '../services/api';
import './UsageLimits.css';

const UsageLimits = () => {
  const { activeGuild, usage, usageLoading, fetchUsage, addAlert } = useStore();
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (activeGuild?.id) {
      fetchUsage(activeGuild.id);
    }
  }, [activeGuild, fetchUsage]);

  useEffect(() => {
    if (!usage) return;

    const timer = setInterval(() => {
      const now = new Date();
      const nextReset = new Date();
      nextReset.setUTCHours(24, 0, 0, 0);
      
      const diffMs = nextReset.getTime() - now.getTime();
      if (diffMs <= 0) {
        if (activeGuild?.id) fetchUsage(activeGuild.id);
        setTimeLeft('Resets now');
        return;
      }
      
      const hours = String(Math.floor(diffMs / 3600000)).padStart(2, '0');
      const minutes = String(Math.floor((diffMs % 3600000) / 60000)).padStart(2, '0');
      const seconds = String(Math.floor((diffMs % 60000) / 1000)).padStart(2, '0');
      
      setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
    }, 1000);

    return () => clearInterval(timer);
  }, [usage, activeGuild, fetchUsage]);

  const handleExport = () => {
    if (!activeGuild) return;
    const url = apiService.exportThreatReportUrl(activeGuild.id);
    window.open(url, '_blank');
    addAlert('Generating threat report export...', 'info');
    setTimeout(() => {
      fetchUsage(activeGuild.id);
    }, 1500);
  };

  if (!activeGuild || !activeGuild.botActive) {
    return (
      <div className="usage-page-empty glass" style={{ margin: '20px' }}>
        <p>Please select an active server with the ANTIFY bot connected.</p>
      </div>
    );
  }

  const metrics = [
    {
      key: 'imageScans',
      label: 'Image Scam Detection',
      icon: Image,
      description: 'OCR Scanning of images to detect embedded phishing and scam text.',
      color: '#8b5cf6',
      bgGlow: 'rgba(139, 92, 246, 0.1)'
    },
    {
      key: 'historyScans',
      label: 'HistoryScans',
      icon: RefreshCw,
      description: 'Historical investigations of channel telemetry to clean past messages.',
      color: '#ec4899',
      bgGlow: 'rgba(236, 72, 153, 0.1)'
    },
    {
      key: 'virusTotalRequests',
      label: 'VirusTotal Lookups',
      icon: ShieldAlert,
      description: 'API reputation queries for links, downloads, and files.',
      color: '#3b82f6',
      bgGlow: 'rgba(59, 130, 246, 0.1)'
    },
    {
      key: 'threatReports',
      label: 'Threat Reports',
      icon: FileText,
      description: 'CSV report generations and exporting of threat telemetry logs.',
      color: '#10b981',
      bgGlow: 'rgba(16, 185, 129, 0.1)'
    }
  ];

  return (
    <div className="usage-page-container">
      <div className="usage-header-row">
        <div>
          <h1 className="usage-title text-gradient">Usage & Limits</h1>
          <p className="usage-subtitle">Track resource quotas and system capacities for {activeGuild.name}.</p>
        </div>
        <div className="reset-box glass">
          <span className="reset-label">Next Reset In:</span>
          <span className="reset-timer">{timeLeft || 'Loading...'}</span>
        </div>
      </div>

      {usageLoading && !usage ? (
        <div className="usage-loading">
          <div className="loader-spinner"></div>
          <span>Syncing quota metrics...</span>
        </div>
      ) : (
        <>
          <div className="usage-grid">
            {metrics.map((m) => {
              const data = usage?.[m.key] || { used: 0, limit: 0, remaining: 0 };
              const Icon = m.icon;
              
              const percent = typeof data.limit === 'number'
                ? Math.min(100, Math.round((data.used / data.limit) * 100))
                : 0;

              const isLimited = typeof data.limit === 'number';

              return (
                <div key={m.key} className="usage-card glass">
                  <div className="card-top">
                    <div className="card-icon-wrapper" style={{ background: m.bgGlow, border: `1px solid ${m.color}33` }}>
                      <Icon style={{ color: m.color }} size={22} />
                    </div>
                    <div className="card-meta">
                      <h3>{m.label}</h3>
                      <p>{m.description}</p>
                    </div>
                  </div>

                  <div className="progress-section">
                    <div className="progress-labels">
                      <span className="used-text">
                        <strong>{data.used}</strong> / {isLimited ? data.limit : '∞'} used
                      </span>
                      <span className="remaining-text">
                        {isLimited ? `${data.remaining} remaining` : 'Unlimited'}
                      </span>
                    </div>

                    <div className="progress-bar-track">
                      <div 
                        className="progress-bar-fill"
                        style={{ 
                          width: `${isLimited ? percent : 100}%`, 
                          background: `linear-gradient(90deg, ${m.color}, #a855f7)` 
                        }}
                      />
                    </div>
                  </div>

                  {m.key === 'threatReports' && (
                    <button 
                      className="card-action-btn glass"
                      onClick={handleExport}
                      disabled={data.remaining === 0 && isLimited}
                    >
                      <Download size={16} />
                      Export Threat Log CSV
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {usage?.isPremium ? (
            <div className="premium-status-box glass pro-glow">
              <Zap className="pro-icon" />
              <div>
                <h4>ANTIFY PRO Active</h4>
                <p>All gating features are completely unlocked, and resource quotas are unlimited.</p>
              </div>
            </div>
          ) : (
            <div className="premium-status-box glass free-glow">
              <Zap className="free-icon" />
              <div>
                <h4>Running on ANTIFY FREE</h4>
                <p>Unlock Threat Analytics, HistoryScan, Evidence Locker, Moderation Center, and unlimited daily scans.</p>
              </div>
              <button 
                className="upgrade-btn-inline"
                onClick={() => window.location.pathname = '/premium'}
              >
                Upgrade to Pro
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default UsageLimits;
