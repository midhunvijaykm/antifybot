const Tesseract = require('tesseract.js');
const axios = require('axios');
const { PermissionsBitField } = require('discord.js');
const { Log, DetectionLog, UserInfraction, GuildAnalytics, Settings, DeletedMessage, Punishment, Warning, HistoricalScanJob, ThreatEvent, ModerationAction, HistoryScan } = require('../models');
const { createNotification } = require('./notifier');
const { recalculateDashboardStats } = require('./statsUpdater');

// Global active scans map (for backwards compatibility status check)
const activeScans = new Map();

const scamKeywords = [
  "free nitro",
  "crypto",
  "usdt",
  "withdrawal",
  "bonus",
  "wallet",
  "claim reward",
  "deposit",
  "promo code",
  "mrbeast",
  "elon musk",
  "gift",
  "btc",
  "eth",
  "telegram",
  "airdrop"
];

const badDomains = [
  ".xyz",
  ".click",
  ".top",
  ".gq"
];

// Normalize text
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/@/g, 'a')
    .replace(/[^a-z0-9 ]/g, '');
}

// Scam detection
function isScam(text, settings) {
  text = normalize(text);
  const customKeywords = settings?.blacklistKeywords || [];
  const allKeywords = [...scamKeywords, ...customKeywords];
  return allKeywords.some(word =>
    text.includes(word.toLowerCase())
  );
}

// URL extraction
function extractUrls(text) {
  return text.match(/https?:\/\/[^\s]+/g);
}

// Bad domain detection
function hasBadDomain(url) {
  return badDomains.some(domain =>
    url.includes(domain)
  );
}

// Contextual scoring helper
function calculateScamScore(text, settings) {
  if (!text) return 0;

  // Whitelisted patterns check (bypass scoring entirely if matched)
  if (settings && settings.whitelistedPatterns && settings.whitelistedPatterns.length > 0) {
    const textLower = text.toLowerCase();
    const hasMatch = settings.whitelistedPatterns.some(pattern => 
      textLower.includes(pattern.toLowerCase())
    );
    if (hasMatch) {
      console.log(`[Scanner] Message matched whitelisted pattern. Scam score set to 0.`);
      return 0;
    }
  }

  const normalizedText = normalize(text);
  let score = 0;
  
  // Custom blacklist keywords & global scam keywords
  const customKeywords = settings?.blacklistKeywords || [];
  const allKeywords = [...scamKeywords, ...customKeywords];
  
  allKeywords.forEach(word => {
    if (normalizedText.includes(word.toLowerCase())) {
      score += 20; // +20 per keyword match
    }
  });

  // Promote list (strongly increase scam confidence)
  const lowerText = text.toLowerCase();
  if (lowerText.includes("free nitro")) score += 40;
  if (lowerText.includes("free steam")) score += 40;
  if (lowerText.includes("nude leaks") || lowerText.includes("nudes") || lowerText.includes("nude leak")) score += 45;
  
  // Bad domains inside text
  const urls = extractUrls(text);
  if (urls) {
    urls.forEach(url => {
      if (hasBadDomain(url)) {
        score += 40;
      }
    });
    // Mass links check (>= 2 links)
    if (urls.length >= 2) {
      score += 35;
    }
  }

  // Safe Context mitigating terms
  if (lowerText.includes("beware")) score -= 30;
  if (lowerText.includes("warning") || lowerText.includes("warn")) score -= 30;
  if (lowerText.includes("stay safe")) score -= 30;
  if (lowerText.includes("avoid")) score -= 30;
  if (lowerText.includes("do not click") || lowerText.includes("dont click")) score -= 45;
  if (lowerText.includes("scam alert")) score -= 45;
  if (lowerText.includes("phishing alert")) score -= 45;
  if (lowerText.includes("educational context") || lowerText.includes("educational purpose") || lowerText.includes("educational")) score -= 40;

  // Clamp score between 0 and 100
  score = Math.max(0, Math.min(100, score));
  return score;
}

// Trust system bypass helper
function shouldBypass(message, member, settings) {
  if (!message || !settings) return false;

  const authorId = message.author ? message.author.id : (message.userId || null);
  const channelId = message.channel ? message.channel.id : (message.channelId || null);

  // 1. Whitelisted Users
  if (authorId && settings.trustedUsers && settings.trustedUsers.includes(authorId)) {
    return true;
  }

  // 2. Whitelisted/Trusted Channels
  if (channelId) {
    if (settings.whitelistChannels && settings.whitelistChannels.includes(channelId)) {
      return true;
    }
    if (settings.announcementChannels && settings.announcementChannels.includes(channelId)) {
      return true;
    }
  }

  // 3. Announcement channels (type 5 is GuildAnnouncement)
  if (message.channel && (message.channel.type === 5 || message.channel.type === 'GuildAnnouncement' || message.channel.type === 'GuildNews')) {
    return true;
  }

  // 4. Trusted Roles
  if (settings.trustedRoles && settings.trustedRoles.length > 0 && member && member.roles && member.roles.cache) {
    const hasTrustedRole = settings.trustedRoles.some(roleId => member.roles.cache.has(roleId));
    if (hasTrustedRole) {
      return true;
    }
  }

  // 5. Explicit Admin Bypass (only if bypassAdmins is enabled and strictMode is off)
  if (settings.bypassAdmins && !settings.strictMode && member && member.permissions) {
    if (
      member.permissions.has(PermissionsBitField.Flags.Administrator) ||
      member.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
      member.permissions.has(PermissionsBitField.Flags.ManageGuild)
    ) {
      return true;
    }
  }

  return false;
}

