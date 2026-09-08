// ==============================
// ANTIFY BOT - COMPLETE bot.js with Full Stack Integration
// ==============================

require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField
} = require('discord.js');

const Tesseract = require('tesseract.js');
const axios = require('axios');
const startServer = require('./backend/server');
const { Log, Warning, Punishment, Settings, Guild, HistoricalScanJob } = require('./backend/models');
const { activeScans, startHistoricalScan, cancelHistoricalScan, resumeHistoricalScan, archiveAndActionMessage, updateGuildAnalyticsScanned, calculateScamScore, shouldBypass, cleanUndeletedScamMessages } = require('./backend/helpers/scanner');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ==============================
// CONFIG
// ==============================

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

// ==============================
// HELPERS
// ==============================

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

// Scam detection (checks default and guild-specific custom keywords)
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

// VirusTotal Scan
async function scanUrl(url, guildId) {
  try {
    if (!guildId) return false;
    const { checkAndIncrementUsage } = require('./backend/helpers/usage');
    const vtCheck = await checkAndIncrementUsage(guildId, 'virusTotalRequests');
    if (!vtCheck.allowed) {
      console.log(`[Bot] Daily VirusTotal limit reached for guild ${guildId}. Skipping VT lookup.`);
      return false;
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
    console.log("VirusTotal Error:", err.message);
    return false;
  }
}

/**
 * Sends security alerts ONLY to Server Administrators and higher rank (Server Owner).
 * Regular users in public channels will never see these security alerts.
 */
async function sendAdminOnlyAlert(guild, message, author, action, reason, severity = 'high', score = null, type = 'Scam', settings = null) {
  try {
    if (!guild) return;
    if (!settings) {
      settings = await Settings.findOne({ guildId: guild.id }) || new Settings({ guildId: guild.id });
    }
    const finalScore = score !== null ? score : (severity === 'critical' ? 98 : (severity === 'high' ? 88 : 75));
    const alertContent = `🚨 **ANTIFY Protection Active** | ${author} was **${action.toLowerCase()}**.\nReason: *${reason}*`;

    let adminChannel = null;

    // 1. Check designated logging channel
    if (settings.loggingChannelId) {
      try {
        const fetched = await guild.channels.fetch(settings.loggingChannelId).catch(() => null);
        if (fetched && fetched.isTextBased()) {
          adminChannel = fetched;
        }
      } catch (_) {}
    }

    // 2. Look for existing admin-restricted channel
    if (!adminChannel) {
      adminChannel = guild.channels.cache.find(c => 
        c.isTextBased() && (
          c.name.toLowerCase().includes('admin') || 
          c.name.toLowerCase().includes('mod-log') || 
          c.name.toLowerCase().includes('security') || 
          c.name.toLowerCase().includes('antify')
        ) && c.permissionsFor(guild.roles.everyone)?.has(PermissionsBitField.Flags.ViewChannel) === false
      );
    }

    // 3. Auto-create private admin-only security channel if none exists
    if (!adminChannel) {
      try {
        adminChannel = await guild.channels.create({
          name: 'antify-security-alerts',
          type: 0, // GuildText
          permissionOverwrites: [
            {
              id: guild.id, // @everyone role denied
              deny: [PermissionsBitField.Flags.ViewChannel]
            },
            {
              id: guild.client.user.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.EmbedLinks
              ]
            }
          ],
          reason: 'AntifyBot private security channel visible only to administrators'
        });

        settings.loggingChannelId = adminChannel.id;
        await settings.save().catch(console.error);
        console.log(`[Alert] Created private admin channel #${adminChannel.name} in guild ${guild.name}`);
      } catch (createErr) {
        console.warn(`[Alert] Could not auto-create admin channel:`, createErr.message);
      }
    }

    // 4. Send the alert to the admin-only channel
    if (adminChannel && adminChannel.isTextBased()) {
      const embed = {
        title: `🛡️ Security Alert | Threat Handled`,
        description: alertContent,
        color: severity === 'critical' ? 0xff0000 : (severity === 'high' ? 0xffa500 : 0xffff00),
        fields: [
          { name: 'Target User', value: `${author.tag} (${author.id})`, inline: true },
          { name: 'Channel', value: `<#${message.channelId || message.channel?.id}>`, inline: true },
          { name: 'Action Taken', value: action, inline: true },
          { name: 'Threat Type', value: type, inline: true },
          { name: 'Scam Score', value: `${finalScore}%`, inline: true },
          { name: 'Reason', value: reason },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'ANTIFY Cybersecurity Shield • Administrator & Owner View Only' }
      };

      await adminChannel.send({ content: alertContent, embeds: [embed] });
      console.log(`[Alert] Sent admin-only alert to #${adminChannel.name}`);
    } else {
      // Fallback: Notify guild owner directly in DM
      try {
        const owner = await guild.fetchOwner();
        if (owner) {
          await owner.send(`🛡️ **[${guild.name}] Antify Alert (Admin-Only):**\n${alertContent}\n*Channel: #${message.channel?.name || message.channelId}*`).catch(() => {});
        }
      } catch (_) {}
    }
  } catch (err) {
    console.error('[Alert] Error in sendAdminOnlyAlert:', err.message);
  }
}

