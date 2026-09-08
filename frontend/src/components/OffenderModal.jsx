import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { X, AlertTriangle, Hammer, Activity } from 'lucide-react';
import { API_BASE_URL } from '../config';
import './OffenderModal.css';

const OffenderModal = ({ userId, guildId, onClose }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('violations');

  useEffect(() => {
    const fetchOffender = async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/users/${guildId}/${userId}`);
        setData(res.data);
      } catch (err) {
        console.error('Error fetching offender profile:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchOffender();
  }, [userId, guildId]);

  const getRiskColor = (score) => {
    if (score < 30) return 'text-success';
    if (score < 60) return 'text-warning';
    return 'text-danger';
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-content glass glow">
        <button className="modal-close" onClick={onClose}>
          <X size={20} />
        </button>

        {loading ? (
          <div className="modal-loading">Loading Offender Profile...</div>
        ) : !data ? (
          <div className="modal-error">Could not load offender profile data.</div>
        ) : (
          <>
            <div className="modal-header">
              <div className="profile-header-left">
                <div className="profile-avatar"></div>
                <div>
                  <h2 className="profile-username">{data.username}</h2>
                  <span className="profile-id">ID: {data.userId}</span>
                </div>
              </div>
              
              <div className="risk-score-display">
                <span className="risk-label">Risk Level</span>
                <span className={`risk-value ${getRiskColor(data.riskScore)}`}>
                  {data.riskScore}%
                </span>
              </div>
            </div>

            <div className="profile-stats-grid">
              <div className="stat-box">
                <Activity size={18} className="stat-box-icon text-info" />
                <span className="stat-box-val">{data.violationCount}</span>
                <span className="stat-box-lbl">Violations</span>
              </div>
              <div className="stat-box">
                <AlertTriangle size={18} className="stat-box-icon text-warning" />
                <span className="stat-box-val">{data.warningCount}</span>
                <span className="stat-box-lbl">Warnings</span>
              </div>
              <div className="stat-box">
                <Hammer size={18} className="stat-box-icon text-danger" />
                <span className="stat-box-val">{data.punishmentCount}</span>
                <span className="stat-box-lbl">Punishments</span>
              </div>
            </div>

            <div className="modal-tabs">
              <button 
                className={`tab-btn ${activeTab === 'violations' ? 'active' : ''}`}
                onClick={() => setActiveTab('violations')}
              >
                Violations
              </button>
              <button 
                className={`tab-btn ${activeTab === 'warnings' ? 'active' : ''}`}
                onClick={() => setActiveTab('warnings')}
              >
                Warnings
              </button>
              <button 
                className={`tab-btn ${activeTab === 'punishments' ? 'active' : ''}`}
                onClick={() => setActiveTab('punishments')}
              >
                Punishments
              </button>
            </div>

            <div className="tab-pane">
              {activeTab === 'violations' && (
                <div className="list-container">
                  {!(data?.history?.violations) || (data?.history?.violations || []).length === 0 ? (
                    <div className="empty-state">No violations recorded.</div>
                  ) : (
                    (data?.history?.violations || []).map((v) => (
                      <div key={v._id} className="history-item-row">
                        <div className="item-row-left">
                          <span className="item-row-title">{v.type}</span>
                          <span className="item-row-sub">{v.details}</span>
                        </div>
                        <span className="item-row-time">
                          {new Date(v.timestamp).toLocaleString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'warnings' && (
                <div className="list-container">
                  {!(data?.history?.warnings) || (data?.history?.warnings || []).length === 0 ? (
                    <div className="empty-state">No warnings recorded.</div>
                  ) : (
                    (data?.history?.warnings || []).map((w) => (
                      <div key={w._id} className="history-item-row">
                        <div className="item-row-left">
                          <span className="item-row-title">Warning issued</span>
                          <span className="item-row-sub">{w.reason || 'No reason provided'}</span>
                        </div>
                        <span className="item-row-time">
                          {new Date(w.createdAt).toLocaleString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'punishments' && (
                <div className="list-container">
                  {!(data?.history?.punishments) || (data?.history?.punishments || []).length === 0 ? (
                    <div className="empty-state">No punishments recorded.</div>
                  ) : (
                    (data?.history?.punishments || []).map((p) => (
                      <div key={p._id} className="history-item-row">
                        <div className="item-row-left">
                          <span className="item-row-title">{p.type} Action</span>
                          <span className="item-row-sub">{p.reason || 'No reason provided'}</span>
                        </div>
                        <span className="item-row-time">
                          {new Date(p.createdAt).toLocaleString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default OffenderModal;
