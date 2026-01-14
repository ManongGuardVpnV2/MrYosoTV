import React, { useState, useEffect, useCallback } from 'react';
import { Settings, Bell, LogOut, X, User } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Channel, Notification } from '@/types';
import VideoPlayer from './VideoPlayer';
import ChannelSidebar from './ChannelSidebar';
import AdminPanel from './AdminPanel';

const FOREST_BG = 'https://d64gsuwffb70l.cloudfront.net/6966ff2969d41bac5afce556_1768357818222_990606db.jpg';

const MainApp: React.FC = () => {
  const { user, logout, updateActivity } = useAuth();
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number; delay: number; size: number }>>([]);

  // Generate floating particles
  useEffect(() => {
    const newParticles = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      delay: Math.random() * 5,
      size: Math.random() * 3 + 1
    }));
    setParticles(newParticles);
  }, []);

  // Fetch channels
  useEffect(() => {
    const fetchChannels = async () => {
      const { data } = await supabase
        .from('channels')
        .select('*')
        .order('category')
        .order('display_order');
      
      if (data) setChannels(data);
    };

    fetchChannels();
  }, []);

  // Fetch notifications
  useEffect(() => {
    const fetchNotifications = async () => {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      
      if (data) setNotifications(data);
    };

    fetchNotifications();

    // Subscribe to new notifications
    const subscription = supabase
      .channel('notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        setNotifications(prev => [payload.new as Notification, ...prev]);
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Handle channel selection
  const handleChannelSelect = useCallback(async (channel: Channel) => {
    setSelectedChannel(channel);
    await updateActivity('watch', channel.id, { channel_name: channel.name });
  }, [updateActivity]);

  // Handle channel navigation
  const handleChannelChange = useCallback((direction: 'prev' | 'next') => {
    if (!selectedChannel || channels.length === 0) return;

    const currentIndex = channels.findIndex(c => c.id === selectedChannel.id);
    let newIndex: number;

    if (direction === 'next') {
      newIndex = (currentIndex + 1) % channels.length;
    } else {
      newIndex = currentIndex - 1 < 0 ? channels.length - 1 : currentIndex - 1;
    }

    // Skip locked channels
    let attempts = 0;
    while (channels[newIndex].is_locked && attempts < channels.length) {
      if (direction === 'next') {
        newIndex = (newIndex + 1) % channels.length;
      } else {
        newIndex = newIndex - 1 < 0 ? channels.length - 1 : newIndex - 1;
      }
      attempts++;
    }

    if (!channels[newIndex].is_locked) {
      handleChannelSelect(channels[newIndex]);
    }
  }, [selectedChannel, channels, handleChannelSelect]);

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* 3D Forest Background */}
      <div 
        className="fixed inset-0 bg-cover bg-center bg-no-repeat"
        style={{ 
          backgroundImage: `url(${FOREST_BG})`,
          transform: 'scale(1.05)',
          filter: 'brightness(0.4) saturate(0.8)'
        }}
      />

      {/* Overlay */}
      <div className="fixed inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/70" />

      {/* Floating Particles */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {particles.map((particle) => (
          <div
            key={particle.id}
            className="absolute rounded-full bg-amber-400/40 animate-float"
            style={{
              left: `${particle.x}%`,
              top: `${particle.y}%`,
              width: `${particle.size}px`,
              height: `${particle.size}px`,
              animationDelay: `${particle.delay}s`,
              boxShadow: '0 0 8px 2px rgba(251, 191, 36, 0.3)'
            }}
          />
        ))}
      </div>

      {/* Header */}
      <header 
        className="fixed top-0 left-0 right-0 z-30 px-4 py-3"
        style={{
          background: 'linear-gradient(180deg, rgba(26, 15, 10, 0.95) 0%, rgba(26, 15, 10, 0.8) 70%, transparent 100%)',
          borderBottom: '2px solid rgba(139, 90, 43, 0.3)'
        }}
      >
        <div className="flex items-center justify-between max-w-screen-2xl mx-auto">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <h1 
              className="text-2xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-amber-500 to-yellow-600"
              style={{ textShadow: '0 0 20px rgba(255, 215, 0, 0.5)' }}
            >
              PinoyTV
            </h1>
          </div>

          {/* User Actions */}
          <div className="flex items-center gap-2 md:gap-4">
            {/* Notifications */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative p-2 text-amber-300 hover:text-amber-100 transition-colors"
              >
                <Bell className="w-5 h-5 md:w-6 md:h-6" />
                {notifications.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center">
                    {notifications.length}
                  </span>
                )}
              </button>

              {/* Notifications Dropdown */}
              {showNotifications && (
                <div 
                  className="absolute right-0 top-full mt-2 w-72 md:w-80 max-h-96 overflow-y-auto rounded-xl shadow-2xl border border-amber-800"
                  style={{ background: 'linear-gradient(135deg, #1a0f0a 0%, #2d1810 100%)' }}
                >
                  <div className="p-3 border-b border-amber-800 flex items-center justify-between">
                    <span className="text-amber-300 font-medium">Notifications</span>
                    <button onClick={() => setShowNotifications(false)} className="text-amber-500 hover:text-amber-300">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {notifications.length === 0 ? (
                    <div className="p-4 text-center text-amber-600">No notifications</div>
                  ) : (
                    <div className="divide-y divide-amber-900/50">
                      {notifications.map((notif) => (
                        <div key={notif.id} className="p-3 hover:bg-amber-900/20">
                          <h4 className="text-amber-200 font-medium text-sm">{notif.title}</h4>
                          <p className="text-amber-400 text-xs mt-1">{notif.message}</p>
                          <p className="text-amber-600 text-xs mt-2">
                            {new Date(notif.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Admin Button */}
            {user?.is_admin && (
              <button
                onClick={() => setShowAdmin(true)}
                className="flex items-center gap-2 px-3 py-2 bg-amber-600/20 text-amber-300 rounded-lg hover:bg-amber-600/30 transition-colors"
              >
                <Settings className="w-4 h-4 md:w-5 md:h-5" />
                <span className="hidden md:inline text-sm">Admin</span>
              </button>
            )}

            {/* User Info */}
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-900/30 rounded-lg">
              <User className="w-4 h-4 text-amber-400" />
              <span className="text-amber-200 text-sm hidden sm:inline">{user?.username}</span>
            </div>

            {/* Logout */}
            <button
              onClick={logout}
              className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-colors"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main 
        className={`relative z-10 pt-20 pb-8 px-4 transition-all duration-300 ${
          sidebarCollapsed ? 'pr-4' : 'pr-4 md:pr-[340px]'
        }`}
      >
        <div className="max-w-screen-xl mx-auto">
          {/* Video Player Section */}
          <div className="mb-6">
            <VideoPlayer 
              channel={selectedChannel} 
              onChannelChange={handleChannelChange}
            />
          </div>
        </div>
      </main>

      {/* Channel Sidebar */}
      <ChannelSidebar
        selectedChannel={selectedChannel}
        onChannelSelect={handleChannelSelect}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Admin Panel */}
      {showAdmin && user?.is_admin && (
        <AdminPanel onClose={() => setShowAdmin(false)} />
      )}

      {/* Custom Animations */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.4; }
          25% { transform: translateY(-20px) translateX(10px); opacity: 0.7; }
          50% { transform: translateY(-10px) translateX(-5px); opacity: 0.5; }
          75% { transform: translateY(-30px) translateX(5px); opacity: 0.6; }
        }
        .animate-float {
          animation: float 8s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};

export default MainApp;
