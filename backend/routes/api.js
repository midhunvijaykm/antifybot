const router = require('express').Router();
const axios = require('axios');
const { ensureAuthenticated } = require('../middleware/auth');
const { Settings, Log, Punishment, Warning, AuditLog, Subscription, DetectionLog, UserInfraction, GuildAnalytics, DeletedMessage, HistoricalScanJob, Notification, HistoryScan, ThreatEvent, ModerationAction, DashboardStats, UsageStats, License } = require('../models');
const { activeScans, startHistoricalScan, cancelHistoricalScan, resumeHistoricalScan } = require('../helpers/scanner');
const { recalculateDashboardStats } = require('../helpers/statsUpdater');

// In-memory cache for guild settings (Task 2)
const settingsCache = new Map();

// ==============================
// GUILD AUTHORIZATION MIDDLEWARE
// ==============================
const checkGuildAdminPermission = async (req, res, next) => {
  const guildId = req.params.guildId || req.query.guildId;
  
  if (!guildId) {
    return res.status(400).json({ error: 'Guild ID is required' });
  }
  
  if (!/^\d{17,20}$/.test(guildId)) {
    return res.status(400).json({ error: 'Invalid Guild ID format' });
  }

  if (req.params.userId && !/^\d{17,20}$/.test(req.params.userId)) {
    return res.status(400).json({ error: 'Invalid User ID format' });
  }

  const userGuilds = req.user.guildsCache || [];
  const guild = userGuilds.find(g => g.id === guildId);
  
  if (!guild) {
    return res.status(403).json({ error: 'Forbidden: You are not a member of this server' });
  }

  const perms = BigInt(guild.permissions);
  const hasManageServer = (perms & 0x20n) === 0x20n;
  const hasAdmin = (perms & 0x8n) === 0x8n;
  
  if (!hasManageServer && !hasAdmin) {
    return res.status(403).json({ error: 'Forbidden: You do not have administrator permissions on this server' });
  }

  next();
};

const checkPremiumOrOwnerPermission = async (req, res, next) => {
  try {
    const guildId = req.params.guildId || req.query.guildId;
    if (!guildId) {
      return next();
    }

    const { isPremiumGuild, OWNER_ID } = require('../helpers/usage');

    // 1. Global Owner bypasses all locks
    const isOwner = req.user && req.user.discordId === OWNER_ID;
    if (isOwner) {
      return next();
    }

    // 2. Check if the guild is premium
    const isPremium = await isPremiumGuild(guildId);
    if (isPremium) {
      return next();
    }

    // 3. Otherwise, return locked payload
    return res.json({
      locked: true,
      error: 'This feature is locked. ANTIFY PRO is required.',
      upgradeRequired: true
    });
  } catch (error) {
    console.error('Error in premium gating middleware:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Route-level middleware binding to enforce auth & guild-level admin boundaries
router.use('/logs/:guildId', ensureAuthenticated, checkGuildAdminPermission, checkPremiumOrOwnerPermission);
router.use('/logs', ensureAuthenticated, (req, res, next) => {
  if (req.query.guildId) {
    return checkGuildAdminPermission(req, res, (err) => {
      if (err) return next(err);
      return checkPremiumOrOwnerPermission(req, res, next);
    });
  }
  next();
});
router.use('/deleted-messages', ensureAuthenticated, checkGuildAdminPermission, checkPremiumOrOwnerPermission);
router.use('/detections', ensureAuthenticated, checkGuildAdminPermission);
router.use('/infractions', ensureAuthenticated, checkGuildAdminPermission);
router.use('/users/:guildId/:userId', ensureAuthenticated, checkGuildAdminPermission);
router.use('/punishments/:guildId', ensureAuthenticated, checkGuildAdminPermission);
router.use('/settings/:guildId', ensureAuthenticated, checkGuildAdminPermission);
router.use('/analytics/:guildId', ensureAuthenticated, checkGuildAdminPermission, checkPremiumOrOwnerPermission);
router.use('/analytics', ensureAuthenticated, (req, res, next) => {
  if (req.query.guildId) {
    return checkGuildAdminPermission(req, res, (err) => {
      if (err) return next(err);
      return checkPremiumOrOwnerPermission(req, res, next);
    });
  }
  next();
});
router.use('/scan/status/:guildId', ensureAuthenticated, checkGuildAdminPermission, checkPremiumOrOwnerPermission);
router.use('/scan/:guildId', (req, res, next) => {
  if (req.params.guildId === 'status') return next();
  ensureAuthenticated(req, res, (err) => {
    if (err) return next(err);
    checkGuildAdminPermission(req, res, (err2) => {
      if (err2) return next(err2);
      checkPremiumOrOwnerPermission(req, res, next);
    });
  });
});
router.use('/premium/:guildId', ensureAuthenticated, checkGuildAdminPermission);
router.use('/moderation/:guildId', ensureAuthenticated, checkGuildAdminPermission, checkPremiumOrOwnerPermission);
router.use('/notifications/:guildId', ensureAuthenticated, checkGuildAdminPermission, checkPremiumOrOwnerPermission);
router.use('/history-scans/:guildId', ensureAuthenticated, checkGuildAdminPermission, checkPremiumOrOwnerPermission);
router.use('/dashboard-stats/:guildId', ensureAuthenticated, checkGuildAdminPermission);
router.use('/moderation-center/:guildId', ensureAuthenticated, checkGuildAdminPermission, checkPremiumOrOwnerPermission);
router.use('/server-management/:guildId', ensureAuthenticated, checkGuildAdminPermission);

// ==============================
// USER SESSION
// ==============================
router.get('/user', ensureAuthenticated, (req, res) => {
  res.json({
    user: {
      id: req.user.discordId,
      username: req.user.username,
      avatar: req.user.avatar,
    }
  });
});

// ==============================
// LOGOUT
// ==============================
router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ success: true, message: 'Logged out successfully' });
    });
  });
});

router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ success: true, message: 'Logged out successfully' });
    });
  });
});

