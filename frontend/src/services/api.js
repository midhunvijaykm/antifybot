import axios from 'axios';
import { API_BASE_URL } from '../config';

// Attach JWT authorization header to every request if available
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('antify_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

const handleResponse = (response) => {
  return response.data;
};

const handleError = (error) => {
  const message = error.response?.data?.error || error.message || 'API request failed';
  throw new Error(message);
};

export const apiService = {
  fetchUser: async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/user`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  logoutUser: async () => {
    try {
      try {
        const response = await axios.post(`${API_BASE_URL}/logout`);
        return handleResponse(response);
      } catch {
        const response = await axios.get(`${API_BASE_URL}/logout`);
        return handleResponse(response);
      }
    } catch (error) {
      return handleError(error);
    }
  },

  fetchGuilds: async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/guilds`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  fetchStats: async (guildId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/analytics/${guildId}`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  fetchLogs: async (guildId, page = 1, search = '', severity = '', type = '') => {
    try {
      const params = { page, search, severity, type };
      const response = await axios.get(`${API_BASE_URL}/logs/${guildId}`, { params });
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  fetchDeletedMessages: async (guildId, page = 1, search = '') => {
    try {
      const params = { guildId, page, search };
      const response = await axios.get(`${API_BASE_URL}/deleted-messages`, { params });
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  fetchSettings: async (guildId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/settings/${guildId}`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  updateSettings: async (guildId, updates) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/settings/${guildId}`, updates);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  addKeyword: async (guildId, keyword) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/settings/${guildId}/keywords`, { keyword });
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  removeKeyword: async (guildId, keyword) => {
    try {
      const response = await axios.delete(`${API_BASE_URL}/settings/${guildId}/keywords/${encodeURIComponent(keyword)}`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  fetchPremium: async (guildId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/premium/${guildId}`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  subscribeToPlan: async (guildId, plan, provider = 'Stripe') => {
    try {
      const response = await axios.post(`${API_BASE_URL}/premium/${guildId}/subscribe`, { plan, provider });
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  fetchUsage: async (guildId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/premium/${guildId}/usage`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  exportThreatReportUrl: (guildId) => {
    return `${API_BASE_URL}/premium/${guildId}/export`;
  },

  fetchOwnerGuilds: async (search = '') => {
    try {
      const response = await axios.get(`${API_BASE_URL}/owner/guilds?search=${encodeURIComponent(search)}`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  managePremiumLicense: async (guildId, action, duration = 'perm') => {
    try {
      const response = await axios.post(`${API_BASE_URL}/owner/premium`, { guildId, action, duration });
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  fetchScanStatus: async (guildId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/scan/status/${guildId}`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  triggerScan: async (guildId, depth = 100, channelId = null) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/scan/${guildId}`, { depth, channelId });
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  cancelScan: async (guildId) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/scan/${guildId}/cancel`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  resumeScan: async (guildId) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/scan/${guildId}/resume`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  fetchModerationData: async (guildId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/moderation/${guildId}`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  removeTimeout: async (guildId, userId, punishmentId) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/moderation/${guildId}/timeout/remove`, { userId, punishmentId });
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  editTimeoutDuration: async (guildId, userId, punishmentId, durationMinutes) => {
    try {
      const duration = durationMinutes * 60 * 1000;
      const response = await axios.post(`${API_BASE_URL}/moderation/${guildId}/timeout/edit`, { userId, punishmentId, duration });
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  unbanUser: async (guildId, userId, punishmentId) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/moderation/${guildId}/ban/remove`, { userId, punishmentId });
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  deleteWarning: async (guildId, warningId) => {
    try {
      const response = await axios.delete(`${API_BASE_URL}/moderation/${guildId}/warnings/${warningId}`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  revertAction: async (guildId, punishmentId) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/moderation/${guildId}/revert`, { punishmentId });
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  submitAppeal: async (guildId, punishmentId, appealReason) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/moderation/${guildId}/appeal`, { punishmentId, appealReason });
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  handleAppeal: async (guildId, punishmentId, action, notes) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/moderation/${guildId}/appeal/handle`, { punishmentId, action, notes });
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  fetchAuditLogs: async (guildId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/audit-logs/${guildId}`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  editPunishment: async (guildId, punishmentId, updates) => {
    try {
      const response = await axios.patch(`${API_BASE_URL}/punishments/edit`, { guildId, punishmentId, ...updates });
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  revokePunishment: async (guildId, punishmentId) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/punishments/revoke`, { guildId, punishmentId });
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  markFalsePositive: async (guildId, evidenceId, action) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/false-positive`, { guildId, evidenceId, action });
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  fetchNotifications: async (guildId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/notifications/${guildId}`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  markAllNotificationsRead: async (guildId) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/notifications/${guildId}/read-all`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  markNotificationRead: async (guildId, notificationId) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/notifications/${guildId}/${notificationId}/read`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  fetchDashboardStats: async (guildId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/dashboard-stats/${guildId}`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  fetchHistoryScans: async (guildId, page = 1, search = '', riskLevel = '', actionTaken = '') => {
    try {
      const params = { page, search, riskLevel, actionTaken };
      const response = await axios.get(`${API_BASE_URL}/history-scans/${guildId}`, { params });
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  },

  fetchServerManagement: async (guildId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/server-management/${guildId}`);
      return handleResponse(response);
    } catch (error) {
      return handleError(error);
    }
  }
};
