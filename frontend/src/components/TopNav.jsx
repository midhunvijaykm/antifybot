import React, { useState, useRef, useEffect } from 'react';
import { Bell, Search, ChevronDown, PlusCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import './TopNav.css';

const TopNav = () => {
  const { 
    user, 
    guilds, 
    activeGuild, 
    setActiveGuild,
    notifications,
    markAllNotificationsRead,
    markNotificationRead,
    premium,
    addAlert
  } = useStore();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef(null);
  const notificationsDropdownRef = useRef(null);

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
      if (notificationsDropdownRef.current && !notificationsDropdownRef.current.contains(event.target)) {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const safeGuilds = Array.isArray(guilds) ? guilds : [];
  const filteredGuilds = safeGuilds.filter(g => 
    g && g.name && g.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectGuild = (guild) => {
    setActiveGuild(guild);
    setDropdownOpen(false);
  };

  const handleInviteBot = (guildId) => {
    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=1501936383160225852&permissions=8&scope=bot%20applications.commands&guild_id=${guildId}&disable_guild_select=true`;
    window.open(inviteUrl, '_blank');
  };

  const formatRelativeTime = (dateString) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const userAvatar = user?.avatar 
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
    : 'https://cdn.discordapp.com/embed/avatars/0.png';

  const safeNotifications = Array.isArray(notifications) ? notifications : [];
  const unreadCount = safeNotifications.filter(n => !n.read).length;
  
  const isOwner = user && user.id === '1060801714187415552';
  const isLocked = !isOwner && premium?.plan !== 'Pro';

  return (
    <header className="topnav glass">
      <div className="topnav-left">
        {/* Guild Selector Dropdown in Topbar */}
        {user && (
          <div className="guild-selector-container" ref={dropdownRef}>
            <button 
              className="guild-selector-btn glass"
              onClick={() => setDropdownOpen(!dropdownOpen)}
            >
              {activeGuild ? (
                <>
                  {activeGuild.icon ? (
                    <img src={activeGuild.icon} alt={activeGuild.name} className="guild-icon-avatar" />
                  ) : (
                    <div className="guild-icon-placeholder">
                      {activeGuild.name.charAt(0)}
                    </div>
                  )}
                  <span className="guild-selector-name">{activeGuild.name}</span>
                </>
              ) : (
                <span className="guild-selector-name">Select Server</span>
              )}
              <ChevronDown size={16} className={`chevron-icon ${dropdownOpen ? 'rotated' : ''}`} />
            </button>

            {dropdownOpen && (
              <div className="guild-dropdown glass glow">
                <div className="guild-dropdown-search">
                  <Search size={14} />
                  <input 
                    type="text" 
                    placeholder="Search servers..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div className="guild-list">
                  {filteredGuilds.length === 0 ? (
                    <div className="guild-list-empty">No servers found</div>
                  ) : (
                    filteredGuilds.map((g) => (
                      <div 
                        key={g.id} 
                        className={`guild-item ${activeGuild?.id === g.id ? 'active' : ''}`}
                        onClick={() => handleSelectGuild(g)}
                      >
                        <div className="guild-item-info">
                          {g.icon ? (
                            <img src={g.icon} alt={g.name} className="guild-icon-avatar-sm" />
                          ) : (
                            <div className="guild-icon-placeholder-sm">
                              {g.name.charAt(0)}
                            </div>
                          )}
                          <span className="guild-item-name">{g.name}</span>
                        </div>
                        
                        {!g.botActive && (
                          <button 
                            className="invite-btn-sm" 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleInviteBot(g.id);
                            }}
                          >
                            <PlusCircle size={14} />
                            <span>Invite</span>
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="topnav-actions">
        {/* Notifications Dropdown Button */}
        {activeGuild?.botActive && (
          <div className="notifications-container" ref={notificationsDropdownRef}>
            <button 
              className={`icon-btn action-btn ${notificationsOpen ? 'active' : ''}`}
              onClick={() => {
                if (isLocked) {
                  addAlert('🔒 Advanced Notifications require ANTIFY PRO.', 'warning');
                } else {
                  setNotificationsOpen(!notificationsOpen);
                }
              }}
            >
              <Bell size={20} />
              {!isLocked && unreadCount > 0 && <span className="nav-badge">{unreadCount}</span>}
              {isLocked && <span className="nav-badge" style={{ background: '#64748b', fontSize: '0.6rem' }}>🔒</span>}
            </button>

            {notificationsOpen && (
              <div className="notifications-dropdown glass glow">
                <div className="notifications-header">
                  <h3>Server Notifications</h3>
                  {unreadCount > 0 && (
                    <button 
                      className="mark-read-btn"
                      onClick={() => markAllNotificationsRead(activeGuild.id)}
                    >
                      Mark all as read
                    </button>
                  )}
                </div>
                <div className="notifications-list">
                  {safeNotifications.length === 0 ? (
                    <div className="notifications-empty">No recent notifications</div>
                  ) : (
                    safeNotifications.map((n) => (
                      <div 
                        key={n._id} 
                        className={`notification-item ${!n.read ? 'unread' : ''}`}
                        onClick={() => !n.read && markNotificationRead(activeGuild.id, n._id)}
                      >
                        {!n.read && <div className="notification-status-dot" />}
                        <div className="notification-content">
                          <div className="notification-title-row">
                            <span className="notification-title">{n.title}</span>
                            <span className="notification-time">{formatRelativeTime(n.timestamp)}</span>
                          </div>
                          <span className="notification-message">{n.message}</span>
                          <span className={`notification-severity-badge ${n.severity || 'medium'}`}>
                            {n.severity || 'medium'}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        
        {user && (
          <div className="user-profile">
            <img 
              src={userAvatar} 
              alt={user.username} 
              className="avatar" 
            />
            <div className="user-info">
              <span className="user-name">{user.username}</span>
              {user.id === '1060801714187415552' ? (
                <span className="user-role badge-pro-plus">ANTIFY PRO+</span>
              ) : (activeGuild && activeGuild.botActive && premium?.plan === 'Pro' ? (
                <span className="user-role badge-pro">ANTIFY PRO</span>
              ) : (
                <span className="user-role badge-free">ANTIFY FREE</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default TopNav;
