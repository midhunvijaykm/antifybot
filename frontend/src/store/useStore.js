import { create } from 'zustand';
import io from 'socket.io-client';
import { apiService } from '../services/api';
import { BACKEND_URL } from '../config';

let socketConnection = null;

export const useStore = create((set, get) => ({
  // Authentication State
  user: null,
  isAuthenticated: false,
  authLoading: true,

  // Guilds State
  guilds: [],
  activeGuild: null,
  guildsLoading: false,

  // Dashboard Stats
  stats: {
    totals: {
      detections: 0,
      punishments: 0,
      bans: 0,
      warnings: 0,
      protectedUsers: 0
    },
    detectionTrends: [],
    weeklyTrends: [],
    ocrTrends: []
  },
  statsLoading: false,

  // Logs State
  logs: [],
  pagination: {
    total: 0,
    page: 1,
    limit: 10,
    pages: 1
  },
  logsLoading: false,

  // Deleted Messages State
  deletedMessages: [],
  deletedMessagesPagination: {
    total: 0,
    page: 1,
    limit: 10,
    pages: 1
  },
  deletedMessagesLoading: false,

  // Settings State
  settings: null,
  settingsLoading: false,
  savingSettings: false,

  // Premium State
  premium: null,
  premiumLoading: false,
  usage: null,
  usageLoading: false,
  ownerGuilds: [],
  ownerGuildsLoading: false,

  // Historical Scan State
  scanProgress: { active: false, totalChannels: 0, processedChannels: 0, messagesScanned: 0, detectionsFound: 0, currentChannelName: '', status: 'inactive' },
  scanLoading: false,

  // Moderation Control Center State
  moderationData: { punishments: [], warnings: [] },
  moderationLoading: false,
  auditLogs: [],
  moderatorFeed: [],

  // Notifications/Alerts
  alerts: [], // Toasts queue
  socketConnected: false,

  // SOC Notifications
  notifications: [],
  notificationsLoading: false,

  // SOC History Scans
  historyScans: [],
  historyScansPagination: {
    total: 0,
    page: 1,
    limit: 10,
    pages: 1
  },
  historyScansLoading: false,

  // SOC Server Management
  serverManagement: null,
  serverManagementLoading: false,

  // SOC Dashboard Stats
  dashboardStats: null,
  dashboardStatsLoading: false,

  // ==============================
  // ACTIONS - AUTHENTICATION
  // ==============================
  fetchUser: async () => {
    try {
      const data = await apiService.fetchUser();
      set({ 
        user: data.user, 
        isAuthenticated: true, 
        authLoading: false 
      });
      get().fetchGuilds();
    } catch {
      console.log('Session check failed (User not logged in or backend offline).');
      if (socketConnection) {
        socketConnection.disconnect();
        socketConnection = null;
      }
      set({ user: null, isAuthenticated: false, authLoading: false, guilds: [], activeGuild: null, socketConnected: false });
    }
  },

  logoutUser: async () => {
    try {
      await apiService.logoutUser();
    } catch (err) {
      console.error('Logout error:', err.message);
    }
    if (socketConnection) {
      socketConnection.disconnect();
      socketConnection = null;
    }
    localStorage.removeItem('antify_last_guild_id');
    set({ user: null, isAuthenticated: false, guilds: [], activeGuild: null, socketConnected: false });
  },

  // ==============================
  // ACTIONS - GUILDS
  // ==============================
  fetchGuilds: async () => {
    set({ guildsLoading: true });
    try {
      const guilds = await apiService.fetchGuilds();
      const safeGuilds = Array.isArray(guilds) ? guilds : [];
      set({ guilds: safeGuilds, guildsLoading: false });
      
      // Determine guild to auto-select (persisted or bot-active or first item)
      if (safeGuilds.length > 0) {
        const lastGuildId = localStorage.getItem('antify_last_guild_id');
        const persistedGuild = safeGuilds.find(g => g.id === lastGuildId);
        const botActiveGuild = safeGuilds.find(g => g.botActive);
        
        const targetGuild = persistedGuild || botActiveGuild || safeGuilds[0];
        get().setActiveGuild(targetGuild);
      }
    } catch (error) {
      console.error('Fetch guilds failed:', error.message);
      set({ guildsLoading: false });
    }
  },

  setActiveGuild: (guild) => {
    const oldGuild = get().activeGuild;
    set({ activeGuild: guild });

    if (guild) {
      localStorage.setItem('antify_last_guild_id', guild.id);
      
      if (guild.botActive) {
        get().initSocket(guild.id, oldGuild?.id);
        get().fetchStats(guild.id);
        get().fetchDashboardStats(guild.id);
        get().fetchNotifications(guild.id);
        get().fetchSettings(guild.id);
        get().fetchLogs(guild.id);
        get().fetchPremium(guild.id);
        get().fetchUsage(guild.id);
        get().fetchScanStatus(guild.id);
        get().fetchDeletedMessages(guild.id);
        get().fetchModerationData(guild.id);
        get().fetchAuditLogs(guild.id);
        get().fetchServerManagement(guild.id);
      } else {
        if (socketConnection && oldGuild) {
          socketConnection.emit('leave_guild', oldGuild.id);
        }
        set({
          stats: {
            totals: { detections: 0, punishments: 0, bans: 0, warnings: 0, protectedUsers: 0 },
            detectionTrends: [],
            weeklyTrends: [],
            ocrTrends: []
          },
          logs: [],
          settings: null,
          premium: null,
          usage: null,
          moderationData: { punishments: [], warnings: [] },
          auditLogs: [],
          moderatorFeed: [],
          notifications: [],
          historyScans: [],
          serverManagement: null,
          dashboardStats: null
        });
      }
    }
  },

  // ==============================
  // ACTIONS - STATS & ANALYTICS
  // ==============================
  fetchStats: async (guildId) => {
    if (!guildId) return;
    set({ statsLoading: true });
    try {
      const data = await apiService.fetchStats(guildId);
      set({ stats: data, statsLoading: false });
    } catch (error) {
      console.error('Fetch stats failed:', error.message);
      set({ statsLoading: false });
    }
  },

  // ==============================
  // ACTIONS - MODERATION LOGS
  // ==============================
  fetchLogs: async (guildId, page = 1, search = '', severity = '', type = '') => {
    if (!guildId) return;
    set({ logsLoading: true });
    try {
      const data = await apiService.fetchLogs(guildId, page, search, severity, type);
      set({ 
        logs: data?.logs || [], 
        pagination: data?.pagination || { total: 0, page: 1, limit: 10, pages: 1 }, 
        logsLoading: false 
      });
    } catch (error) {
      console.error('Fetch logs failed:', error.message);
      set({ logsLoading: false });
    }
  },

  fetchDeletedMessages: async (guildId, page = 1, search = '') => {
    if (!guildId) return;
    set({ deletedMessagesLoading: true });
    try {
      const data = await apiService.fetchDeletedMessages(guildId, page, search);
      set({
        deletedMessages: data?.messages || [],
        deletedMessagesPagination: data?.pagination || { total: 0, page: 1, limit: 10, pages: 1 },
        deletedMessagesLoading: false
      });
    } catch (error) {
      console.error('Fetch deleted messages failed:', error.message);
      set({ deletedMessagesLoading: false });
    }
  },

  // ==============================
  // ACTIONS - SETTINGS
  // ==============================
  fetchSettings: async (guildId) => {
    if (!guildId) return;
    set({ settingsLoading: true });
    try {
      const data = await apiService.fetchSettings(guildId);
      set({ settings: data, settingsLoading: false });
    } catch (error) {
      console.error('Fetch settings failed:', error.message);
      set({ settingsLoading: false });
    }
  },

  updateSettings: async (updates) => {
    const { activeGuild } = get();
    if (!activeGuild) return;

    set({ savingSettings: true });
    try {
      const data = await apiService.updateSettings(activeGuild.id, updates);
      set({ 
        settings: data.settings, 
        savingSettings: false 
      });
      get().addAlert('Settings saved successfully', 'success');
    } catch (error) {
      console.error('Save settings failed:', error.message);
      set({ savingSettings: false });
      get().addAlert(error.message || 'Failed to save settings', 'error');
    }
  },

  addKeyword: async (keyword) => {
    const { activeGuild } = get();
    if (!activeGuild || !keyword) return;

    try {
      const data = await apiService.addKeyword(activeGuild.id, keyword);
      set(state => ({
        settings: { ...state.settings, blacklistKeywords: data.keywords }
      }));
      get().addAlert(`Added "${keyword}" to blacklist`, 'success');
    } catch (error) {
      console.error('Add keyword failed:', error.message);
      get().addAlert(error.message || 'Failed to add keyword', 'error');
    }
  },

  removeKeyword: async (keyword) => {
    const { activeGuild } = get();
    if (!activeGuild || !keyword) return;

    try {
      const data = await apiService.removeKeyword(activeGuild.id, keyword);
      set(state => ({
        settings: { ...state.settings, blacklistKeywords: data.keywords }
      }));
      get().addAlert(`Removed "${keyword}" from blacklist`, 'success');
    } catch (error) {
      console.error('Remove keyword failed:', error.message);
      get().addAlert('Failed to remove keyword', 'error');
    }
  },

  // ==============================
  // ACTIONS - PREMIUM
  // ==============================
  fetchPremium: async (guildId) => {
    if (!guildId) return;
    set({ premiumLoading: true });
    try {
      const data = await apiService.fetchPremium(guildId);
      set({ premium: data, premiumLoading: false });
    } catch (error) {
      console.error('Fetch premium failed:', error.message);
      set({ premiumLoading: false });
    }
  },

  subscribeToPlan: async (plan, provider = 'Stripe') => {
    const { activeGuild } = get();
    if (!activeGuild) return;

    try {
      const data = await apiService.subscribeToPlan(activeGuild.id, plan, provider);
      get().fetchPremium(activeGuild.id);
      get().fetchUsage(activeGuild.id);
      get().addAlert(`Upgraded server to Pro successfully!`, 'success');
      return data.checkoutUrl;
    } catch (error) {
      console.error('Upgrade subscription failed:', error.message);
      get().addAlert('Failed to upgrade subscription', 'error');
    }
  },

  fetchUsage: async (guildId) => {
    if (!guildId) return;
    set({ usageLoading: true });
    try {
      const data = await apiService.fetchUsage(guildId);
      set({ usage: data, usageLoading: false });
    } catch (error) {
      console.error('Fetch usage failed:', error.message);
      set({ usageLoading: false });
    }
  },

  fetchOwnerGuilds: async (search = '') => {
    set({ ownerGuildsLoading: true });
    try {
      const data = await apiService.fetchOwnerGuilds(search);
      set({ ownerGuilds: data || [], ownerGuildsLoading: false });
    } catch (error) {
      console.error('Fetch owner guilds failed:', error.message);
      set({ ownerGuildsLoading: false });
    }
  },

  managePremiumLicense: async (guildId, action, duration = 'perm') => {
    try {
      const data = await apiService.managePremiumLicense(guildId, action, duration);
      get().addAlert(data.message || 'Premium status updated successfully', 'success');
      get().fetchOwnerGuilds();
      const { activeGuild } = get();
      if (activeGuild && activeGuild.id === guildId) {
        get().fetchPremium(guildId);
        get().fetchUsage(guildId);
      }
      return data;
    } catch (error) {
      console.error('Manage premium failed:', error.message);
      get().addAlert('Failed to update premium status', 'error');
    }
  },

  // ==============================
  // ACTIONS - HISTORICAL SCANNING
  // ==============================
  fetchScanStatus: async (guildId) => {
    if (!guildId || !/^\d{17,20}$/.test(guildId)) return;
    try {
      const data = await apiService.fetchScanStatus(guildId);
      if (data.active) {
        set({ scanProgress: data });
      } else {
        set({ scanProgress: { active: false, totalChannels: 0, processedChannels: 0, messagesScanned: 0, detectionsFound: 0, currentChannelName: '', status: 'inactive' } });
      }
    } catch (error) {
      console.error('Fetch scan status failed:', error.message);
    }
  },

  triggerScan: async (guildId, depth = 100, channelId = null) => {
    if (!guildId) return;
    set({ scanLoading: true });
    try {
      const data = await apiService.triggerScan(guildId, depth, channelId);
      set({ scanProgress: data.scanState, scanLoading: false });
      get().addAlert('Historical scan initiated successfully', 'success');
    } catch (error) {
      console.error('Trigger scan failed:', error.message);
      set({ scanLoading: false });
      get().addAlert(error.message || 'Failed to start historical scan', 'error');
    }
  },

  cancelHistoricalScan: async (guildId) => {
    if (!guildId) return;
    set({ scanLoading: true });
    try {
      await apiService.cancelScan(guildId);
      set({
        scanProgress: {
          ...get().scanProgress,
          active: false,
          status: 'cancelled'
        },
        scanLoading: false
      });
      get().addAlert('Historical scan cancelled successfully', 'info');
    } catch (error) {
      console.error('Cancel scan failed:', error.message);
      set({ scanLoading: false });
      get().addAlert(error.message || 'Failed to cancel historical scan', 'error');
    }
  },

  resumeHistoricalScan: async (guildId) => {
    if (!guildId) return;
    set({ scanLoading: true });
    try {
      const data = await apiService.resumeScan(guildId);
      set({ scanProgress: data.scanState, scanLoading: false });
      get().addAlert('Historical scan resumed successfully', 'success');
    } catch (error) {
      console.error('Resume scan failed:', error.message);
      set({ scanLoading: false });
      get().addAlert(error.message || 'Failed to resume historical scan', 'error');
    }
  },

  // ==============================
  // ACTIONS - MODERATION CONTROL CENTER
  // ==============================
  fetchModerationData: async (guildId) => {
    if (!guildId) return;
    set({ moderationLoading: true });
    try {
      const data = await apiService.fetchModerationData(guildId);
      set({ 
        moderationData: {
          punishments: data?.punishments || [],
          warnings: data?.warnings || []
        }, 
        moderationLoading: false 
      });
    } catch (error) {
      console.error('Fetch moderation data failed:', error.message);
      set({ moderationLoading: false });
    }
  },

  removeTimeout: async (guildId, userId, punishmentId) => {
    try {
      const data = await apiService.removeTimeout(guildId, userId, punishmentId);
      if (data.success) {
        get().addAlert('Timeout removed successfully', 'success');
        get().fetchModerationData(guildId);
      }
    } catch (error) {
      console.error('Remove timeout failed:', error.message);
      get().addAlert(error.message || 'Failed to remove timeout', 'error');
    }
  },

  editTimeoutDuration: async (guildId, userId, punishmentId, durationMinutes) => {
    try {
      const data = await apiService.editTimeoutDuration(guildId, userId, punishmentId, durationMinutes);
      if (data.success) {
        get().addAlert(`Timeout duration edited to ${durationMinutes}m`, 'success');
        get().fetchModerationData(guildId);
      }
    } catch (error) {
      console.error('Edit timeout duration failed:', error.message);
      get().addAlert(error.message || 'Failed to edit timeout duration', 'error');
    }
  },

  unbanUser: async (guildId, userId, punishmentId) => {
    try {
      const data = await apiService.unbanUser(guildId, userId, punishmentId);
      if (data.success) {
        get().addAlert('User unbanned successfully', 'success');
        get().fetchModerationData(guildId);
      }
    } catch (error) {
      console.error('Unban user failed:', error.message);
      get().addAlert(error.message || 'Failed to unban user', 'error');
    }
  },

  deleteWarning: async (guildId, warningId) => {
    try {
      const data = await apiService.deleteWarning(guildId, warningId);
      if (data.success) {
        get().addAlert('Warning deleted successfully', 'success');
        get().fetchModerationData(guildId);
      }
    } catch (error) {
      console.error('Delete warning failed:', error.message);
      get().addAlert(error.message || 'Failed to delete warning', 'error');
    }
  },

  revertAction: async (guildId, punishmentId) => {
    try {
      const data = await apiService.revertAction(guildId, punishmentId);
      if (data.success) {
        get().addAlert('Moderation action reverted successfully', 'success');
        get().fetchModerationData(guildId);
      }
    } catch (error) {
      console.error('Revert action failed:', error.message);
      get().addAlert(error.message || 'Failed to revert action', 'error');
    }
  },

  submitAppeal: async (guildId, punishmentId, appealReason) => {
    try {
      const data = await apiService.submitAppeal(guildId, punishmentId, appealReason);
      if (data.success) {
        get().addAlert('Appeal submitted successfully', 'success');
        get().fetchModerationData(guildId);
      }
    } catch (error) {
      console.error('Submit appeal failed:', error.message);
      get().addAlert(error.message || 'Failed to submit appeal', 'error');
    }
  },

  handleAppeal: async (guildId, punishmentId, action, notes) => {
    try {
      const data = await apiService.handleAppeal(guildId, punishmentId, action, notes);
      if (data.success) {
        get().addAlert(`Appeal ${action === 'Approve' ? 'approved' : 'rejected'} successfully`, 'success');
        get().fetchModerationData(guildId);
      }
    } catch (error) {
      console.error('Handle appeal failed:', error.message);
      get().addAlert(error.message || 'Failed to process appeal', 'error');
    }
  },

  fetchAuditLogs: async (guildId) => {
    if (!guildId) return;
    try {
      const data = await apiService.fetchAuditLogs(guildId);
      set({ auditLogs: Array.isArray(data) ? data : [] });
    } catch (error) {
      console.error('Fetch audit logs failed:', error.message);
      set({ auditLogs: [] });
    }
  },

  editPunishment: async (guildId, punishmentId, updates) => {
    try {
      const data = await apiService.editPunishment(guildId, punishmentId, updates);
      if (data.success) {
        get().addAlert('Punishment updated successfully', 'success');
        get().fetchModerationData(guildId);
        get().fetchAuditLogs(guildId);
      }
    } catch (error) {
      console.error('Edit punishment failed:', error.message);
      get().addAlert(error.message || 'Failed to edit punishment', 'error');
    }
  },

  revokePunishment: async (guildId, punishmentId) => {
    try {
      const data = await apiService.revokePunishment(guildId, punishmentId);
      if (data.success) {
        get().addAlert('Punishment revoked successfully', 'success');
        get().fetchModerationData(guildId);
        get().fetchAuditLogs(guildId);
      }
    } catch (error) {
      console.error('Revoke punishment failed:', error.message);
      get().addAlert(error.message || 'Failed to revoke punishment', 'error');
    }
  },

  markFalsePositive: async (guildId, evidenceId, action) => {
    try {
      const data = await apiService.markFalsePositive(guildId, evidenceId, action);
      if (data.success) {
        get().addAlert(`False positive action applied: ${action}`, 'success');
        get().fetchModerationData(guildId);
        get().fetchDeletedMessages(guildId);
        get().fetchSettings(guildId);
        get().fetchAuditLogs(guildId);
      }
    } catch (error) {
      console.error('False positive action failed:', error.message);
      get().addAlert(error.message || 'Failed to apply false positive action', 'error');
    }
  },

  // ==============================
  // ACTIONS - TOAST NOTIFICATIONS
  // ==============================
  addAlert: (message, type = 'info') => {
    const id = Date.now();
    set(state => ({
      alerts: [...state.alerts, { id, message, type }]
    }));
    setTimeout(() => {
      set(state => ({
        alerts: state.alerts.filter(a => a.id !== id)
      }));
    }, 4000);
  },

  removeAlert: (id) => {
    set(state => ({
      alerts: state.alerts.filter(a => a.id !== id)
    }));
  },

  // ==============================
  // ACTIONS - SOC NOTIFICATIONS
  // ==============================
  fetchNotifications: async (guildId) => {
    if (!guildId) return;
    set({ notificationsLoading: true });
    try {
      const notifications = await apiService.fetchNotifications(guildId);
      set({ 
        notifications: Array.isArray(notifications) ? notifications : [], 
        notificationsLoading: false 
      });
    } catch (error) {
      console.error('Fetch notifications failed:', error.message);
      set({ notifications: [], notificationsLoading: false });
    }
  },

  markAllNotificationsRead: async (guildId) => {
    if (!guildId) return;
    try {
      const data = await apiService.markAllNotificationsRead(guildId);
      if (data && data.success && Array.isArray(data.notifications)) {
        set({ notifications: data.notifications });
      }
    } catch (error) {
      console.error('Mark all notifications read failed:', error.message);
    }
  },

  markNotificationRead: async (guildId, notificationId) => {
    if (!guildId || !notificationId) return;
    try {
      const data = await apiService.markNotificationRead(guildId, notificationId);
      if (data && data.success) {
        set(state => ({
          notifications: (Array.isArray(state.notifications) ? state.notifications : []).map(n => 
            n._id === notificationId ? { ...n, read: true } : n
          )
        }));
      }
    } catch (error) {
      console.error('Mark notification read failed:', error.message);
    }
  },

  // ==============================
  // ACTIONS - SOC DASHBOARD STATS
  // ==============================
  fetchDashboardStats: async (guildId) => {
    if (!guildId) return;
    set({ dashboardStatsLoading: true });
    try {
      const data = await apiService.fetchDashboardStats(guildId);
      set({ dashboardStats: data, dashboardStatsLoading: false });
    } catch (error) {
      console.error('Fetch dashboard stats failed:', error.message);
      set({ dashboardStatsLoading: false });
    }
  },

  // ==============================
  // ACTIONS - SOC HISTORY SCANS
  // ==============================
  fetchHistoryScans: async (guildId, page = 1, search = '', riskLevel = '', actionTaken = '') => {
    if (!guildId) return;
    set({ historyScansLoading: true });
    try {
      const data = await apiService.fetchHistoryScans(guildId, page, search, riskLevel, actionTaken);
      set({
        historyScans: data?.findings || [],
        historyScansPagination: data?.pagination || { total: 0, page: 1, limit: 10, pages: 1 },
        historyScansLoading: false
      });
    } catch (error) {
      console.error('Fetch history scans failed:', error.message);
      set({ historyScansLoading: false });
    }
  },

  // ==============================
  // ACTIONS - SOC SERVER MANAGEMENT
  // ==============================
  fetchServerManagement: async (guildId) => {
    if (!guildId) return;
    set({ serverManagementLoading: true });
    try {
      const data = await apiService.fetchServerManagement(guildId);
      set({ serverManagement: data, serverManagementLoading: false });
    } catch (error) {
      console.error('Fetch server management failed:', error.message);
      set({ serverManagementLoading: false });
    }
  },

  // ==============================
  // ACTIONS - SOCKET CONNECTION
  // ==============================
  initSocket: (newGuildId, oldGuildId) => {
    if (!socketConnection) {
      socketConnection = io(BACKEND_URL);
      
      socketConnection.on('connect', () => {
        set({ socketConnected: true });
        if (newGuildId) {
          socketConnection.emit('join_guild', newGuildId);
        }
      });

      socketConnection.on('disconnect', () => {
        set({ socketConnected: false });
      });

      // Handle real-time logs
      socketConnection.on('log_new', (log) => {
        set(state => {
          const currentList = state.logs || [];
          if (currentList.some(l => l._id === log._id)) {
            return {};
          }
          return {
            logs: [log, ...currentList].slice(0, 50)
          };
        });

        let toastType = 'info';
        if (log.severity === 'high') toastType = 'warning';
        if (log.severity === 'critical') toastType = 'error';

        get().addAlert(`[${log.type.toUpperCase()}] threat from ${log.username} handled (${log.actionTaken})`, toastType);
      });

      // Handle real-time deleted messages
      socketConnection.on('deleted_message_new', (msg) => {
        set(state => {
          const currentList = state.deletedMessages || [];
          if (currentList.some(m => m._id === msg._id || m.messageId === msg.messageId)) {
            return {};
          }
          return {
            deletedMessages: [msg, ...currentList].slice(0, 50)
          };
        });
        get().addAlert(`🗑️ Threat message from ${msg.username} was archived and deleted.`, 'warning');
      });

      // Handle real-time stats updates
      socketConnection.on('stats_update', (data) => {
        set(state => ({
          stats: {
            ...state.stats,
            totals: {
              ...state.stats.totals,
              ...data.totals
            }
          },
          dashboardStats: {
            ...state.dashboardStats,
            ...data.totals
          }
        }));
      });

      // Handle real-time notifications
      socketConnection.on('notification_new', (notification) => {
        set(state => {
          const currentList = Array.isArray(state.notifications) ? state.notifications : [];
          if (currentList.some(n => n._id === notification._id)) {
            return {};
          }

          // Trigger browser notification sound
          try {
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-500.wav');
            audio.volume = 0.4;
            audio.play().catch(() => {});
          } catch {
            // Audio playback not allowed or failed
          }

          // Add alert toast
          let toastType = 'info';
          if (notification.severity === 'high') toastType = 'warning';
          if (notification.severity === 'critical') toastType = 'error';
          get().addAlert(`🚨 [SOC] ${notification.title}: ${notification.message}`, toastType);

          return {
            notifications: [notification, ...currentList].slice(0, 50)
          };
        });
      });

      socketConnection.on('notifications_read_all', () => {
        set(state => ({
          notifications: (Array.isArray(state.notifications) ? state.notifications : []).map(n => ({ ...n, read: true }))
        }));
      });

      // Handle historical scanning progress
      socketConnection.on('scan_progress', (data) => {
        const isActive = data.status === 'scanning';
        set({ scanProgress: { active: isActive, ...data } });
      });

      // Handle moderation/appeals live updates
      socketConnection.on('punishment_updated', () => {
        const activeId = get().activeGuild?.id;
        if (activeId) {
          get().fetchModerationData(activeId);
          get().fetchAuditLogs(activeId);
        }
      });

      socketConnection.on('warning_updated', () => {
        const activeId = get().activeGuild?.id;
        if (activeId) {
          get().fetchModerationData(activeId);
          get().fetchAuditLogs(activeId);
        }
      });

      socketConnection.on('appeal_new', () => {
        const activeId = get().activeGuild?.id;
        if (activeId) {
          get().fetchModerationData(activeId);
        }
      });

      socketConnection.on('appeal_updated', () => {
        const activeId = get().activeGuild?.id;
        if (activeId) {
          get().fetchModerationData(activeId);
        }
      });

      socketConnection.on('scan_completed', (data) => {
        set({ scanProgress: { active: false, ...data, status: 'completed' } });
        get().addAlert(`🎉 Historical scan completed! Synced ${data.messagesScanned} messages.`, 'success');
        // Refresh logs and stats
        const activeId = get().activeGuild?.id;
        if (activeId === data.guildId) {
          get().fetchStats(activeId);
          get().fetchLogs(activeId);
        }
      });

      socketConnection.on('scan_failed', (data) => {
        set({ scanProgress: { active: false, status: 'failed', error: data.error } });
        get().addAlert(`❌ Historical scan failed: ${data.error}`, 'error');
      });

      // Handle real-time premium updates
      socketConnection.on('premium_status_update', (data) => {
        const { activeGuild } = get();
        if (activeGuild && activeGuild.id === data.guildId) {
          get().fetchPremium(data.guildId);
          get().fetchUsage(data.guildId);
          get().addAlert(`⚡ Guild license updated: Server is now on ${data.tier === 'Pro' ? 'ANTIFY PRO' : 'ANTIFY FREE'}!`, 'info');
        }
      });

      // Handle dynamic guild joins/leaves by the bot
      socketConnection.on('guild_added', (newGuild) => {
        set(state => {
          // Prevent duplicates
          if (state.guilds.some(g => g.id === newGuild.id)) return {};
          
          const updatedGuilds = [...state.guilds, newGuild];
          get().addAlert(`🤖 Bot added to new server: ${newGuild.name}`, 'info');
          
          return { guilds: updatedGuilds };
        });
      });

      socketConnection.on('guild_removed', (removedGuildId) => {
        set(state => {
          const updatedGuilds = (Array.isArray(state.guilds) ? state.guilds : []).filter(g => g.id !== removedGuildId);
          get().addAlert(`🤖 Bot removed from server.`, 'warning');
          
          let nextActive = state.activeGuild;
          if (state.activeGuild?.id === removedGuildId) {
            nextActive = updatedGuilds[0] || null;
          }
          
          // Trigger state shift
          setTimeout(() => {
            get().setActiveGuild(nextActive);
          }, 0);

          return { guilds: updatedGuilds };
        });
      });
    } else {
      if (oldGuildId) socketConnection.emit('leave_guild', oldGuildId);
      if (newGuildId) socketConnection.emit('join_guild', newGuildId);
    }
  }
}));