// Unified Punish Function
async function punish(message, reason, type, severity = 'high', score = null) {
  try {
    const guildId = message.guildId;
    const settings = await Settings.findOne({ guildId }) || new Settings({ guildId });
    
    let action = 'Warned';
    if (settings.autoBan && message.member?.bannable) action = 'Banned';
    else if (settings.autoKick && message.member?.kickable) action = 'Kicked';
    else if (settings.autoTimeout && message.member?.moderatable) action = 'Muted';

    // Execute Discord punishment action
    if (action === 'Banned') {
      if (message.member && message.member.bannable) {
        await message.member.ban({ reason });
      }
    } else if (action === 'Kicked') {
      if (message.member && message.member.kickable) {
        await message.member.kick(reason);
      }
    } else if (action === 'Muted') {
      if (message.member && message.member.moderatable) {
        await message.member.timeout(5 * 60 * 1000, reason); // 5 min mute
      }
    }

    const finalScore = score !== null ? score : (severity === 'critical' ? 98 : (severity === 'high' ? 88 : 75));
    const detection = {
      type,
      severity,
      reason,
      detectionCategory: type === 'Spam Words' ? 'Spam' : (type === 'Phishing Link' ? 'Phishing' : 'OCR'),
      scamScore: finalScore,
      AIConfidence: finalScore,
      matchedKeywords: [reason],
      imageDetected: type === 'Scam Image'
    };

    // Archive message, save logs/detections/infractions, update analytics, emit sockets, then delete message
    await archiveAndActionMessage(message, detection);

    // Send Alert ONLY to Server Administrators and higher rank (not to public chat)
    await sendAdminOnlyAlert(message.guild, message, message.author, action, reason, severity, finalScore, type, settings);

    console.log(`🛡️ Blocked ${message.author.tag} | Action: ${action} | Reason: ${reason}`);

  } catch (err) {
    console.log("Punish Error:", err);
  }
}

// ==============================
// 3-HOUR RECURRING SCANNER
// ==============================

async function runScheduledAutoScan(clientInstance) {
  console.log('⏰ [Auto-Scanner] Starting 3-hour scan across all active servers...');
  for (const guild of clientInstance.guilds.cache.values()) {
    try {
      await cleanUndeletedScamMessages(guild, 50, sendAdminOnlyAlert);
    } catch (guildErr) {
      console.error(`[Auto-Scanner] Error scanning guild ${guild.name}:`, guildErr.message);
    }
  }
  console.log('✅ [Auto-Scanner] 3-hour scan cycle completed.');
}

// ==============================
// READY EVENT
// ==============================

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  // Start the HTTP express + Socket.io server
  startServer(client);

  // Resume interrupted scan jobs on boot
  try {
    const scanningJobs = await HistoricalScanJob.find({ status: 'scanning' });
    for (const job of scanningJobs) {
      console.log(`⏳ Auto-resuming scan job for guild ${job.guildId} on bot startup...`);
      resumeHistoricalScan(client, job.guildId, job.moderatorId).catch(err => {
        console.error(`[Scanner] Failed to auto-resume scan for guild ${job.guildId}:`, err.message);
      });
    }
  } catch (resumeErr) {
    console.error('[Scanner] Failed to query scanning jobs on startup:', resumeErr.message);
  }

  // 3-Hour Scheduled Scanner
  const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
  setInterval(() => {
    runScheduledAutoScan(client).catch(err => {
      console.error('[Auto-Scanner] Interval error:', err.message);
    });
  }, THREE_HOURS_MS);

  // Initial sweep 30 seconds after startup to clean up lingering undeleted scam messages
  setTimeout(() => {
    runScheduledAutoScan(client).catch(err => {
      console.error('[Auto-Scanner] Initial sweep error:', err.message);
    });
  }, 30 * 1000);
});

// ==============================
// GUILD LIFECYCLE EVENTS
// ==============================