// ==============================
// GUILDS LIST
// ==============================
router.get('/guilds', ensureAuthenticated, async (req, res) => {
  try {
    const client = req.app.get('discordClient');
    let botGuildIds = [];

    if (client) {
      botGuildIds = Array.from(client.guilds.cache.keys());
    } else if (process.env.DISCORD_TOKEN) {
      try {
        const botGuildsResponse = await axios.get('https://discord.com/api/v10/users/@me/guilds', {
          headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
        });
        botGuildIds = botGuildsResponse.data.map(g => g.id);
      } catch (botErr) {
        console.error('Failed to fetch bot guilds from Discord API:', botErr.message);
      }
    }

    // Filter user's manageable guilds (stored on req.user during serialization)
    const userGuilds = req.user.guildsCache || [];

    const filtered = await Promise.all(userGuilds.filter(g => {
      // Manage Server (0x20) or Administrator (0x8)
      const perms = BigInt(g.permissions);
      return (perms & 0x20n) === 0x20n || (perms & 0x8n) === 0x8n;
    }).map(async (g) => {
      const botJoined = botGuildIds.includes(g.id);
      
      let settings = null;
      if (botJoined) {
        settings = await Settings.findOne({ guildId: g.id });
        if (!settings) {
          settings = new Settings({ guildId: g.id });
          await settings.save();
        }
      }

      const iconUrl = g.icon 
        ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`
        : null;

      const isOwner = g.owner || false;

      return {
        id: g.id,
        name: g.name,
        icon: iconUrl,
        owner: isOwner,
        permissions: g.permissions,
        botJoined: botJoined,
        botActive: botJoined, // Keep for backward compatibility with frontend selectors
        status: botJoined ? "connected" : "invite_required",
        settings
      };
    }));

    res.json(filtered);
  } catch (error) {
    console.error('Error fetching guilds:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==============================
// MODERATION LOGS
// ==============================
const getLogsHandler = async (req, res) => {
  try {
    const guildId = req.params.guildId || req.query.guildId;
    if (!guildId) {
      return res.status(400).json({ error: 'Guild ID is required' });
    }
    const { page = 1, limit = 10, search = '', severity = '', type = '', user = '', startDate, endDate } = req.query;

    const query = { guildId };

    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { userId: { $regex: search, $options: 'i' } },
        { reason: { $regex: search, $options: 'i' } },
        { evidence: { $regex: search, $options: 'i' } },
        { details: { $regex: search, $options: 'i' } }
      ];
    }

    if (severity) query.severity = severity;
    if (type) query.type = type;
    if (user) query.userId = user;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const total = await Log.countDocuments(query);
    const logs = await Log.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      logs,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

router.get('/logs', ensureAuthenticated, getLogsHandler);
router.get('/logs/:guildId', ensureAuthenticated, getLogsHandler);

// ==============================
// DELETED MESSAGE ARCHIVE
// ==============================
router.get('/deleted-messages', ensureAuthenticated, async (req, res) => {
  try {
    const guildId = req.query.guildId || req.params.guildId;
    const { page = 1, limit = 10, search = '', user = '', startDate, endDate } = req.query;

    if (!guildId) {
      return res.status(400).json({ error: 'guildId parameter is required' });
    }

    const query = { guildId };

    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { userId: { $regex: search, $options: 'i' } },
        { originalContent: { $regex: search, $options: 'i' } },
        { deletionReason: { $regex: search, $options: 'i' } }
      ];
    }

    if (user) query.userId = user;

    if (startDate || endDate) {
      query.deletedAt = {};
      if (startDate) query.deletedAt.$gte = new Date(startDate);
      if (endDate) query.deletedAt.$lte = new Date(endDate);
    }

    const total = await DeletedMessage.countDocuments(query);
    const messages = await DeletedMessage.find(query)
      .sort({ deletedAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      messages,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching deleted messages:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==============================
// DETECTION LOGS
// ==============================
router.get('/detections', ensureAuthenticated, async (req, res) => {
  try {
    const guildId = req.query.guildId || req.params.guildId;
    const { page = 1, limit = 10, search = '', user = '', startDate, endDate } = req.query;

    if (!guildId) {
      return res.status(400).json({ error: 'guildId parameter is required' });
    }

    const query = { guildId };

    if (search) {
      query.$or = [
        { userId: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } },
        { OCRText: { $regex: search, $options: 'i' } },
        { detectionCategory: { $regex: search, $options: 'i' } }
      ];
    }

    if (user) query.userId = user;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const total = await DetectionLog.countDocuments(query);
    const detections = await DetectionLog.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      detections,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching detections:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==============================
// USER INFRACTIONS
// ==============================
router.get('/infractions', ensureAuthenticated, async (req, res) => {
  try {
    const guildId = req.query.guildId || req.params.guildId;
    const { user } = req.query;

    if (!guildId) {
      return res.status(400).json({ error: 'guildId parameter is required' });
    }

    const query = { guildId };
    if (user) query.userId = user;

    const infractions = await UserInfraction.find(query).sort({ lastViolation: -1 });
    res.json(infractions);
  } catch (error) {
    console.error('Error fetching infractions:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==============================
// OFFENDER PROFILE / INDIVIDUAL USER
// ==============================
router.get('/users/:guildId/:userId', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId, userId } = req.params;

    const logs = await Log.find({ guildId, userId }).sort({ timestamp: -1 });
    const warnings = await Warning.find({ guildId, userId }).sort({ createdAt: -1 });
    const punishments = await Punishment.find({ guildId, userId }).sort({ createdAt: -1 });
    
    // Check if infraction record is present in DB
    let infraction = await UserInfraction.findOne({ guildId, userId });
    
    if (!infraction) {
      // Calculate inline fallback score
      let riskScore = 0;
      warnings.forEach(() => riskScore += 10);
      punishments.forEach(p => {
        if (p.type === 'Kick' || p.type === 'Ban') riskScore += 70;
        else if (p.type === 'Timeout') riskScore += 40;
      });
      logs.forEach(l => {
        if (l.severity === 'low') riskScore += 5;
        else if (l.severity === 'medium') riskScore += 15;
        else if (l.severity === 'high') riskScore += 30;
        else if (l.severity === 'critical') riskScore += 50;
      });
      riskScore = Math.min(riskScore, 100);
      
      let riskLevel = 'Low';
      if (riskScore >= 75) riskLevel = 'Critical';
      else if (riskScore >= 45) riskLevel = 'High';
      else if (riskScore >= 20) riskLevel = 'Medium';

      infraction = {
        warnings: warnings.length,
        mutes: punishments.filter(p => p.type === 'Timeout').length,
        kicks: punishments.filter(p => p.type === 'Kick').length,
        bans: punishments.filter(p => p.type === 'Ban').length,
        scamAttempts: logs.filter(l => l.type === 'Spam Words' || l.type === 'Scam Image').length,
        phishingAttempts: logs.filter(l => l.type === 'Phishing Link').length,
        riskLevel,
        riskScore
      };
    } else {
      let riskScore = 0;
      riskScore += (infraction.warnings || 0) * 10;
      riskScore += (infraction.mutes || 0) * 40;
      riskScore += (infraction.kicks || 0) * 70;
      riskScore += (infraction.bans || 0) * 100;
      riskScore += (infraction.scamAttempts || 0) * 15;
      riskScore += (infraction.phishingAttempts || 0) * 30;
      infraction.riskScore = Math.min(riskScore, 100);
    }

    res.json({
      userId,
      username: logs[0]?.username || warnings[0]?.username || punishments[0]?.username || 'Unknown Offender',
      riskScore: infraction.riskScore !== undefined ? infraction.riskScore : 0,
      riskLevel: infraction.riskLevel,
      violationCount: logs.length,
      warningCount: infraction.warnings,
      punishmentCount: infraction.mutes + infraction.kicks + infraction.bans,
      history: {
        violations: logs,
        warnings,
        punishments
      }
    });
  } catch (error) {
    console.error('Error fetching offender details:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==============================
// PUNISHMENTS LIST
// ==============================
router.get('/punishments/:guildId', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const punishments = await Punishment.find({ guildId }).sort({ createdAt: -1 }).limit(50);
    res.json(punishments);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==============================
// SETTINGS
// ==============================
router.get('/settings/:guildId', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const now = Date.now();
    const cached = settingsCache.get(guildId);

    if (cached && (now - cached.timestamp < 60000)) {
      return res.json(cached.data);
    }

    let settings = await Settings.findOne({ guildId });
    if (!settings) {
      settings = new Settings({ guildId });
      await settings.save();
    }

    settingsCache.set(guildId, {
      data: settings,
      timestamp: now
    });

    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/settings/:guildId', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const updates = req.body;

    const allowedKeys = [
      'ocrEnabled', 'autoBan', 'autoKick', 'autoTimeout', 'deleteMessages', 'strictMode',
      'scanSensitivity', 'antiScamEnabled', 'antiPhishingEnabled', 'virusTotalEnabled',
      'loggingChannelId', 'welcomeEnabled', 'welcomeChannelId', 'welcomeMessageText',
      'roleManagementEnabled', 'autoroleId'
    ];

    // Validate inputs
    for (const key of Object.keys(updates)) {
      if (!allowedKeys.includes(key)) {
        return res.status(400).json({ error: `Invalid configuration key: ${key}` });
      }

      const val = updates[key];
      if (['ocrEnabled', 'autoBan', 'autoKick', 'autoTimeout', 'deleteMessages', 'strictMode', 'antiScamEnabled', 'antiPhishingEnabled', 'virusTotalEnabled', 'welcomeEnabled', 'roleManagementEnabled'].includes(key)) {
        if (typeof val !== 'boolean') {
          return res.status(400).json({ error: `${key} must be a boolean` });
        }
      }
      if (key === 'scanSensitivity') {
        if (typeof val !== 'number' || val < 1 || val > 100) {
          return res.status(400).json({ error: 'scanSensitivity must be a number between 1 and 100' });
        }
      }
      if (['loggingChannelId', 'welcomeChannelId', 'welcomeMessageText', 'autoroleId'].includes(key)) {
        if (typeof val !== 'string') {
          return res.status(400).json({ error: `${key} must be a string` });
        }
        if (['loggingChannelId', 'welcomeChannelId', 'autoroleId'].includes(key) && val !== "" && !/^\d{17,20}$/.test(val)) {
          return res.status(400).json({ error: `${key} must be a valid Discord ID format` });
        }
      }
    }

    let settings = await Settings.findOne({ guildId });
    if (!settings) settings = new Settings({ guildId });

    const changedFields = [];
    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined && String(settings[key]) !== String(updates[key])) {
        changedFields.push(`${key}: ${settings[key]} -> ${updates[key]}`);
        settings[key] = updates[key];
      }
    });

    if (changedFields.length > 0) {
      await settings.save();
      settingsCache.delete(guildId);
      const audit = new AuditLog({
        guildId,
        adminId: req.user.discordId,
        adminName: req.user.username,
        action: 'Updated Settings',
        details: changedFields.join(', ')
      });
      await audit.save();
    }

    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/settings/:guildId/keywords', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { keyword } = req.body;
    if (!keyword) return res.status(400).json({ error: 'Keyword is required' });

    let settings = await Settings.findOne({ guildId });
    if (!settings) settings = new Settings({ guildId });

    if (settings.blacklistKeywords.includes(keyword)) {
      return res.status(400).json({ error: 'Keyword already exists' });
    }

    settings.blacklistKeywords.push(keyword);
    await settings.save();
    settingsCache.delete(guildId);

    const audit = new AuditLog({
      guildId,
      adminId: req.user.discordId,
      adminName: req.user.username,
      action: 'Added Blacklist Keyword',
      details: `Added: "${keyword}"`
    });
    await audit.save();

    res.json({ success: true, keywords: settings.blacklistKeywords });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.delete('/settings/:guildId/keywords/:keyword', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId, keyword } = req.params;
    let settings = await Settings.findOne({ guildId });
    if (!settings || !settings.blacklistKeywords.includes(keyword)) {
      return res.status(404).json({ error: 'Keyword not found' });
    }

    settings.blacklistKeywords = settings.blacklistKeywords.filter(k => k !== keyword);
    await settings.save();
    settingsCache.delete(guildId);

    const audit = new AuditLog({
      guildId,
      adminId: req.user.discordId,
      adminName: req.user.username,
      action: 'Removed Blacklist Keyword',
      details: `Removed: "${keyword}"`
    });
    await audit.save();

    res.json({ success: true, keywords: settings.blacklistKeywords });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==============================
// ANALYTICS
// ==============================
const getAnalyticsHandler = async (req, res) => {
  try {
    const guildId = req.params.guildId || req.query.guildId;
    if (!guildId) {
      return res.status(400).json({ error: 'Guild ID is required' });
    }

    // Fetch last 7 days of dailyStats from GuildAnalytics
    let analytics = await GuildAnalytics.findOne({ guildId });
    if (!analytics) {
      // Create initial stats aggregated from existing logs
      const totalDetections = await Log.countDocuments({ guildId });
      const totalBans = await Punishment.countDocuments({ guildId, type: 'Ban' });
      const totalKicks = await Punishment.countDocuments({ guildId, type: 'Kick' });
      const totalWarnings = await Log.countDocuments({ guildId, actionType: 'Warned' });
      const totalTimeouts = await Punishment.countDocuments({ guildId, type: 'Timeout' });
      const totalPhishing = await Log.countDocuments({ guildId, type: 'Phishing Link' });
      const totalScamLinks = await Log.countDocuments({ guildId, type: 'Spam Words' });

      // Aggregate new channel-specific stats
      const voiceScamAttempts = await Log.countDocuments({ 
        guildId, 
        channelType: { $in: ['GuildVoice', 'GuildStageVoice'] } 
      });
      const threadPhishingAttempts = await Log.countDocuments({ 
        guildId, 
        channelType: { $in: ['PublicThread', 'PrivateThread', 'AnnouncementThread'] } 
      });
      const forumModerationStats = await Log.countDocuments({ 
        guildId, 
        $or: [
          { channelType: { $in: ['GuildForum', 'GuildMedia'] } },
          { forumPostId: { $ne: null } }
        ]
      });

      const channelDetectionsGroup = await Log.aggregate([
        { $match: { guildId } },
        { $group: { _id: "$channelType", count: { $sum: 1 } } }
      ]);
      const detectionsByChannelType = {
        'GuildText': 0,
        'GuildVoice': 0,
        'PublicThread': 0,
        'PrivateThread': 0,
        'GuildForum': 0,
        'GuildAnnouncement': 0,
        'GuildMedia': 0,
        'GuildStageVoice': 0,
        'AnnouncementThread': 0
      };
      channelDetectionsGroup.forEach(group => {
        const type = group._id || 'GuildText';
        detectionsByChannelType[type] = group.count;
      });

      analytics = new GuildAnalytics({
        guildId,
        totalDetections,
        totalPunishments: totalBans + totalKicks + totalTimeouts,
        totalWarnings,
        totalBans,
        totalKicks,
        totalPhishingBlocked: totalPhishing,
        totalScamLinksBlocked: totalScamLinks,
        voiceScamAttempts,
        threadPhishingAttempts,
        forumModerationStats,
        detectionsByChannelType,
        dailyStats: [],
        weeklyStats: [],
        monthlyStats: []
      });
      
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const logAgg = await Log.aggregate([
        { $match: { guildId, createdAt: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            detections: { $sum: 1 },
            phishing: { $sum: { $cond: [{ $eq: ['$type', 'Phishing Link'] }, 1, 0] } },
            spam: { $sum: { $cond: [{ $eq: ['$type', 'Spam Words'] }, 1, 0] } },
            image: { $sum: { $cond: [{ $eq: ['$type', 'Scam Image'] }, 1, 0] } }
          }
        }
      ]);
      
      logAgg.forEach(item => {
        analytics.dailyStats.push({
          date: item._id,
          messagesScanned: item.detections * 5 + 20, // estimated
          detections: item.detections,
          phishingBlocked: item.phishing || 0,
          scamLinksBlocked: item.spam || 0,
          warnings: 0,
          punishments: 0,
          bans: 0,
          kicks: 0,
          voiceScamAttempts: 0,
          threadPhishingAttempts: 0,
          forumModerationStats: 0,
          detectionsByChannelType: {
            'GuildText': 0, 'GuildVoice': 0, 'PublicThread': 0, 'PrivateThread': 0,
            'GuildForum': 0, 'GuildAnnouncement': 0, 'GuildMedia': 0, 'GuildStageVoice': 0, 'AnnouncementThread': 0
          }
        });
      });
      
      await analytics.save();
    }

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const finalTrends = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      
      const match = analytics.dailyStats.find(t => t.date === dateStr);
      finalTrends.push({
        name: weekdays[d.getDay()],
        date: dateStr,
        detections: match ? match.detections : 0,
        phishing: match ? (match.phishingBlocked || 0) : 0,
        spam: match ? (match.scamLinksBlocked || 0) : 0,
        image: match ? (match.detections - (match.phishingBlocked || 0) - (match.scamLinksBlocked || 0)) : 0
      });
    }

    const ocrTrends = finalTrends.map(t => {
      const match = analytics.dailyStats.find(d => d.date === t.date);
      return {
        time: t.name,
        scans: match ? match.messagesScanned : Math.floor(Math.random() * 20) + 10,
        matches: match ? match.detections : 0
      };
    });

    const client = req.app.get('discordClient');
    let protectedUsers = 0;
    if (client) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) protectedUsers = guild.memberCount;
    }

    // Weekly activity telemetry aggregation
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const weeklyLogAgg = await Log.aggregate([
      { $match: { guildId, createdAt: { $gte: fourWeeksAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%U', date: '$createdAt' } },
          detections: { $sum: 1 }
        }
      }
    ]);

    const weeklyTrends = [];
    for (let i = 3; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i * 7);
      const weekLabel = i === 0 ? 'This Week' : `${i} Wk Ago`;
      const aggMatch = weeklyLogAgg.find(w => w._id && w._id.includes(String(Math.ceil(d.getDate() / 7))));
      const detectionsCount = aggMatch ? aggMatch.detections : Math.floor(Math.random() * 5); // fallback simulation values for clean servers

      weeklyTrends.push({
        name: weekLabel,
        detections: detectionsCount
      });
    }

    res.json({
      totals: {
        detections: analytics.totalDetections,
        punishments: analytics.totalPunishments,
        bans: analytics.totalBans,
        warnings: analytics.totalWarnings,
        protectedUsers,
        totalScans: analytics.totalScans || analytics.totalMessagesScanned,
        totalDeletedMessages: analytics.totalDeletedMessages,
        voiceScamAttempts: analytics.voiceScamAttempts || 0,
        threadPhishingAttempts: analytics.threadPhishingAttempts || 0,
        forumModerationStats: analytics.forumModerationStats || 0,
        detectionsByChannelType: analytics.detectionsByChannelType || {
          'GuildText': 0, 'GuildVoice': 0, 'PublicThread': 0, 'PrivateThread': 0,
          'GuildForum': 0, 'GuildAnnouncement': 0, 'GuildMedia': 0, 'GuildStageVoice': 0, 'AnnouncementThread': 0
        }
      },
      detectionTrends: finalTrends,
      weeklyTrends,
      ocrTrends,
      rawAnalytics: analytics
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

router.get('/analytics', ensureAuthenticated, getAnalyticsHandler);
router.get('/analytics/:guildId', ensureAuthenticated, getAnalyticsHandler);

// ==============================
// HISTORICAL MESSAGE SCAN TRIGGER
// ==============================
router.post('/scan/:guildId', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { depth = 100, channelId = null } = req.body;

    const client = req.app.get('discordClient');
    if (!client) {
      return res.status(500).json({ error: 'Discord Client not active on backend server' });
    }

    const result = await startHistoricalScan(client, guildId, channelId, depth, req.user.discordId);
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    res.json({ success: true, message: 'Historical scan process initialized', scanState: result.scanState });
  } catch (err) {
    console.error('API Error triggering scan:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/scan/:guildId/cancel', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const result = await cancelHistoricalScan(guildId);
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }
    res.json({ success: true, message: result.message });
  } catch (err) {
    console.error('API Error cancelling scan:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/scan/:guildId/resume', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const client = req.app.get('discordClient');
    if (!client) {
      return res.status(500).json({ error: 'Discord Client not active on backend server' });
    }
    const result = await resumeHistoricalScan(client, guildId, req.user.discordId);
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }
    res.json({ success: true, message: result.message, scanState: result.scanState });
  } catch (err) {
    console.error('API Error resuming scan:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/scan/status/:guildId', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const job = await HistoricalScanJob.findOne({ guildId });
    if (!job) {
      return res.json({ active: false, status: 'inactive' });
    }
    const active = job.status === 'scanning';
    res.json({
      active,
      status: job.status,
      guildId: job.guildId,
      scanDepth: job.scanDepth,
      totalChannels: job.totalChannels,
      processedChannels: job.processedChannels,
      messagesScanned: job.messagesScanned,
      detectionsFound: job.detectionsFound,
      currentChannelId: job.currentChannelId,
      currentChannelName: job.currentChannelName,
      startedAt: job.startedAt,
      completedAt: job.completedAt
    });
  } catch (err) {
    console.error('API Error fetching scan status:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==============================
// PREMIUM / SUBSCRIPTIONS
// ==============================
router.get('/premium/:guildId', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { isPremiumGuild } = require('../helpers/usage');
    
    const isPremium = await isPremiumGuild(guildId);
    
    const license = await License.findOne({ guildId });
    const sub = await Subscription.findOne({ guildId });

    let plan = 'Free';
    let expiresAt = null;
    let source = 'Manual';

    if (license && license.plan === 'Pro') {
      if (!license.expiresAt || new Date(license.expiresAt) > new Date()) {
        plan = 'Pro';
        expiresAt = license.expiresAt;
        source = license.source;
      }
    } else if (sub && (sub.plan === 'Pro' || sub.plan === 'Enterprise') && sub.status === 'active') {
      if (!sub.expiresAt || new Date(sub.expiresAt) > new Date()) {
        plan = 'Pro';
        expiresAt = sub.expiresAt;
        source = 'Stripe';
      }
    }

    res.json({
      plan,
      isPremium,
      expiresAt,
      source,
      features: {
        ocrLimit: plan === 'Pro' ? -1 : 10,
        advancedAI: plan === 'Pro',
        customKeywords: plan === 'Pro',
        dedicatedSupport: plan === 'Pro'
      }
    });
  } catch (error) {
    console.error('Error fetching subscription:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/premium/:guildId/subscribe', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { plan, provider = 'Stripe' } = req.body;

    if (!['Pro'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid subscription plan' });
    }

    // Payment integration redirect mock URL
    let checkoutUrl = `https://checkout.stripe.com/pay/cs_test_mock_${Date.now()}`;
    if (provider === 'PayPal') {
      checkoutUrl = `https://paypal.com/checkout/mock_${Date.now()}`;
    } else if (provider === 'DiscordStore') {
      checkoutUrl = `https://discord.com/store/mock_${Date.now()}`;
    }

    // Create/update License record
    let license = await License.findOne({ guildId });
    if (!license) {
      license = new License({ guildId });
    }
    license.plan = 'Pro';
    license.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days trial
    license.source = provider;
    await license.save();

    // Update Guild model cache
    let guild = await Guild.findOne({ guildId });
    if (guild) {
      guild.premiumStatus = 'Pro';
      await guild.save();
    }

    // Emit live update
    const client = req.app.get('discordClient');
    if (client && client.io) {
      client.io.emit('premium_status_update', { guildId, isPremium: true, tier: 'Pro' });
    }

    res.json({
      checkoutUrl,
      message: `Successfully simulated ${provider} payment checkout and generated a Pro license!`
    });
  } catch (error) {
    console.error('Mock checkout error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==============================
// MODERATION CONTROL CENTER
// ==============================

// Fetch moderation data (punishments, warnings, appeals)
router.get('/moderation/:guildId', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const punishments = await Punishment.find({ guildId }).sort({ createdAt: -1 });
    const warnings = await Warning.find({ guildId }).sort({ createdAt: -1 });
    res.json({ punishments, warnings });
  } catch (error) {
    console.error('Error fetching moderation data:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Remove timeout
router.post('/moderation/:guildId/timeout/remove', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { userId, punishmentId } = req.body;

    const client = req.app.get('discordClient');
    if (client) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member && member.communicationDisabledUntilTimestamp) {
          await member.timeout(null, `Removed by moderator: ${req.user.username}`);
        }
      }
    }

    let punishment;
    if (punishmentId) {
      punishment = await Punishment.findByIdAndUpdate(punishmentId, {
        active: false,
        expired: true,
        removedBy: req.user.username,
        removedAt: new Date()
      }, { new: true });
    } else {
      punishment = await Punishment.findOneAndUpdate(
        { guildId, userId, type: 'Timeout', active: true },
        { active: false, expired: true, removedBy: req.user.username, removedAt: new Date() },
        { new: true }
      );
    }

    if (punishment) {
      await UserInfraction.findOneAndUpdate(
        { guildId, userId },
        { $inc: { mutes: -1 } }
      );
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`guild_${guildId}`).emit('punishment_updated', punishment);
    }

    res.json({ success: true, punishment });
  } catch (error) {
    console.error('Error removing timeout:', error);
    res.status(500).json({ error: error.message });
  }
});

// Edit timeout duration
router.post('/moderation/:guildId/timeout/edit', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { userId, punishmentId, duration } = req.body; // duration in ms

    const client = req.app.get('discordClient');
    if (client) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          await member.timeout(duration, `Timeout duration edited by ${req.user.username}`);
        }
      }
    }

    const punishment = await Punishment.findByIdAndUpdate(punishmentId, {
      duration,
      notes: `Duration updated to ${duration / 60000} minutes by ${req.user.username}`
    }, { new: true });

    const io = req.app.get('io');
    if (io) {
      io.to(`guild_${guildId}`).emit('punishment_updated', punishment);
    }

    res.json({ success: true, punishment });
  } catch (error) {
    console.error('Error editing timeout:', error);
    res.status(500).json({ error: error.message });
  }
});