// VirusTotal Scan
async function scanUrl(url, guildId) {
  try {
    if (!process.env.VT_API_KEY) return false;
    if (guildId) {
      const { checkAndIncrementUsage } = require('./usage');
      const vtCheck = await checkAndIncrementUsage(guildId, 'virusTotalRequests');
      if (!vtCheck.allowed) {
        console.log(`[Scanner] Daily VirusTotal limit reached for guild ${guildId}. Skipping VT lookup.`);
        return false;
      }
    }
    const submit = await axios.post(
      'https://www.virustotal.com/api/v3/urls',
      new URLSearchParams({ url }),
      {
        headers: {
          'x-apikey': process.env.VT_API_KEY
        }
      }
    );

    const analysisId = submit.data.data.id;

    const result = await axios.get(
      `https://www.virustotal.com/api/v3/analyses/${analysisId}`,
      {
        headers: {
          'x-apikey': process.env.VT_API_KEY
        }
      }
    );

    const stats = result.data.data.attributes.stats;
    return stats.malicious > 0;

  } catch (err) {
    console.log("VirusTotal Error in scanner:", err.message);
    return false;
  }
}

// Pipeline to check individual messages
async function runDetectionPipeline(message, settings) {
  if (!message.content && (!message.attachments || message.attachments.size === 0)) {
    return null;
  }

  // 1. Trust system check
  if (shouldBypass(message, message.member, settings)) {
    console.log(`[Scanner] Bypassing scan for trusted user/channel: ${message.author?.tag || message.userId} in #${message.channel?.name || message.channelId}`);
    return null;
  }

  const sensitivity = settings.scanSensitivity !== undefined ? settings.scanSensitivity : 50;

  // ==========================
  // TEXT SCAN
  // ==========================
  if (message.content) {
    const scamScore = calculateScamScore(message.content, settings);
    if (scamScore >= sensitivity) {
      const matched = [];
      const normalizedText = normalize(message.content);
      const customKeywords = settings?.blacklistKeywords || [];
      [...scamKeywords, ...customKeywords].forEach(word => {
        if (normalizedText.includes(word.toLowerCase())) {
          matched.push(word);
        }
      });

      return {
        type: 'Spam Words',
        severity: scamScore >= 85 ? 'critical' : (scamScore >= 65 ? 'high' : 'medium'),
        reason: `Scam text detected (Score: ${scamScore})`,
        scamScore: scamScore,
        detectionCategory: 'Spam',
        matchedKeywords: matched,
        imageDetected: false,
        AIConfidence: scamScore
      };
    }
  }

  // ==========================
  // LINK SCAN
  // ==========================
  if (message.content) {
    const urls = extractUrls(message.content);
    if (urls) {
      for (const url of urls) {
        if (hasBadDomain(url)) {
          const scamScore = calculateScamScore(message.content, settings);
          if (scamScore >= sensitivity) {
            return {
              type: 'Phishing Link',
              severity: 'high',
              reason: `Suspicious domain detected (Score: ${scamScore})`,
              scamScore: scamScore,
              detectionCategory: 'Phishing',
              matchedKeywords: [url],
              imageDetected: false,
              AIConfidence: scamScore
            };
          }
        }

        const malicious = await scanUrl(url, settings.guildId);
        if (malicious) {
          return {
            type: 'Phishing Link',
            severity: 'critical',
            reason: 'Malicious link detected',
            scamScore: 98,
            detectionCategory: 'Phishing',
            matchedKeywords: [url],
            imageDetected: false,
            AIConfidence: 98
          };
        }
      }
    }
  }

  // ==========================
  // IMAGE OCR SCAN
  // ==========================
  if (settings.ocrEnabled && message.attachments && message.attachments.size > 0) {
    const { checkAndIncrementUsage } = require('./usage');
    const ocrCheck = await checkAndIncrementUsage(settings.guildId, 'imageScans');
    if (!ocrCheck.allowed) {
      console.log(`[Scanner] Daily image scan limit reached for guild ${settings.guildId}. Skipping OCR.`);
      return {
        success: false,
        error: "Daily image scan limit reached",
        upgradeRequired: true
      };
    }
    for (const attachment of message.attachments.values()) {
      const isImg = attachment.contentType?.startsWith('image') || 
                    attachment.name?.match(/\.(png|jpg|jpeg|gif|webp)$/i);
      if (isImg) {
        try {
          console.log(`[Scanner] OCR Analyzing old image: ${attachment.url}`);
          const result = await Tesseract.recognize(attachment.url, 'eng');
          const extractedText = result.data.text;

          const scamScore = calculateScamScore(extractedText, settings);
          if (scamScore >= sensitivity) {
            const matched = [];
            const normalizedText = normalize(extractedText);
            const customKeywords = settings?.blacklistKeywords || [];
            [...scamKeywords, ...customKeywords].forEach(word => {
              if (normalizedText.includes(word.toLowerCase())) {
                matched.push(word);
              }
            });

            return {
              type: 'Scam Image',
              severity: scamScore >= 85 ? 'critical' : (scamScore >= 65 ? 'high' : 'medium'),
              reason: `Scam text inside image detected (Score: ${scamScore})`,
              scamScore: scamScore,
              detectionCategory: 'OCR',
              matchedKeywords: matched,
              OCRText: extractedText,
              imageDetected: true,
              AIConfidence: scamScore
            };
          }

          const imageUrls = extractUrls(extractedText);
          if (imageUrls) {
            for (const url of imageUrls) {
              if (hasBadDomain(url)) {
                const scamScore = calculateScamScore(extractedText, settings);
                if (scamScore >= sensitivity) {
                  return {
                    type: 'Scam Image',
                    severity: 'high',
                    reason: `Bad domain inside image detected (Score: ${scamScore})`,
                    scamScore: scamScore,
                    detectionCategory: 'OCR',
                    matchedKeywords: [url],
                    OCRText: extractedText,
                    imageDetected: true,
                    AIConfidence: scamScore
                  };
                }
              }

              const malicious = await scanUrl(url, settings.guildId);
              if (malicious) {
                return {
                  type: 'Scam Image',
                  severity: 'critical',
                  reason: 'Malicious URL inside image detected',
                  scamScore: 98,
                  detectionCategory: 'OCR',
                  matchedKeywords: [url],
                  OCRText: extractedText,
                  imageDetected: true,
                  AIConfidence: 98
                };
              }
            }
          }
        } catch (ocrErr) {
          console.error('[Scanner] OCR Tesseract error:', ocrErr.message);
        }
      }
    }
  }

  return null;
}