client.on('guildCreate', async (guild) => {
  try {
    console.log(`🤖 Bot joined a new guild: ${guild.name} (${guild.id})`);
    
    // Save to Guild collection
    let dbGuild = await Guild.findOne({ guildId: guild.id });
    if (!dbGuild) {
      dbGuild = new Guild({
        guildId: guild.id,
        name: guild.name,
        icon: guild.icon,
        ownerId: guild.ownerId
      });
      await dbGuild.save();
    }
    
    // Save default settings
    let dbSettings = await Settings.findOne({ guildId: guild.id });
    if (!dbSettings) {
      dbSettings = new Settings({ guildId: guild.id });
      await dbSettings.save();
    }

    // Broadcast update via Socket.io to refresh selectors
    if (client.io) {
      const iconUrl = guild.icon 
        ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
        : null;

      client.io.emit('guild_added', {
        id: guild.id,
        name: guild.name,
        icon: iconUrl,
        botActive: true,
        settings: dbSettings
      });
    }

    // Start automatic shallow historical scan (depth: 50)
    console.log(`🤖 Starting automatic shallow historical scan for new guild: ${guild.name}`);
    startHistoricalScan(client, guild.id, null, 50).catch(err => {
      console.error('Failed to run automatic historical scan on join:', err);
    });
  } catch (error) {
    console.error('Error handling guildCreate:', error);
  }
});

client.on('guildDelete', async (guild) => {
  try {
    console.log(`🤖 Bot left a guild: ${guild.name} (${guild.id})`);
    
    // Remove guild record
    await Guild.deleteOne({ guildId: guild.id });
    
    // Broadcast via socket
    if (client.io) {
      client.io.emit('guild_removed', guild.id);
    }
  } catch (error) {
    console.error('Error handling guildDelete:', error);
  }
});

// ==============================
// LIVE MESSAGE SCANNER
// ==============================

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const guildId = message.guildId;
  
  // Increment scanning metric in background
  updateGuildAnalyticsScanned(guildId, message.createdAt || new Date()).catch(console.error);

  const settings = await Settings.findOne({ guildId }) || new Settings({ guildId });

  // 1. Trust system check
  if (shouldBypass(message, message.member, settings)) {
    console.log(`[Bot] Bypassing scan for trusted user/channel: ${message.author.tag} in #${message.channel.name}`);
    return;
  }

  const sensitivity = settings.scanSensitivity !== undefined ? settings.scanSensitivity : 50;

  // ==========================
  // TEXT SCAN
  // ==========================
  if (settings.antiScamEnabled !== false && message.content) {
    const scamScore = calculateScamScore(message.content, settings);
    if (scamScore >= sensitivity) {
      return punish(
        message,
        `Scam text detected (Score: ${scamScore})`,
        "Spam Words",
        scamScore >= 85 ? 'critical' : (scamScore >= 65 ? 'high' : 'medium'),
        scamScore
      );
    }
  }

  // ==========================
  // LINK SCAN
  // ==========================
  if (settings.antiPhishingEnabled !== false) {
    const urls = extractUrls(message.content);

    if (urls) {
      for (const url of urls) {
        // suspicious domains
        if (hasBadDomain(url)) {
          const scamScore = calculateScamScore(message.content, settings);
          if (scamScore >= sensitivity) {
            return punish(
              message,
              `Suspicious domain detected (Score: ${scamScore})`,
              "Phishing Link",
              "high",
              scamScore
            );
          }
        }

        // VirusTotal
        if (settings.virusTotalEnabled !== false) {
          const malicious = await scanUrl(url, guildId);

          if (malicious) {
            return punish(
              message,
              "Malicious link detected",
              "Phishing Link",
              "critical",
              98
            );
          }
        }
      }
    }
  }

  // ==========================
  // IMAGE OCR SCAN
  // ==========================
  if (settings.ocrEnabled && message.attachments.size > 0) {
    const { checkAndIncrementUsage } = require('./backend/helpers/usage');
    const ocrCheck = await checkAndIncrementUsage(guildId, 'imageScans');
    if (!ocrCheck.allowed) {
      console.log(`[Bot] Daily image scan limit reached for guild ${guildId}. Skipping OCR scan.`);
      return;
    }
    for (const attachment of message.attachments.values()) {
      const isImage = attachment.contentType?.startsWith('image') ||
                      /\.(png|jpe?g|webp|gif|bmp|tiff)$/i.test(attachment.name || attachment.url);
      if (isImage) {
        try {
          console.log(`[Bot] Scanning image: ${attachment.name || attachment.url}...`);

          let imageInput = attachment.url;
          try {
            const res = await axios.get(attachment.url, {
              responseType: 'arraybuffer',
              timeout: 10000,
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AntifyBot/1.0)' }
            });
            imageInput = Buffer.from(res.data);
          } catch (fetchErr) {
            console.warn(`[Bot] Direct buffer fetch failed, using URL directly:`, fetchErr.message);
          }

          const result = await Tesseract.recognize(
            imageInput,
            'eng'
          );

          const extractedText = result.data.text || '';
          console.log(`[Bot] OCR extracted text:`, extractedText.replace(/\s+/g, ' ').trim().substring(0, 200));

          // OCR keyword scan
          const scamScore = calculateScamScore(extractedText, settings);
          console.log(`[Bot] OCR Scam Score: ${scamScore} (Sensitivity threshold: ${sensitivity})`);
          if (scamScore >= sensitivity) {
            return punish(
              message,
              `Scam text inside image detected (Score: ${scamScore})`,
              "Scam Image",
              scamScore >= 85 ? 'critical' : (scamScore >= 65 ? 'high' : 'medium'),
              scamScore
            );
          }

          // OCR URL scan
          const imageUrls = extractUrls(extractedText);

          if (imageUrls) {
            for (const url of imageUrls) {
              if (hasBadDomain(url)) {
                const scamScore = calculateScamScore(extractedText, settings);
                if (scamScore >= sensitivity) {
                  return punish(
                    message,
                    `Bad domain inside image detected (Score: ${scamScore})`,
                    "Scam Image",
                    "high",
                    scamScore
                  );
                }
              }

              if (settings.virusTotalEnabled !== false) {
                const malicious = await scanUrl(url, guildId);

                if (malicious) {
                  return punish(
                    message,
                    "Malicious URL inside image detected",
                    "Scam Image",
                    "critical",
                    98
                  );
                }
              }
            }
          }

        } catch (err) {
          console.log("OCR Error:", err.message);
        }
      }
    }
  }
});