// Remove ban (unban)
router.post('/moderation/:guildId/ban/remove', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { userId, punishmentId } = req.body;

    const client = req.app.get('discordClient');
    if (client) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        await guild.bans.remove(userId, `Unbanned by ${req.user.username}`).catch(e => console.log('Discord unban failed:', e.message));
      }
    }

    let punishment;
    if (punishmentId) {
      punishment = await Punishment.findByIdAndUpdate(punishmentId, {
        active: false,
        expired: true,
        removedBy: req.user.username,
        removedAt: new Date()
      }, { new: true });
    } else {
      punishment = await Punishment.findOneAndUpdate(
        { guildId, userId, type: 'Ban', active: true },
        { active: false, expired: true, removedBy: req.user.username, removedAt: new Date() },
        { new: true }
      );
    }

    if (punishment) {
      await UserInfraction.findOneAndUpdate(
        { guildId, userId },
        { $inc: { bans: -1 } }
      );
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`guild_${guildId}`).emit('punishment_updated', punishment);
    }

    res.json({ success: true, punishment });
  } catch (error) {
    console.error('Error removing ban:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete warning
router.delete('/moderation/:guildId/warnings/:warningId', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId, warningId } = req.params;

    const warning = await Warning.findByIdAndUpdate(warningId, {
      active: false,
      removedBy: req.user.username,
      removedAt: new Date()
    }, { new: true });

    if (warning) {
      await UserInfraction.findOneAndUpdate(
        { guildId, userId: warning.userId },
        { $inc: { warnings: -1 } }
      );
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`guild_${guildId}`).emit('warning_updated', warning);
    }

    res.json({ success: true, warning });
  } catch (error) {
    console.error('Error deleting warning:', error);
    res.status(500).json({ error: error.message });
  }
});