// Update User Infractions
async function updateUserInfraction(guildId, userId, actionTaken, type, timestamp, io = null) {
  const isBan = actionTaken === 'Banned';
  const isKick = actionTaken === 'Kicked';
  const isMute = actionTaken === 'Muted';
  const isWarning = actionTaken === 'Warned';
  
  const isPhishing = type === 'Phishing Link';
  const isScam = type === 'Spam Words' || type === 'Scam Image';

  const incFields = {};
  if (isBan) incFields.bans = 1;
  if (isKick) incFields.kicks = 1;
  if (isMute) incFields.mutes = 1;
  if (isWarning) incFields.warnings = 1;
  if (isPhishing) incFields.phishingAttempts = 1;
  if (isScam) incFields.scamAttempts = 1;

  const isNew = !(await UserInfraction.exists({ guildId, userId }));

  const infraction = await UserInfraction.findOneAndUpdate(
    { guildId, userId },
    {
      $inc: incFields,
      $set: { lastViolation: timestamp, lastInfraction: timestamp }
    },
    { upsert: true, new: true }
  );

  // Calculate risk level
  let riskScore = 0;
  riskScore += (infraction.warnings || 0) * 10;
  riskScore += (infraction.mutes || 0) * 40;
  riskScore += (infraction.kicks || 0) * 70;
  riskScore += (infraction.bans || 0) * 100;
  riskScore += (infraction.scamAttempts || 0) * 15;
  riskScore += (infraction.phishingAttempts || 0) * 30;

  let riskLevel = 'Low';
  if (riskScore >= 75) riskLevel = 'Critical';
  else if (riskScore >= 45) riskLevel = 'High';
  else if (riskScore >= 20) riskLevel = 'Medium';

  const prevRiskLevel = infraction.riskLevel;
  infraction.riskLevel = riskLevel;
  await infraction.save();

  // Create notifications
  if (isNew) {
    await createNotification(guildId, {
      title: 'User Added to Offender Database',
      message: `User ${userId} was registered in the offender intelligence database.`,
      type: 'offender',
      severity: 'medium',
      userId
    }, io);
  }

  if ((riskLevel === 'High' || riskLevel === 'Critical') && prevRiskLevel !== riskLevel) {
    await createNotification(guildId, {
      title: 'User Risk Level Escalated',
      message: `User ${userId} threat status escalated to ${riskLevel} risk level.`,
      type: 'flagged_user',
      severity: riskLevel === 'Critical' ? 'critical' : 'high',
      userId
    }, io);
  }
}