// ==============================
// SLASH COMMANDS
// ==============================

client.on('interactionCreate', async interaction => {
  try {
    if (!interaction.isChatInputCommand()) return;

    console.log("Slash Command:", interaction.commandName);

    // ==========================
    // /ping
    // ==========================

    if (interaction.commandName === 'ping') {
      return interaction.reply('🏓 Pong!');
    }

    // ==========================
    // /scan
    // ==========================

    if (interaction.commandName === 'scan') {
      const text = interaction.options.getString('text');
      const guildId = interaction.guildId;
      const settings = await Settings.findOne({ guildId }) || new Settings({ guildId });

      if (isScam(text, settings)) {
        return interaction.reply("⚠️ Suspicious text detected");
      }

      return interaction.reply("✅ Looks safe");
    }

    // ==========================
    // Historical Scanning Commands
    // ==========================

    if (['scanhistory', 'historyscan', 'scanprevious', 'loghistory'].includes(interaction.commandName)) {
      // Check permissions
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You must have Administrator permissions to run this command.', ephemeral: true });
      }

      const action = interaction.options.getString('action') || 'start';
      const depth = interaction.options.getInteger('depth') || 100;
      const channelOpt = interaction.options.getChannel('channel');
      const guildId = interaction.guildId;

      if (action === 'cancel') {
        await interaction.reply(`⏳ **ANTIFY Scanning Engine** | Cancelling historical scan...`);
        const result = await cancelHistoricalScan(guildId);
        if (!result.success) {
          return interaction.editReply(`❌ Failed to cancel scan: ${result.message}`);
        }
        return interaction.editReply(`✅ **Historical Scan Cancelled** | Telemetry scanning halted.`);
      }

      if (action === 'resume') {
        await interaction.reply(`⏳ **ANTIFY Scanning Engine** | Resuming historical scan...`);
        const result = await resumeHistoricalScan(client, guildId, interaction.user.id);
        if (!result.success) {
          return interaction.editReply(`❌ Failed to resume scan: ${result.message}`);
        }
        await interaction.editReply(`⏳ **Historical Scan Resumed** | Background engine restarted.`);

        const interval = setInterval(async () => {
          const job = await HistoricalScanJob.findOne({ guildId });
          if (!job || job.status !== 'scanning') {
            clearInterval(interval);
            if (job && job.status === 'completed') {
              await interaction.editReply(`✅ **Historical Scan Complete**\n- Channels processed: ${job.processedChannels}/${job.totalChannels}\n- Messages scanned: ${job.messagesScanned}\n- Threats detected & stored: ${job.detectionsFound}`);
            } else if (job && job.status === 'cancelled') {
              await interaction.editReply(`✅ **Historical Scan Cancelled** | Telemetry scanning halted.`);
            } else if (job && job.status === 'paused') {
              await interaction.editReply(`✅ **Historical Scan Paused** | Telemetry scanning paused.`);
            } else {
              await interaction.editReply(`✅ **Historical Scan Complete** | Telemetry logs synchronized.`);
            }
          } else {
            await interaction.editReply(`⏳ **Historical Scan In Progress** (${Math.round((job.processedChannels / (job.totalChannels || 1)) * 100)}%)\n- Current Channel: \`#${job.currentChannelName || 'Unknown'}\`\n- Channels processed: ${job.processedChannels}/${job.totalChannels}\n- Messages scanned: ${job.messagesScanned}\n- Threats detected: ${job.detectionsFound}`);
          }
        }, 3000);
        return;
      }

      // Default: Start new scan
      await interaction.reply(`🔍 **ANTIFY Scanning Engine** | Initializing historical scan (Depth: ${depth} messages per channel)...`);

      const result = await startHistoricalScan(client, guildId, channelOpt?.id, depth, interaction.user.id);

      if (!result.success) {
        return interaction.editReply(`❌ Failed to start scan: ${result.message}`);
      }

      const interval = setInterval(async () => {
        const job = await HistoricalScanJob.findOne({ guildId });
        if (!job || job.status !== 'scanning') {
          clearInterval(interval);
          if (job && job.status === 'completed') {
            await interaction.editReply(`✅ **Historical Scan Complete**\n- Channels processed: ${job.processedChannels}/${job.totalChannels}\n- Messages scanned: ${job.messagesScanned}\n- Threats detected & stored: ${job.detectionsFound}`);
          } else if (job && job.status === 'cancelled') {
            await interaction.editReply(`✅ **Historical Scan Cancelled** | Telemetry scanning halted.`);
          } else if (job && job.status === 'paused') {
            await interaction.editReply(`✅ **Historical Scan Paused** | Telemetry scanning paused.`);
          } else {
            await interaction.editReply(`✅ **Historical Scan Complete** | Telemetry logs synchronized.`);
          }
        } else {
          await interaction.editReply(`⏳ **Historical Scan In Progress** (${Math.round((job.processedChannels / (job.totalChannels || 1)) * 100)}%)\n- Current Channel: \`#${job.currentChannelName || 'Unknown'}\`\n- Channels processed: ${job.processedChannels}/${job.totalChannels}\n- Messages scanned: ${job.messagesScanned}\n- Threats detected: ${job.detectionsFound}`);
        }
      }, 3000);
    }

  } catch (err) {
    console.log("Interaction Error:", err);
  }
});