// Revert moderation action (generic)
router.post('/moderation/:guildId/revert', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { punishmentId } = req.body;

    const punishment = await Punishment.findById(punishmentId);
    if (!punishment) return res.status(404).json({ error: 'Punishment not found' });

    const client = req.app.get('discordClient');
    if (client) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        if (punishment.type === 'Timeout') {
          const member = await guild.members.fetch(punishment.userId).catch(() => null);
          if (member && member.communicationDisabledUntilTimestamp) {
            await member.timeout(null, `Reverted by moderator: ${req.user.username}`);
          }
        } else if (punishment.type === 'Ban') {
          await guild.bans.remove(punishment.userId, `Reverted by moderator: ${req.user.username}`).catch(() => null);
        }
      }
    }

    punishment.active = false;
    punishment.expired = true;
    punishment.removedBy = req.user.username;
    punishment.removedAt = new Date();
    await punishment.save();

    const decField = punishment.type === 'Ban' ? 'bans' : (punishment.type === 'Timeout' ? 'mutes' : 'kicks');
    await UserInfraction.findOneAndUpdate(
      { guildId, userId: punishment.userId },
      { $inc: { [decField]: -1 } }
    );

    const io = req.app.get('io');
    if (io) {
      io.to(`guild_${guildId}`).emit('punishment_updated', punishment);
    }

    res.json({ success: true, punishment });
  } catch (error) {
    console.error('Error reverting punishment:', error);
    res.status(500).json({ error: error.message });
  }
});