// Update Guild Analytics - scans increment
async function updateGuildAnalyticsScanned(guildId, timestamp) {
  const dateStr = timestamp.toISOString().split('T')[0];
  const dateObj = new Date(timestamp);
  
  const getWeekStr = (d) => {
    const onejan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil((((d.getTime() - onejan.getTime()) / 86400000) + onejan.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
  };
  const weekStr = getWeekStr(dateObj);
  const monthStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;

  await GuildAnalytics.findOneAndUpdate(
    { guildId },
    { 
      $inc: { 
        totalScans: 1, 
        totalMessagesScanned: 1 
      } 
    },
    { upsert: true }
  );

  const statsInc = { scans: 1, messagesScanned: 1 };

  // Daily
  let resDaily = await GuildAnalytics.updateOne(
    { guildId, 'dailyStats.date': dateStr },
    { $inc: statsInc }
  );
  if (resDaily.matchedCount === 0) {
    await GuildAnalytics.updateOne(
      { guildId },
      {
        $push: {
          dailyStats: {
            date: dateStr,
            messagesScanned: 1,
            scans: 1,
            detections: 0,
            deletedMessages: 0,
            punishments: 0,
            warnings: 0,
            bans: 0,
            kicks: 0,
            phishingBlocked: 0,
            scamsBlocked: 0
          }
        }
      }
    );
  }

  // Weekly
  let resWeekly = await GuildAnalytics.updateOne(
    { guildId, 'weeklyStats.week': weekStr },
    { $inc: statsInc }
  );
  if (resWeekly.matchedCount === 0) {
    await GuildAnalytics.updateOne(
      { guildId },
      {
        $push: {
          weeklyStats: {
            week: weekStr,
            messagesScanned: 1,
            scans: 1,
            detections: 0,
            deletedMessages: 0,
            punishments: 0,
            warnings: 0,
            bans: 0,
            kicks: 0,
            phishingBlocked: 0,
            scamsBlocked: 0
          }
        }
      }
    );
  }

  // Monthly
  let resMonthly = await GuildAnalytics.updateOne(
    { guildId, 'monthlyStats.month': monthStr },
    { $inc: statsInc }
  );
  if (resMonthly.matchedCount === 0) {
    await GuildAnalytics.updateOne(
      { guildId },
      {
        $push: {
          monthlyStats: {
            month: monthStr,
            messagesScanned: 1,
            scans: 1,
            detections: 0,
            deletedMessages: 0,
            punishments: 0,
            warnings: 0,
            bans: 0,
            kicks: 0,
            phishingBlocked: 0,
            scamsBlocked: 0
          }
        }
      }
    );
  }
}

// Update Guild Analytics - detections / deletions
async function updateGuildAnalyticsDetection(guildId, detectionType, actionTaken, timestamp, channel = null) {
  const dateStr = timestamp.toISOString().split('T')[0];
  const dateObj = new Date(timestamp);
  
  const getWeekStr = (d) => {
    const onejan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil((((d.getTime() - onejan.getTime()) / 86400000) + onejan.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
  };
  const weekStr = getWeekStr(dateObj);
  const monthStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;

  const isPhishing = detectionType === 'Phishing Link';
  const isScamLink = detectionType === 'Spam Words' || detectionType === 'Scam Image';
  const isBan = actionTaken === 'Banned';
  const isKick = actionTaken === 'Kicked';
  const isWarning = actionTaken === 'Warned';
  const isPunishment = ['Banned', 'Kicked', 'Muted'].includes(actionTaken);

  // Determine channel metrics
  let channelType = 'GuildText';
  let isVoice = false;
  let isThread = false;
  let isForum = false;

  if (channel) {
    const rawType = channel.type;
    const channelTypeMap = {
      0: 'GuildText', 'GuildText': 'GuildText',
      2: 'GuildVoice', 'GuildVoice': 'GuildVoice',
      5: 'GuildAnnouncement', 'GuildAnnouncement': 'GuildAnnouncement', 'GuildNews': 'GuildAnnouncement',
      10: 'AnnouncementThread', 'AnnouncementThread': 'AnnouncementThread',
      11: 'PublicThread', 'PublicThread': 'PublicThread',
      12: 'PrivateThread', 'PrivateThread': 'PrivateThread',
      13: 'GuildStageVoice', 'GuildStageVoice': 'GuildStageVoice', 'GuildStage': 'GuildStageVoice',
      15: 'GuildForum', 'GuildForum': 'GuildForum',
      16: 'GuildMedia', 'GuildMedia': 'GuildMedia'
    };
    channelType = channelTypeMap[rawType] || 'GuildText';

    isVoice = channelType === 'GuildVoice' || channelType === 'GuildStageVoice';
    isThread = typeof channel.isThread === 'function' ? channel.isThread() : [10, 11, 12].includes(rawType);
    
    if (isThread && channel.parent) {
      const parentType = channel.parent.type;
      isForum = parentType === 15 || parentType === 'GuildForum' || parentType === 16 || parentType === 'GuildMedia';
    }
  }

  const incFields = { 
    totalDetections: 1,
    totalDeletedMessages: 1
  };
  if (isPunishment) incFields.totalPunishments = 1;
  if (isWarning) incFields.totalWarnings = 1;
  if (isBan) incFields.totalBans = 1;
  if (isKick) incFields.totalKicks = 1;
  
  if (isPhishing) {
    incFields.phishingBlocked = 1;
    incFields.totalPhishingBlocked = 1;
  }
  if (isScamLink) {
    incFields.scamsBlocked = 1;
    incFields.totalScamLinksBlocked = 1;
  }

  // Multi-channel updates
  incFields[`detectionsByChannelType.${channelType}`] = 1;
  
  if (isVoice) {
    incFields.voiceScamAttempts = 1;
  }
  if (isThread) {
    incFields.threadPhishingAttempts = 1;
  }
  if (isForum) {
    incFields.forumModerationStats = 1;
  }

  await GuildAnalytics.findOneAndUpdate(
    { guildId },
    { $inc: incFields },
    { upsert: true }
  );

  const subInc = { 
    detections: 1, 
    deletedMessages: 1 
  };
  if (isPunishment) subInc.punishments = 1;
  if (isWarning) subInc.warnings = 1;
  if (isBan) subInc.bans = 1;
  if (isKick) subInc.kicks = 1;
  if (isPhishing) subInc.phishingBlocked = 1;
  if (isScamLink) subInc.scamsBlocked = 1;

  subInc[`detectionsByChannelType.${channelType}`] = 1;
  if (isVoice) subInc.voiceScamAttempts = 1;
  if (isThread) subInc.threadPhishingAttempts = 1;
  if (isForum) subInc.forumModerationStats = 1;

  // Daily
  let existsDaily = await GuildAnalytics.findOne({ guildId, 'dailyStats.date': dateStr });
  if (!existsDaily) {
    await GuildAnalytics.updateOne(
      { guildId },
      {
        $push: {
          dailyStats: {
            date: dateStr,
            messagesScanned: 0,
            scans: 0,
            detections: 0,
            deletedMessages: 0,
            punishments: 0,
            warnings: 0,
            bans: 0,
            kicks: 0,
            phishingBlocked: 0,
            scamsBlocked: 0,
            voiceScamAttempts: 0,
            threadPhishingAttempts: 0,
            forumModerationStats: 0,
            detectionsByChannelType: {
              'GuildText': 0, 'GuildVoice': 0, 'PublicThread': 0, 'PrivateThread': 0,
              'GuildForum': 0, 'GuildAnnouncement': 0, 'GuildMedia': 0, 'GuildStageVoice': 0, 'AnnouncementThread': 0
            }
          }
        }
      }
    );
  }
  
  const dailyIncObj = {};
  Object.keys(subInc).forEach(k => {
    dailyIncObj[`dailyStats.$.${k}`] = subInc[k];
  });
  await GuildAnalytics.updateOne(
    { guildId, 'dailyStats.date': dateStr },
    { $inc: dailyIncObj }
  );

  // Weekly
  let existsWeekly = await GuildAnalytics.findOne({ guildId, 'weeklyStats.week': weekStr });
  if (!existsWeekly) {
    await GuildAnalytics.updateOne(
      { guildId },
      {
        $push: {
          weeklyStats: {
            week: weekStr,
            messagesScanned: 0,
            scans: 0,
            detections: 0,
            deletedMessages: 0,
            punishments: 0,
            warnings: 0,
            bans: 0,
            kicks: 0,
            phishingBlocked: 0,
            scamsBlocked: 0,
            voiceScamAttempts: 0,
            threadPhishingAttempts: 0,
            forumModerationStats: 0,
            detectionsByChannelType: {
              'GuildText': 0, 'GuildVoice': 0, 'PublicThread': 0, 'PrivateThread': 0,
              'GuildForum': 0, 'GuildAnnouncement': 0, 'GuildMedia': 0, 'GuildStageVoice': 0, 'AnnouncementThread': 0
            }
          }
        }
      }
    );
  }
  const weeklyIncObj = {};
  Object.keys(subInc).forEach(k => {
    weeklyIncObj[`weeklyStats.$.${k}`] = subInc[k];
  });
  await GuildAnalytics.updateOne(
    { guildId, 'weeklyStats.week': weekStr },
    { $inc: weeklyIncObj }
  );

  // Monthly
  let existsMonthly = await GuildAnalytics.findOne({ guildId, 'monthlyStats.month': monthStr });
  if (!existsMonthly) {
    await GuildAnalytics.updateOne(
      { guildId },
      {
        $push: {
          monthlyStats: {
            month: monthStr,
            messagesScanned: 0,
            scans: 0,
            detections: 0,
            deletedMessages: 0,
            punishments: 0,
            warnings: 0,
            bans: 0,
            kicks: 0,
            phishingBlocked: 0,
            scamsBlocked: 0,
            voiceScamAttempts: 0,
            threadPhishingAttempts: 0,
            forumModerationStats: 0,
            detectionsByChannelType: {
              'GuildText': 0, 'GuildVoice': 0, 'PublicThread': 0, 'PrivateThread': 0,
              'GuildForum': 0, 'GuildAnnouncement': 0, 'GuildMedia': 0, 'GuildStageVoice': 0, 'AnnouncementThread': 0
            }
          }
        }
      }
    );
  }
  const monthlyIncObj = {};
  Object.keys(subInc).forEach(k => {
    monthlyIncObj[`monthlyStats.$.${k}`] = subInc[k];
  });
  await GuildAnalytics.updateOne(
    { guildId, 'monthlyStats.month': monthStr },
    { $inc: monthlyIncObj }
  );
}

// Unified archive & moderation logging pipeline (7-step flow)
async function archiveAndActionMessage(message, detection, moderatorId = null) {
  try {
    const guildId = message.guildId;
    const settings = await Settings.findOne({ guildId }) || new Settings({ guildId });

    let action = 'Warned';
    if (settings.autoBan) action = 'Banned';
    else if (settings.autoKick) action = 'Kicked';
    else if (settings.autoTimeout) action = 'Muted';

    const timestamp = message.createdAt || new Date();

    // Resolve channel type & parent contexts
    const channel = message.channel;
    const rawType = channel ? channel.type : 0;
    const channelTypeMap = {
      0: 'GuildText', 'GuildText': 'GuildText',
      2: 'GuildVoice', 'GuildVoice': 'GuildVoice',
      5: 'GuildAnnouncement', 'GuildAnnouncement': 'GuildAnnouncement', 'GuildNews': 'GuildAnnouncement',
      10: 'AnnouncementThread', 'AnnouncementThread': 'AnnouncementThread',
      11: 'PublicThread', 'PublicThread': 'PublicThread',
      12: 'PrivateThread', 'PrivateThread': 'PrivateThread',
      13: 'GuildStageVoice', 'GuildStageVoice': 'GuildStageVoice', 'GuildStage': 'GuildStageVoice',
      15: 'GuildForum', 'GuildForum': 'GuildForum',
      16: 'GuildMedia', 'GuildMedia': 'GuildMedia'
    };
    const channelType = channelTypeMap[rawType] || 'GuildText';

    let parentChannelId = channel ? channel.parentId : null;
    let parentChannelName = null;
    if (channel && channel.parent) {
      parentChannelName = channel.parent.name;
    }

    let threadId = null;
    let voiceChannelId = null;
    let forumPostId = null;

    const isThread = channel && (typeof channel.isThread === 'function' ? channel.isThread() : [10, 11, 12].includes(rawType));

    if (isThread) {
      threadId = channel.id;
      if (channel.parent) {
        const parentType = channel.parent.type;
        if (parentType === 15 || parentType === 'GuildForum' || parentType === 16 || parentType === 'GuildMedia') {
          forumPostId = channel.id;
        }
      }
    } else if (channelType === 'GuildVoice' || channelType === 'GuildStageVoice') {
      voiceChannelId = channel.id;
    }

    // 1. Archive Message BEFORE deletion
    const archivedMsg = new DeletedMessage({
      guildId,
      guildName: message.guild ? message.guild.name : 'Unknown Guild',
      channelId: message.channel.id,
      channelName: message.channel.name,
      userId: message.author.id,
      username: message.author.tag,
      displayName: message.member ? message.member.displayName : message.author.username,
      avatar: message.author.avatar,
      messageId: message.id,
      originalContent: message.content || '',
      attachments: Array.from(message.attachments.values()).map(a => a.url),
      embeds: message.embeds || [],
      detectionType: detection.type,
      scamScore: detection.scamScore || 75,
      matchedKeywords: detection.matchedKeywords || [],
      aiConfidence: detection.AIConfidence || 80,
      deletionReason: detection.reason,
      deletedBy: moderatorId || message.client.user.id,
      createdAt: timestamp,
      deletedAt: new Date(),

      // Multi-channel attributes
      channelType,
      parentChannelId,
      parentChannelName,
      threadId,
      voiceChannelId,
      forumPostId
    });
    await archivedMsg.save();

    // 2. Save Detection Log
    const isPhishing = detection.type === 'Phishing Link';
    const isScam = detection.type === 'Spam Words' || detection.type === 'Scam Image';

    const detLog = new DetectionLog({
      guildId,
      userId: message.author.id,
      messageId: message.id,
      content: message.content || '',
      detectionCategory: detection.detectionCategory,
      aiScore: detection.AIConfidence || detection.scamScore || 80,
      phishingDetected: isPhishing,
      scamDetected: isScam,
      suspiciousLinks: isPhishing ? detection.matchedKeywords : [],
      OCRText: detection.OCRText || '',
      actionTaken: action,
      createdAt: timestamp,

      // Multi-channel attributes
      channelType,
      parentChannelId,
      parentChannelName,
      threadId,
      voiceChannelId,
      forumPostId,
      
      // Backward compatibility fields
      messageContent: message.content || '',
      scamScore: detection.scamScore || 75,
      matchedKeywords: detection.matchedKeywords || [],
      imageDetected: detection.imageDetected || false,
      AIConfidence: detection.AIConfidence || 80
    });
    await detLog.save();

    // 3. Save Moderation Log
    const modLog = new Log({
      guildId,
      userId: message.author.id,
      username: message.author.tag,
      moderatorId: moderatorId || message.client.user.id,
      actionType: action,
      punishmentType: action === 'Warned' ? 'Warning' : (action === 'Muted' ? 'Timeout' : (action === 'Kicked' ? 'Kick' : 'Ban')),
      reason: detection.reason,
      severity: detection.severity || 'medium',
      evidence: message.content || '[Image/Attachment]',
      createdAt: timestamp,

      // Multi-channel attributes
      channelType,
      parentChannelId,
      parentChannelName,
      threadId,
      voiceChannelId,
      forumPostId,
      
      // Backward compatibility fields
      guildName: message.guild ? message.guild.name : 'Unknown Guild',
      type: detection.type,
      actionTaken: action,
      details: `Reason: ${detection.reason} | Match: ${message.content ? message.content.substring(0, 200) : '[Attachment]'}`,
      timestamp: timestamp,
      messageContent: message.content || '',
      channelId: message.channel.id,
      channelName: message.channel.name,
      attachments: Array.from(message.attachments.values()).map(a => a.url),
      detectionType: detection.type
    });
    await modLog.save();

    // Create Warning or Punishment record
    let linkedPun = null;
    let linkedWarn = null;
    if (action === 'Banned' || action === 'Kicked' || action === 'Muted') {
      const pun = new Punishment({
        guildId,
        userId: message.author.id,
        username: message.author.tag,
        type: action === 'Muted' ? 'Timeout' : (action === 'Kicked' ? 'Kick' : 'Ban'),
        reason: detection.reason,
        duration: action === 'Muted' ? 5 * 60 * 1000 : null,
        moderatorId: moderatorId || message.client.user.id,
        active: true,
        expired: false,
        reversible: ['Timeout', 'Ban'].includes(action),
        notes: 'Automated cybersecurity moderation trigger.',
        appealStatus: 'None',
        evidenceId: archivedMsg._id
      });
      linkedPun = await pun.save();
    } else {
      const warn = new Warning({
        guildId,
        userId: message.author.id,
        username: message.author.tag,
        reason: detection.reason,
        moderatorId: moderatorId || message.client.user.id,
        active: true,
        notes: 'Automated cybersecurity moderation warning.',
        evidenceId: archivedMsg._id
      });
      linkedWarn = await warn.save();
    }

    const io = message.client.io;

    // 4. Update User Infractions
    await updateUserInfraction(guildId, message.author.id, action, detection.type, timestamp, io);

    // 5. Update Guild Analytics
    await updateGuildAnalyticsDetection(guildId, detection.type, action, timestamp, message.channel);

    // Create ThreatEvent
    const threatEvent = new ThreatEvent({
      guildId,
      userId: message.author.id,
      username: message.author.tag,
      type: detection.type,
      severity: detection.severity || 'medium',
      details: detection.reason,
      evidence: message.content || '[Image/Attachment]',
      timestamp
    });
    await threatEvent.save();

    // Create unified ModerationAction
    const modAction = new ModerationAction({
      guildId,
      userId: message.author.id,
      username: message.author.tag,
      moderatorId: moderatorId || message.client.user.id,
      actionType: action === 'Warned' ? 'Warning' : (action === 'Muted' ? 'Timeout' : (action === 'Kicked' ? 'Kick' : 'Ban')),
      reason: detection.reason,
      duration: action === 'Muted' ? 5 * 60 * 1000 : null,
      evidenceId: archivedMsg._id,
      timestamp
    });
    await modAction.save();

    // Create notifications for malware, VirusTotal positive, suspicious files, and moderation actions
    const isVT = detection.reason.toLowerCase().includes('virustotal') || detection.reason.toLowerCase().includes('malicious link') || detection.reason.toLowerCase().includes('malicious url');
    const isMalware = isVT || detection.type === 'Malicious File' || detection.type === 'Malware';

    let notifType = 'moderation';
    let notifSeverity = 'medium';
    let notifTitle = `Moderation: ${action}`;

    if (isMalware) {
      notifType = 'malware';
      notifSeverity = 'critical';
      notifTitle = 'Malware Blocked';
    } else if (isVT) {
      notifType = 'virustotal';
      notifSeverity = 'critical';
      notifTitle = 'VirusTotal Detection Alert';
    } else if (detection.type === 'Scam Image' || message.attachments.size > 0) {
      notifType = 'suspicious_file';
      notifSeverity = 'high';
      notifTitle = 'Suspicious File Flagged';
    }

    await createNotification(guildId, {
      title: notifTitle,
      message: `User ${message.author.tag} in #${message.channel.name} triggered: ${detection.reason} (${action})`,
      type: notifType,
      severity: notifSeverity,
      userId: message.author.id,
      evidenceId: archivedMsg._id
    }, io);

    await createNotification(guildId, {
      title: `Moderation Action Taken`,
      message: `${action}: ${message.author.tag} in #${message.channel.name} - ${detection.reason}`,
      type: 'moderation',
      severity: action === 'Banned' ? 'high' : 'medium',
      userId: message.author.id,
      evidenceId: archivedMsg._id
    }, io);

    // 6. Emit Socket.io alerts
    if (io) {
      io.to(`guild_${guildId}`).emit('deleted_message_new', archivedMsg);
      io.to(`guild_${guildId}`).emit('log_new', modLog);
      if (linkedPun) {
        io.to(`guild_${guildId}`).emit('punishment_updated', linkedPun);
      }
      if (linkedWarn) {
        io.to(`guild_${guildId}`).emit('warning_updated', linkedWarn);
      }
      
      const totalDetections = await Log.countDocuments({ guildId });
      const totalDeletedMessages = await DeletedMessage.countDocuments({ guildId });
      const totalBans = await Punishment.countDocuments({ guildId, type: 'Ban' });
      const totalTimeouts = await Punishment.countDocuments({ guildId, type: 'Timeout' });
      const totalWarnings = await Log.countDocuments({ guildId, actionType: 'Warned' });
      
      const analyticsDoc = await GuildAnalytics.findOne({ guildId });
      const dashboardStats = await recalculateDashboardStats(guildId);

      io.to(`guild_${guildId}`).emit('stats_update', {
        totals: {
          detections: totalDetections,
          punishments: totalBans + totalTimeouts,
          bans: totalBans,
          warnings: totalWarnings,
          protectedUsers: message.guild ? message.guild.memberCount : 0,
          totalDeletedMessages,
          voiceScamAttempts: analyticsDoc ? analyticsDoc.voiceScamAttempts : 0,
          threadPhishingAttempts: analyticsDoc ? analyticsDoc.threadPhishingAttempts : 0,
          forumModerationStats: analyticsDoc ? analyticsDoc.forumModerationStats : 0,
          detectionsByChannelType: analyticsDoc ? (analyticsDoc.detectionsByChannelType || {}) : {},
          
          // DashboardStats values
          totalScans: dashboardStats ? dashboardStats.totalScans : (totalDetections * 5 + 120),
          totalThreats: dashboardStats ? dashboardStats.totalThreats : totalDetections,
          filesScannedToday: dashboardStats ? dashboardStats.filesScannedToday : 0,
          usersFlagged: dashboardStats ? dashboardStats.usersFlagged : 0,
          serversProtected: 1,
          offendersDetected: dashboardStats ? dashboardStats.offendersDetected : 0,
          historyScanExecutions: dashboardStats ? dashboardStats.historyScanExecutions : 0,
          virusTotalDetections: dashboardStats ? dashboardStats.virusTotalDetections : 0
        }
      });
    }

    // 7. Discord delete action
    if (settings.deleteMessages) {
      await message.delete().catch(err => {
        console.error('[Scanner] Failed to delete message from Discord:', err.message);
      });
    }

    console.log(`🛡️ Archived and moderated message from ${message.author.tag}. Action: ${action}`);
    return { success: true, log: modLog, archived: archivedMsg };

  } catch (err) {
    console.error('[Scanner] Error in archiveAndActionMessage:', err);
    return { success: false, error: err.message };
  }
}

// Background scanner runner loop (supporting checkpoint checkpoints)
async function runScanningLoop(client, job) {
  const io = client.io;
  const guildId = job.guildId;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    await HistoricalScanJob.updateOne({ guildId }, { $set: { status: 'failed' } });
    if (io) io.to(`guild_${guildId}`).emit('scan_failed', { guildId, error: 'Guild not found on startup' });
    return;
  }

  const settings = await Settings.findOne({ guildId }) || new Settings({ guildId });

  try {
    for (const chanState of job.channels) {
      if (chanState.status === 'completed') continue;

      const channel = guild.channels.cache.get(chanState.channelId);
      if (!channel || !channel.isTextBased()) {
        chanState.status = 'completed';
        await HistoricalScanJob.updateOne(
          { guildId, 'channels.channelId': chanState.channelId },
          { $set: { 'channels.$.status': 'completed' } }
        );
        continue;
      }

      job.currentChannelId = channel.id;
      job.currentChannelName = channel.name;
      chanState.status = 'scanning';
      await HistoricalScanJob.updateOne(
        { guildId, 'channels.channelId': channel.id },
        { 
          $set: { 
            status: 'scanning',
            'channels.$.status': 'scanning',
            currentChannelId: channel.id,
            currentChannelName: channel.name
          } 
        }
      );

      let lastMessageId = chanState.lastProcessedMessageId || null;
      let fetchedCount = chanState.messagesScanned;
      let channelDepth = job.scanDepth;

      while (fetchedCount < channelDepth) {
        // Check for cancel / pause status inside the loop
        const currentJob = await HistoricalScanJob.findOne({ guildId });
        if (!currentJob || currentJob.status === 'cancelled' || currentJob.status === 'paused') {
          console.log(`[Scanner] Historical scan for guild ${guildId} halted. Status: ${currentJob?.status}`);
          if (io) {
            io.to(`guild_${guildId}`).emit('scan_progress', currentJob);
          }
          return; // Halted immediately
        }

        const limit = Math.min(100, channelDepth - fetchedCount);
        const options = { limit };
        if (lastMessageId) {
          options.before = lastMessageId;
        }

        let messages;
        try {
          messages = await channel.messages.fetch(options);
        } catch (fetchErr) {
          console.error(`[Scanner] Failed to fetch messages in channel ${channel.name}:`, fetchErr.message);
          break;
        }

        if (!messages || messages.size === 0) {
          break;
        }

        // Process messages batch
        for (const msg of messages.values()) {
          if (msg.author.bot) continue;

          job.messagesScanned++;
          chanState.messagesScanned++;
          
          await updateGuildAnalyticsScanned(guildId, msg.createdAt);

          const detection = await runDetectionPipeline(msg, settings);
          if (detection) {
            job.detectionsFound++;
            chanState.detectionsFound++;
            
            const actionResult = await archiveAndActionMessage(msg, detection, job.moderatorId);
            
            // Create HistoryScan record
            const threatScore = detection.scamScore || 75;
            let riskLevel = 'Low';
            if (threatScore >= 85) riskLevel = 'Critical';
            else if (threatScore >= 65) riskLevel = 'High';
            else if (threatScore >= 45) riskLevel = 'Medium';

            const historyScanRecord = new HistoryScan({
              guildId,
              userId: msg.author.id,
              username: msg.author.tag,
              timestamp: msg.createdAt || new Date(),
              scanResults: detection.reason,
              threatScore,
              riskLevel,
              findings: `${detection.type}: ${detection.reason}`,
              actionTaken: settings.autoBan ? 'Ban' : (settings.autoKick ? 'Kick' : (settings.autoTimeout ? 'Timeout' : 'Warning')),
              evidence: msg.content || '[Image/Attachment]',
              evidenceId: actionResult && actionResult.success ? actionResult.archived._id : null
            });
            await historyScanRecord.save();
          }
        }

        fetchedCount += messages.size;
        lastMessageId = messages.lastKey();

        // Checkpoint stats inside MongoDB
        await HistoricalScanJob.updateOne(
          { guildId, 'channels.channelId': channel.id },
          {
            $set: {
              'channels.$.lastProcessedMessageId': lastMessageId,
              'channels.$.messagesScanned': chanState.messagesScanned,
              'channels.$.detectionsFound': chanState.detectionsFound,
              messagesScanned: job.messagesScanned,
              detectionsFound: job.detectionsFound
            }
          }
        );

        if (io) {
          io.to(`guild_${guildId}`).emit('scan_progress', {
            active: true,
            guildId,
            status: 'scanning',
            totalChannels: job.totalChannels,
            processedChannels: job.processedChannels,
            messagesScanned: job.messagesScanned,
            detectionsFound: job.detectionsFound,
            currentChannelName: channel.name
          });
        }

        await new Promise(resolve => setTimeout(resolve, 800));
      }

      // Mark channel completed
      chanState.status = 'completed';
      job.processedChannels++;
      await HistoricalScanJob.updateOne(
        { guildId, 'channels.channelId': channel.id },
        {
          $set: {
            'channels.$.status': 'completed',
            processedChannels: job.processedChannels
          }
        }
      );
    }

    // Set job completed
    await HistoricalScanJob.updateOne(
      { guildId },
      {
        $set: {
          status: 'completed',
          completedAt: new Date()
        }
      }
    );

    // Create Notification
    await createNotification(guildId, {
      title: 'Historical Scan Completed',
      message: `Historical scan processed ${job.totalChannels} channels, checked messages, and discovered ${job.detectionsFound} threat indicators.`,
      type: 'history_scan',
      severity: job.detectionsFound > 0 ? 'high' : 'low'
    }, io);

    // Recalculate stats & emit
    const dashboardStats = await recalculateDashboardStats(guildId);
    if (io && dashboardStats) {
      io.to(`guild_${guildId}`).emit('stats_update', {
        totals: {
          // Send all stats updated
          detections: dashboardStats.totalThreats,
          totalThreats: dashboardStats.totalThreats,
          totalScans: dashboardStats.totalScans,
          filesScannedToday: dashboardStats.filesScannedToday,
          usersFlagged: dashboardStats.usersFlagged,
          serversProtected: 1,
          offendersDetected: dashboardStats.offendersDetected,
          historyScanExecutions: dashboardStats.historyScanExecutions,
          virusTotalDetections: dashboardStats.virusTotalDetections
        }
      });
    }

    if (io) {
      io.to(`guild_${guildId}`).emit('scan_completed', {
        guildId,
        status: 'completed',
        totalChannels: job.totalChannels,
        processedChannels: job.totalChannels,
        messagesScanned: job.messagesScanned,
        detectionsFound: job.detectionsFound
      });
    }

  } catch (scanErr) {
    console.error('[Scanner] Error during historical scan loop:', scanErr);
    await HistoricalScanJob.updateOne({ guildId }, { $set: { status: 'failed' } });
    if (io) {
      io.to(`guild_${guildId}`).emit('scan_failed', { guildId, error: scanErr.message });
    }
  }
}

// Start manual scan job
async function startHistoricalScan(client, guildId, channelId = null, depth = 100, moderatorId = null) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    return { success: false, message: 'Guild not found or bot not in guild' };
  }

  // Check if there is already an active job running
  const existingJob = await HistoricalScanJob.findOne({ guildId });
  if (existingJob && existingJob.status === 'scanning') {
    return { success: false, message: 'A historical scan is already running on this server' };
  }

  const settings = await Settings.findOne({ guildId }) || new Settings({ guildId });

  // Get channels to scan
  let channelsToScan = [];
  if (channelId) {
    const channel = guild.channels.cache.get(channelId);
    if (channel && channel.isTextBased()) {
      channelsToScan = [channel];
    }
  } else {
    channelsToScan = Array.from(guild.channels.cache.values()).filter(c => 
      c.isTextBased() && 
      c.viewable &&
      (!settings.whitelistChannels || !settings.whitelistChannels.includes(c.id))
    );
  }

  const channelsList = channelsToScan.map(c => ({
    channelId: c.id,
    channelName: c.name,
    status: 'pending',
    messagesScanned: 0,
    detectionsFound: 0,
    lastProcessedMessageId: null
  }));

  const job = await HistoricalScanJob.findOneAndUpdate(
    { guildId },
    {
      $set: {
        status: 'scanning',
        scanDepth: Number(depth) || 100,
        channels: channelsList,
        totalChannels: channelsList.length,
        processedChannels: 0,
        messagesScanned: 0,
        detectionsFound: 0,
        currentChannelId: channelsList[0]?.channelId || null,
        currentChannelName: channelsList[0]?.channelName || null,
        moderatorId,
        startedAt: new Date(),
        completedAt: null
      }
    },
    { upsert: true, new: true }
  );

  // Run scanning in background
  runScanningLoop(client, job);

  return { 
    success: true, 
    message: 'Scan started', 
    scanState: {
      active: true,
      guildId,
      status: 'scanning',
      totalChannels: job.totalChannels,
      processedChannels: 0,
      messagesScanned: 0,
      detectionsFound: 0,
      currentChannelName: job.currentChannelName
    } 
  };
}

// Cancel manual scan job
async function cancelHistoricalScan(guildId) {
  const job = await HistoricalScanJob.findOne({ guildId });
  if (!job || job.status !== 'scanning') {
    return { success: false, message: 'No active scan job found to cancel' };
  }

  job.status = 'cancelled';
  await job.save();

  return { success: true, message: 'Historical scan cancelled successfully' };
}

// Resume manual scan job
async function resumeHistoricalScan(client, guildId, moderatorId = null) {
  const job = await HistoricalScanJob.findOne({ guildId });
  if (!job) {
    return { success: false, message: 'No previous historical scan job found for this server' };
  }

  if (job.status === 'scanning') {
    return { success: false, message: 'Scan is already actively running' };
  }

  job.status = 'scanning';
  if (moderatorId) job.moderatorId = moderatorId;
  await job.save();

  // Resume in background
  runScanningLoop(client, job);

  return {
    success: true,
    message: 'Scan resumed successfully',
    scanState: {
      active: true,
      guildId,
      status: 'scanning',
      totalChannels: job.totalChannels,
      processedChannels: job.processedChannels,
      messagesScanned: job.messagesScanned,
      detectionsFound: job.detectionsFound,
      currentChannelName: job.currentChannelName
    }
  };
}

module.exports = {
  activeScans,
  startHistoricalScan,
  cancelHistoricalScan,
  resumeHistoricalScan,
  archiveAndActionMessage,
  updateGuildAnalyticsScanned,
  updateGuildAnalyticsDetection,
  updateUserInfraction,
  calculateScamScore,
  shouldBypass
};