// ==============================
// GUILD MEMBER ADD EVENT (Auto-Role & Welcome Messages)
// ==============================
client.on('guildMemberAdd', async (member) => {
  try {
    const guildId = member.guild.id;
    const settings = await Settings.findOne({ guildId }) || new Settings({ guildId });

    // 1. Welcome Message
    if (settings.welcomeEnabled && settings.welcomeChannelId) {
      try {
        const welcomeChannel = await member.guild.channels.fetch(settings.welcomeChannelId);
        if (welcomeChannel && welcomeChannel.isTextBased()) {
          const welcomeMsg = settings.welcomeMessageText
            ? settings.welcomeMessageText.replace('{user}', member.toString()).replace('{member}', member.toString()).replace('{server}', member.guild.name)
            : `Welcome ${member} to the server!`;
          await welcomeChannel.send(welcomeMsg);
        }
      } catch (welcomeErr) {
        console.error(`[Welcome] Failed to send welcome message in guild ${guildId}:`, welcomeErr.message);
      }
    }

    // 2. Auto Role Assignment
    if (settings.roleManagementEnabled && settings.autoroleId) {
      try {
        const role = member.guild.roles.cache.get(settings.autoroleId);
        if (role) {
          await member.roles.add(role);
          console.log(`[Auto-Role] Added role ${role.name} to new member ${member.user.tag}`);
        } else {
          console.warn(`[Auto-Role] Role ID ${settings.autoroleId} not found in guild ${guildId}`);
        }
      } catch (roleErr) {
        console.error(`[Auto-Role] Failed to assign role in guild ${guildId}:`, roleErr.message);
      }
    }
  } catch (err) {
    console.error('Error handling guildMemberAdd:', err);
  }
});

// ==============================
// LOGIN
// ==============================

client.login(process.env.DISCORD_TOKEN);