// Submit mock appeal (for testing/demo)
router.post('/moderation/:guildId/appeal', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { punishmentId, appealReason } = req.body;

    const punishment = await Punishment.findByIdAndUpdate(punishmentId, {
      appealStatus: 'Pending',
      appealReason,
      appealSubmittedAt: new Date()
    }, { new: true });

    const io = req.app.get('io');
    if (io) {
      io.to(`guild_${guildId}`).emit('appeal_new', punishment);
      io.to(`guild_${guildId}`).emit('punishment_updated', punishment);
    }

    res.json({ success: true, punishment });
  } catch (error) {
    console.error('Error submitting appeal:', error);
    res.status(500).json({ error: error.message });
  }
});

// Handle appeal (Approve/Reject)
router.post('/moderation/:guildId/appeal/handle', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { punishmentId, action, notes } = req.body; // action: 'Approve' or 'Reject'

    const punishment = await Punishment.findById(punishmentId);
    if (!punishment) return res.status(404).json({ error: 'Punishment not found' });

    if (action === 'Approve') {
      punishment.appealStatus = 'Approved';
      punishment.active = false;
      punishment.expired = true;
      punishment.removedBy = req.user.username;
      punishment.removedAt = new Date();
      punishment.notes = notes || `Appeal approved by ${req.user.username}`;

      const client = req.app.get('discordClient');
      if (client) {
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
          if (punishment.type === 'Timeout') {
            const member = await guild.members.fetch(punishment.userId).catch(() => null);
            if (member && member.communicationDisabledUntilTimestamp) {
              await member.timeout(null, `Appeal approved by ${req.user.username}`);
            }
          } else if (punishment.type === 'Ban') {
            await guild.bans.remove(punishment.userId, `Appeal approved by ${req.user.username}`).catch(() => null);
          }
        }
      }

      const decField = punishment.type === 'Ban' ? 'bans' : (punishment.type === 'Timeout' ? 'mutes' : 'kicks');
      await UserInfraction.findOneAndUpdate(
        { guildId, userId: punishment.userId },
        { $inc: { [decField]: -1 } }
      );
    } else {
      punishment.appealStatus = 'Rejected';
      punishment.notes = notes || `Appeal rejected by ${req.user.username}`;
    }

    await punishment.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`guild_${guildId}`).emit('appeal_updated', punishment);
      io.to(`guild_${guildId}`).emit('punishment_updated', punishment);
    }

    res.json({ success: true, punishment });
  } catch (error) {
    console.error('Error handling appeal:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// ENTERPRISE FLAT API ROUTES
// ==============================

// Fetch punishments
router.get('/punishments', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.query;
    if (!guildId) return res.status(400).json({ error: 'guildId query is required' });
    const punishments = await Punishment.find({ guildId }).sort({ createdAt: -1 });
    res.json(punishments);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Fetch bans
router.get('/bans', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.query;
    if (!guildId) return res.status(400).json({ error: 'guildId query is required' });
    const bans = await Punishment.find({ guildId, type: 'Ban' }).sort({ createdAt: -1 });
    res.json(bans);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Fetch timeouts
router.get('/timeouts', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.query;
    if (!guildId) return res.status(400).json({ error: 'guildId query is required' });
    const timeouts = await Punishment.find({ guildId, type: 'Timeout' }).sort({ createdAt: -1 });
    res.json(timeouts);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Fetch warnings
router.get('/warnings', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.query;
    if (!guildId) return res.status(400).json({ error: 'guildId query is required' });
    const warnings = await Warning.find({ guildId }).sort({ createdAt: -1 });
    res.json(warnings);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Fetch appeals
router.get('/appeals', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.query;
    if (!guildId) return res.status(400).json({ error: 'guildId query is required' });
    const appeals = await Punishment.find({ guildId, appealStatus: { $ne: 'None' } }).sort({ appealSubmittedAt: -1, createdAt: -1 });
    res.json(appeals);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Fetch Audit Logs
router.get('/audit-logs/:guildId', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const auditLogs = await AuditLog.find({ guildId }).sort({ createdAt: -1 }).limit(100);
    res.json(auditLogs);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Remove timeout (flat endpoint)
router.post('/punishments/remove-timeout', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId, userId, punishmentId } = req.body;
    if (!guildId || !userId) return res.status(400).json({ error: 'guildId and userId are required' });

    const client = req.app.get('discordClient');
    if (client) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member && member.communicationDisabledUntilTimestamp) {
          await member.timeout(null, `Timeout removed by ${req.user.username}`);
        }
      }
    }

    let punishment;
    if (punishmentId) {
      punishment = await Punishment.findByIdAndUpdate(punishmentId, {
        active: false,
        expired: true,
        removedBy: req.user.username,
        removedAt: new Date()
      }, { new: true });
    } else {
      punishment = await Punishment.findOneAndUpdate(
        { guildId, userId, type: 'Timeout', active: true },
        { active: false, expired: true, removedBy: req.user.username, removedAt: new Date() },
        { new: true }
      );
    }

    if (punishment) {
      await UserInfraction.findOneAndUpdate(
        { guildId, userId },
        { $inc: { mutes: -1 } }
      );
      
      const audit = new AuditLog({
        guildId,
        adminId: req.user.discordId || req.user.id || 'system',
        adminName: req.user.username,
        action: 'Removed Timeout',
        details: `Removed timeout from user ${punishment.username} (ID: ${userId})`
      });
      await audit.save();
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`guild_${guildId}`).emit('punishment_updated', punishment);
    }

    res.json({ success: true, punishment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Unban user (flat endpoint)
router.post('/punishments/unban', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId, userId, punishmentId } = req.body;
    if (!guildId || !userId) return res.status(400).json({ error: 'guildId and userId are required' });

    const client = req.app.get('discordClient');
    if (client) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        await guild.bans.remove(userId, `Unbanned by ${req.user.username}`).catch(e => console.log('Discord unban failed:', e.message));
      }
    }

    let punishment;
    if (punishmentId) {
      punishment = await Punishment.findByIdAndUpdate(punishmentId, {
        active: false,
        expired: true,
        removedBy: req.user.username,
        removedAt: new Date()
      }, { new: true });
    } else {
      punishment = await Punishment.findOneAndUpdate(
        { guildId, userId, type: 'Ban', active: true },
        { active: false, expired: true, removedBy: req.user.username, removedAt: new Date() },
        { new: true }
      );
    }

    if (punishment) {
      await UserInfraction.findOneAndUpdate(
        { guildId, userId },
        { $inc: { bans: -1 } }
      );

      const audit = new AuditLog({
        guildId,
        adminId: req.user.discordId || req.user.id || 'system',
        adminName: req.user.username,
        action: 'Unbanned User',
        details: `Unbanned user ${punishment.username} (ID: ${userId})`
      });
      await audit.save();
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`guild_${guildId}`).emit('punishment_updated', punishment);
    }

    res.json({ success: true, punishment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Edit punishment (flat endpoint)
router.patch('/punishments/edit', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId, punishmentId, duration, notes, moderatorNotes } = req.body;
    if (!guildId || !punishmentId) return res.status(400).json({ error: 'guildId and punishmentId are required' });

    const punishment = await Punishment.findById(punishmentId);
    if (!punishment) return res.status(404).json({ error: 'Punishment not found' });

    // If timeout duration changes, sync to Discord
    if (punishment.type === 'Timeout' && duration !== undefined && punishment.active && !punishment.expired) {
      const client = req.app.get('discordClient');
      if (client) {
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
          const member = await guild.members.fetch(punishment.userId).catch(() => null);
          if (member) {
            await member.timeout(duration, `Timeout duration edited by ${req.user.username}`);
          }
        }
      }
      punishment.duration = duration;
    }

    if (notes !== undefined) punishment.notes = notes;
    if (moderatorNotes !== undefined) punishment.moderatorNotes = moderatorNotes;
    await punishment.save();

    const audit = new AuditLog({
      guildId,
      adminId: req.user.discordId || req.user.id || 'system',
      adminName: req.user.username,
      action: 'Edited Punishment',
      details: `Edited ${punishment.type} for user ${punishment.username} (ID: ${punishment.userId})`
    });
    await audit.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`guild_${guildId}`).emit('punishment_updated', punishment);
    }

    res.json({ success: true, punishment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete warning (flat endpoint)
router.delete('/warnings/:id', ensureAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const warning = await Warning.findByIdAndUpdate(id, {
      active: false,
      removedBy: req.user.username,
      removedAt: new Date()
    }, { new: true });

    if (warning) {
      await UserInfraction.findOneAndUpdate(
        { guildId: warning.guildId, userId: warning.userId },
        { $inc: { warnings: -1 } }
      );
      
      const audit = new AuditLog({
        guildId: warning.guildId,
        adminId: req.user.discordId || req.user.id || 'system',
        adminName: req.user.username,
        action: 'Removed Warning',
        details: `Deleted warning from user ${warning.username} (ID: ${warning.userId})`
      });
      await audit.save();

      const io = req.app.get('io');
      if (io) {
        io.to(`guild_${warning.guildId}`).emit('warning_updated', warning);
      }
    }

    res.json({ success: true, warning });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Revoke punishment (flat endpoint)
router.post('/punishments/revoke', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId, punishmentId } = req.body;
    if (!guildId || !punishmentId) return res.status(400).json({ error: 'guildId and punishmentId are required' });

    const punishment = await Punishment.findById(punishmentId);
    if (!punishment) return res.status(404).json({ error: 'Punishment not found' });

    const client = req.app.get('discordClient');
    if (client) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        if (punishment.type === 'Timeout') {
          const member = await guild.members.fetch(punishment.userId).catch(() => null);
          if (member && member.communicationDisabledUntilTimestamp) {
            await member.timeout(null, `Revoked by moderator: ${req.user.username}`);
          }
        } else if (punishment.type === 'Ban') {
          await guild.bans.remove(punishment.userId, `Revoked by moderator: ${req.user.username}`).catch(() => null);
        }
      }
    }

    punishment.active = false;
    punishment.expired = true;
    punishment.revoked = true;
    punishment.revokedBy = req.user.username;
    punishment.revokedAt = new Date();
    punishment.notes = `Revoked by ${req.user.username}`;
    await punishment.save();

    const decField = punishment.type === 'Ban' ? 'bans' : (punishment.type === 'Timeout' ? 'mutes' : 'kicks');
    await UserInfraction.findOneAndUpdate(
      { guildId, userId: punishment.userId },
      { $inc: { [decField]: -1 } }
    );

    const audit = new AuditLog({
      guildId,
      adminId: req.user.discordId || req.user.id || 'system',
      adminName: req.user.username,
      action: 'Revoked Punishment',
      details: `Revoked ${punishment.type} for user ${punishment.username} (ID: ${punishment.userId})`
    });
    await audit.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`guild_${guildId}`).emit('punishment_updated', punishment);
    }

    res.json({ success: true, punishment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// False positive handling (flat endpoint)
router.post('/false-positive', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId, evidenceId, action } = req.body; // action: 'restore' | 'whitelist_pattern' | 'whitelist_user' | 'whitelist_channel'
    if (!guildId || !evidenceId || !action) {
      return res.status(400).json({ error: 'guildId, evidenceId, and action are required' });
    }

    const msg = await DeletedMessage.findById(evidenceId);
    if (!msg) return res.status(404).json({ error: 'Evidence message not found' });

    msg.falsePositive = true;

    let settings = await Settings.findOne({ guildId });
    if (!settings) settings = new Settings({ guildId });

    let detailMsg = '';

    if (action === 'restore') {
      msg.restored = true;
      msg.restoredBy = req.user.username;
      msg.restoredAt = new Date();

      // Post back to Discord
      const client = req.app.get('discordClient');
      if (client) {
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
          const channel = guild.channels.cache.get(msg.channelId);
          if (channel) {
            await channel.send({
              content: `🔄 **[RESTORED MESSAGE]** originally sent by **${msg.displayName}** (${msg.username}):\n${msg.originalContent}`
            }).catch(e => console.log('Restore send failed:', e.message));
          }
        }
      }
      detailMsg = `Restored original message deleted in #${msg.channelName}`;

      // Automatically revoke warnings or punishments linked to this evidenceId
      const linkedPun = await Punishment.findOneAndUpdate(
        { evidenceId, active: true },
        { 
          active: false, 
          expired: true, 
          falsePositive: true, 
          restored: true, 
          notes: `Revoked via False Positive restoration by ${req.user.username}` 
        },
        { new: true }
      );
      if (linkedPun) {
        const decField = linkedPun.type === 'Ban' ? 'bans' : (linkedPun.type === 'Timeout' ? 'mutes' : 'kicks');
        await UserInfraction.findOneAndUpdate(
          { guildId, userId: linkedPun.userId },
          { $inc: { [decField]: -1 } }
        );
        
        // Remove on Discord
        const client = req.app.get('discordClient');
        if (client) {
          const guild = client.guilds.cache.get(guildId);
          if (guild) {
            if (linkedPun.type === 'Timeout') {
              const member = await guild.members.fetch(linkedPun.userId).catch(() => null);
              if (member && member.communicationDisabledUntilTimestamp) {
                await member.timeout(null, `Reverted due to False Positive: ${req.user.username}`);
              }
            } else if (linkedPun.type === 'Ban') {
              await guild.bans.remove(linkedPun.userId, `Reverted due to False Positive: ${req.user.username}`).catch(() => null);
            }
          }
        }

        const io = req.app.get('io');
        if (io) io.to(`guild_${guildId}`).emit('punishment_updated', linkedPun);
      }

      const linkedWarn = await Warning.findOneAndUpdate(
        { evidenceId, active: true },
        { 
          active: false, 
          falsePositive: true, 
          notes: `Revoked via False Positive warning delete by ${req.user.username}` 
        },
        { new: true }
      );
      if (linkedWarn) {
        await UserInfraction.findOneAndUpdate(
          { guildId, userId: linkedWarn.userId },
          { $inc: { warnings: -1 } }
        );
        
        const io = req.app.get('io');
        if (io) io.to(`guild_${guildId}`).emit('warning_updated', linkedWarn);
      }

    } else if (action === 'whitelist_pattern') {
      if (msg.originalContent) {
        const pattern = msg.originalContent.trim();
        if (!settings.whitelistedPatterns.includes(pattern)) {
          settings.whitelistedPatterns.push(pattern);
          await settings.save();
        }
        detailMsg = `Whitelisted message pattern: "${pattern}"`;
      }
    } else if (action === 'whitelist_user') {
      if (!settings.trustedUsers.includes(msg.userId)) {
        settings.trustedUsers.push(msg.userId);
        await settings.save();
      }
      detailMsg = `Whitelisted user ID: ${msg.userId} (${msg.username})`;
    } else if (action === 'whitelist_channel') {
      if (!settings.whitelistChannels.includes(msg.channelId)) {
        settings.whitelistChannels.push(msg.channelId);
        await settings.save();
      }
      detailMsg = `Whitelisted channel ID: ${msg.channelId} (#${msg.channelName})`;
    }

    await msg.save();

    const audit = new AuditLog({
      guildId,
      adminId: req.user.discordId || req.user.id || 'system',
      adminName: req.user.username,
      action: 'Marked False Positive',
      details: `Action: ${action}. Target Msg ID: ${msg.messageId}. ${detailMsg}`
    });
    await audit.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`guild_${guildId}`).emit('deleted_message_new', msg);
      io.to(`guild_${guildId}`).emit('settings_updated', settings);
    }

    res.json({ success: true, msg, settings });
  } catch (error) {
    console.error('False positive action error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// SOC NOTIFICATIONS API
// ==============================

// Fetch notifications
router.get('/notifications/:guildId', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const notifications = await Notification.find({ guildId })
      .sort({ timestamp: -1 })
      .limit(50);
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Mark all as read
router.post('/notifications/:guildId/read-all', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    await Notification.updateMany({ guildId, read: false }, { $set: { read: true } });
    
    // Fetch and return the updated notifications list
    const notifications = await Notification.find({ guildId })
      .sort({ timestamp: -1 })
      .limit(50);

    const io = req.app.get('io');
    if (io) {
      io.to(`guild_${guildId}`).emit('notifications_read_all', { guildId });
    }

    res.json({ success: true, notifications });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Mark single as read
router.post('/notifications/:guildId/:notificationId/read', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId, notificationId } = req.params;
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, guildId },
      { $set: { read: true } },
      { new: true }
    );
    res.json({ success: true, notification });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==============================
// SOC REAL-TIME DASHBOARD STATS API
// ==============================
router.get('/dashboard-stats/:guildId', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const stats = await recalculateDashboardStats(guildId);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==============================
// SOC HISTORY-SCANS RESULTS API
// ==============================
router.get('/history-scans/:guildId', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { search = '', riskLevel = '', actionTaken = '', page = 1, limit = 10 } = req.query;

    const query = { guildId };

    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { userId: { $regex: search, $options: 'i' } },
        { findings: { $regex: search, $options: 'i' } },
        { scanResults: { $regex: search, $options: 'i' } }
      ];
    }

    if (riskLevel) {
      query.riskLevel = riskLevel;
    }

    if (actionTaken) {
      query.actionTaken = actionTaken;
    }

    const total = await HistoryScan.countDocuments(query);
    const findings = await HistoryScan.find(query)
      .sort({ timestamp: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    res.json({
      findings,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==============================
// SOC UNIFIED MODERATION CENTER API
// ==============================
router.get('/moderation-center/:guildId', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    
    // Fetch recent unified moderation actions
    const recentActions = await ModerationAction.find({ guildId })
      .sort({ timestamp: -1 })
      .limit(50);

    // Fetch HistoryScan findings
    const historyScans = await HistoryScan.find({ guildId })
      .sort({ timestamp: -1 })
      .limit(50);

    res.json({
      recentActions,
      historyScans
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==============================
// SOC SERVER MANAGEMENT API
// ==============================
router.get('/server-management/:guildId', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    
    const client = req.app.get('discordClient');
    let memberCount = 0;
    if (client) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        memberCount = guild.memberCount;
      }
    }

    // Fetch counts from stats
    const stats = await recalculateDashboardStats(guildId);
    
    // Last activity: date of last log or warning or deleted message
    const lastLog = await Log.findOne({ guildId }).sort({ createdAt: -1 });
    const lastWarn = await Warning.findOne({ guildId }).sort({ createdAt: -1 });
    const lastDel = await DeletedMessage.findOne({ guildId }).sort({ deletedAt: -1 });

    const dates = [lastLog?.createdAt, lastWarn?.createdAt, lastDel?.deletedAt].filter(Boolean);
    const lastActivity = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : new Date();

    // calculate an overall risk score
    let riskScore = 0;
    if (stats) {
      riskScore = Math.min(100, Math.round(
        (stats.totalThreats * 10) + (stats.virusTotalDetections * 20) + (stats.usersFlagged * 15)
      ));
    }

    res.json({
      memberCount,
      scanCount: stats ? stats.totalScans : 0,
      threatCount: stats ? stats.totalThreats : 0,
      riskScore,
      lastActivity
    });
  } catch (error) {
    console.error('Error fetching server-management stats:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==============================
// PREMIUM LIMITS & LICENSING ENDPOINTS
// ==============================

// Fetch current daily usage and limits for a guild
router.get('/premium/:guildId/usage', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { getUsageForDay } = require('../helpers/usage');
    const usage = await getUsageForDay(guildId);
    res.json(usage);
  } catch (error) {
    console.error('Error fetching usage stats:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Export threat report as CSV (limited to 5 per day on Free tier)
router.get('/premium/:guildId/export', ensureAuthenticated, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { checkAndIncrementUsage } = require('../helpers/usage');

    // Check and increment threat reports usage limit
    const usageCheck = await checkAndIncrementUsage(guildId, 'threatReports');
    if (!usageCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Daily threat reports export limit reached',
        upgradeRequired: true
      });
    }

    // Fetch logs
    const logs = await Log.find({ guildId }).sort({ createdAt: -1 }).limit(1000);
    
    // Generate CSV
    let csv = 'User,Date,Threat Type,Severity,Action Taken,Reason,Details\n';
    logs.forEach(log => {
      const user = `"${(log.username || '').replace(/"/g, '""')}"`;
      const date = `"${new Date(log.createdAt || log.timestamp).toISOString()}"`;
      const category = `"${(log.detectionType || log.actionType || 'Unknown').replace(/"/g, '""')}"`;
      const severity = `"${(log.severity || 'medium').replace(/"/g, '""')}"`;
      const action = `"${(log.actionTaken || 'None').replace(/"/g, '""')}"`;
      const reason = `"${(log.reason || '').replace(/"/g, '""')}"`;
      const details = `"${(log.details || '').replace(/"/g, '""')}"`;
      csv += `${user},${date},${category},${severity},${action},${reason},${details}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=antify_threat_report_${guildId}.csv`);
    res.status(200).send(csv);
  } catch (error) {
    console.error('Error exporting logs:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==============================
// OWNER PREMIUM CONTROL PANEL ENDPOINTS
// ==============================

// Search and retrieve all guilds with license plans for the owner panel
router.get('/owner/guilds', ensureAuthenticated, async (req, res) => {
  try {
    const { OWNER_ID, isPremiumGuild } = require('../helpers/usage');
    if (req.user.discordId !== OWNER_ID) {
      return res.status(403).json({ error: 'Forbidden: Global Owner access required' });
    }

    const { search = '' } = req.query;
    let query = {};
    if (search) {
      query = { name: { $regex: search, $options: 'i' } };
    }

    const guilds = await Guild.find(query).limit(100);
    const client = req.app.get('discordClient');

    const result = await Promise.all(guilds.map(async (g) => {
      const license = await License.findOne({ guildId: g.guildId });
      const sub = await Subscription.findOne({ guildId: g.guildId });

      let tier = 'Free';
      let expiresAt = null;
      let source = 'Manual';

      if (license && license.plan === 'Pro') {
        if (!license.expiresAt || new Date(license.expiresAt) > new Date()) {
          tier = 'Pro';
          expiresAt = license.expiresAt;
          source = license.source;
        }
      } else if (sub && (sub.plan === 'Pro' || sub.plan === 'Enterprise') && sub.status === 'active') {
        if (!sub.expiresAt || new Date(sub.expiresAt) > new Date()) {
          tier = 'Pro';
          expiresAt = sub.expiresAt;
          source = 'Stripe';
        }
      }

      const isOnline = client ? client.guilds.cache.has(g.guildId) : false;

      return {
        guildId: g.guildId,
        name: g.name,
        icon: g.icon ? `https://cdn.discordapp.com/icons/${g.guildId}/${g.icon}.png` : null,
        ownerId: g.ownerId,
        tier,
        expiresAt,
        source,
        isOnline
      };
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching owner guilds:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Grant or remove premium license for a guild
router.post('/owner/premium', ensureAuthenticated, async (req, res) => {
  try {
    const { OWNER_ID } = require('../helpers/usage');
    if (req.user.discordId !== OWNER_ID) {
      return res.status(403).json({ error: 'Forbidden: Global Owner access required' });
    }

    const { guildId, action, duration } = req.body;
    if (!guildId) {
      return res.status(400).json({ error: 'Guild ID is required' });
    }

    if (action === 'remove') {
      await License.deleteOne({ guildId });
      
      let guild = await Guild.findOne({ guildId });
      if (guild) {
        guild.premiumStatus = 'Basic';
        await guild.save();
      }

      // Socket broadcast
      const client = req.app.get('discordClient');
      if (client && client.io) {
        client.io.emit('premium_status_update', { guildId, isPremium: false, tier: 'Free' });
      }

      return res.json({ success: true, message: 'Premium license removed' });
    }

    // Grant
    let expiresAt = null;
    if (duration === '7d') {
      expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    } else if (duration === '30d') {
      expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    } else if (duration === '90d') {
      expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    }

    let license = await License.findOne({ guildId });
    if (!license) {
      license = new License({ guildId });
    }
    license.plan = 'Pro';
    license.expiresAt = expiresAt;
    license.grantedBy = req.user.discordId;
    license.source = 'Manual';
    await license.save();

    let guild = await Guild.findOne({ guildId });
    if (guild) {
      guild.premiumStatus = 'Pro';
      await guild.save();
    }

    // Socket broadcast
    const client = req.app.get('discordClient');
    if (client && client.io) {
      client.io.emit('premium_status_update', { guildId, isPremium: true, tier: 'Pro' });
    }

    res.json({
      success: true,
      message: `Premium status granted successfully (${duration})`,
      expiresAt
    });
  } catch (error) {
    console.error('Error managing premium license:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
